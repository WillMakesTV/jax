package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// OpenAI (ChatGPT)
//
// Mirrors the Anthropic connection (see anthropic.go). Two ways to
// authenticate:
//
//   - ChatGPT account (recommended): links the account the Codex CLI on this
//     machine is signed in with (Plus/Pro/Team/Enterprise). AI features then
//     run through Codex's non-interactive mode (`codex exec`) so usage draws
//     on the subscription — ChatGPT subscription OAuth is restricted to
//     Codex, so the app rides its sign-in rather than running the flow
//     itself.
//
//   - API key: a platform.openai.com key stored like the other service
//     credentials and sent to the raw OpenAI API as a Bearer token. Billed
//     as API usage.
//
// The connection mode is kept in serviceConn.login so restarts restore it.
// ---------------------------------------------------------------------------

const (
	openaiService     = "openai"
	openaiModeAccount = "account" // serviceConn.login value for Codex
	openaiModeAPIKey  = "api_key" // serviceConn.login value for an API key

	openaiModelsURL = "https://api.openai.com/v1/models"
)

// ConnectOpenAIAccount links the ChatGPT account that the Codex CLI on this
// machine is signed in with, in one blocking round-trip: a missing or broken
// sign-in triggers `codex login` with no console window (Codex opens the
// default browser for the OAuth flow), and the credential is then verified
// with a real request before the connection is reported live. Progress is
// emitted as "openai:connect" stage events so the UI can narrate the wait.
func (a *App) ConnectOpenAIAccount() (ServiceStatus, error) {
	codexPath, err := findCodex()
	if err != nil {
		return ServiceStatus{}, fmt.Errorf(
			"Codex is not installed — install it from openai.com/codex (or `npm install -g @openai/codex`), then retry")
	}

	account, ok := codexAccount()
	if !ok {
		if account, err = a.codexBrowserLogin(codexPath); err != nil {
			return ServiceStatus{}, err
		}
	}

	// The credentials file existing is not proof the sign-in still works
	// (tokens get revoked, plans lapse) — run a real round-trip before
	// reporting the connection live. Only credential-shaped failures get a
	// fresh sign-in; anything else (unsupported model, network) surfaces
	// as-is.
	a.emitOpenAIConnectStage("verifying")
	if err := verifyCodexAuth(); err != nil {
		if !looksLikeCodexAuthError(err) {
			return ServiceStatus{}, err
		}
		if account, err = a.codexBrowserLogin(codexPath); err != nil {
			return ServiceStatus{}, err
		}
		a.emitOpenAIConnectStage("verifying")
		if err := verifyCodexAuth(); err != nil {
			return ServiceStatus{}, err
		}
	}

	// No token is stored at all: account mode invokes Codex, which holds and
	// refreshes the subscription credential itself.
	a.setService(openaiService, serviceConn{
		login:   openaiModeAccount,
		account: account,
	})
	return ServiceStatus{Name: openaiService, Connected: true, Account: account}, nil
}

// emitOpenAIConnectStage narrates connect progress to the frontend
// ("signin" while the browser OAuth flow is pending, "verifying" during the
// round-trip check).
func (a *App) emitOpenAIConnectStage(stage string) {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "openai:connect", stage)
	}
}

// codexBrowserLogin runs `codex login` with no console window: Codex opens
// the default browser for the ChatGPT OAuth flow and exits once it completes.
// Blocks until the sign-in finishes or the deadline passes.
func (a *App) codexBrowserLogin(codexPath string) (string, error) {
	a.emitOpenAIConnectStage("signin")
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, codexPath, "login")
	cmd.Env = envWithout(os.Environ(), "OPENAI_API_KEY")
	hideWindow(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("the browser sign-in wasn't completed in time — try again")
		}
		return "", fmt.Errorf("the ChatGPT sign-in didn't complete: %s", codexErrorDetail(out.String(), err.Error()))
	}
	account, ok := codexAccount()
	if !ok {
		return "", fmt.Errorf("the sign-in finished but Codex stored no account — try again")
	}
	return account, nil
}

// looksLikeCodexAuthError reports whether a verify failure reads as a
// credential problem (fixable by signing in again) rather than an error the
// user needs to see (unsupported model, plan limits, network).
func looksLikeCodexAuthError(err error) bool {
	s := strings.ToLower(err.Error())
	for _, marker := range []string{
		"sign in", "signed in", "sign-in", "log out", "logged out", "login",
		"token", "401", "unauthorized", "credential",
	} {
		if strings.Contains(s, marker) {
			return true
		}
	}
	return false
}

// ConnectOpenAIAPIKey validates and stores a platform API key as the OpenAI
// connection.
func (a *App) ConnectOpenAIAPIKey(key string) (ServiceStatus, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return ServiceStatus{}, fmt.Errorf("an API key is required")
	}
	if err := verifyOpenAIAuth(key); err != nil {
		return ServiceStatus{}, err
	}

	a.setService(openaiService, serviceConn{
		token:   key,
		login:   openaiModeAPIKey,
		account: "API key",
	})
	return ServiceStatus{Name: openaiService, Connected: true, Account: "API key"}, nil
}

// codexHeadlessCmd builds a non-interactive Codex invocation
// (`codex exec <prompt>`) for account-mode AI features; the response arrives
// on stdout. API-key mode calls the raw API with openaiAuthHeaders instead.
func codexHeadlessCmd(ctx context.Context, prompt string, extraArgs ...string) (*exec.Cmd, error) {
	codexPath, err := findCodex()
	if err != nil {
		return nil, fmt.Errorf("Codex is no longer available — reconnect OpenAI in Settings → AI")
	}
	// The app's working directory is arbitrary (not a repo the model should
	// touch), so skip Codex's git-repo safety prompt. Flags go before the
	// prompt positional so "-" (read the prompt from stdin) stays last.
	args := append([]string{"exec", "--skip-git-repo-check"}, extraArgs...)
	args = append(args, prompt)
	cmd := exec.CommandContext(ctx, codexPath, args...)
	// The codex CLI prefers an OPENAI_API_KEY in its environment over the
	// subscription login — scrub it so account mode always bills the
	// subscription (same lesson as claudeHeadlessCmd).
	cmd.Env = envWithout(os.Environ(), "OPENAI_API_KEY")
	hideWindow(cmd)
	return cmd, nil
}

// openaiAuthHeaders returns raw-API auth headers for API-key connections.
// Account connections don't call the raw API — they go through Codex (see
// codexHeadlessCmd) so usage draws on the subscription.
func (a *App) openaiAuthHeaders() (map[string]string, error) {
	conn, ok := a.getConn(openaiService)
	if !ok {
		return nil, fmt.Errorf("OpenAI is not connected — connect it in Settings → AI")
	}
	if conn.login != openaiModeAPIKey {
		return nil, fmt.Errorf("this OpenAI connection uses the ChatGPT account via Codex, not the raw API")
	}
	return map[string]string{"Authorization": "Bearer " + conn.token}, nil
}

// findCodex locates the Codex CLI: on PATH first, then the installer
// locations a GUI app's PATH often misses (mirrors findClaudeCode).
func findCodex() (string, error) {
	if p, err := exec.LookPath("codex"); err == nil {
		return p, nil
	}
	var candidates []string
	if home, err := os.UserHomeDir(); err == nil {
		for _, name := range []string{"codex.exe", "codex.cmd", "codex"} {
			candidates = append(candidates, filepath.Join(home, ".local", "bin", name))
		}
	}
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			candidates = append(candidates, filepath.Join(appData, "npm", "codex.cmd"))
		}
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("codex not found")
}

// codexHome returns Codex's config directory: $CODEX_HOME, else ~/.codex.
func codexHome() (string, error) {
	if dir := strings.TrimSpace(os.Getenv("CODEX_HOME")); dir != "" {
		return dir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex"), nil
}

// codexAccount reads the signed-in ChatGPT account from Codex's credentials
// (auth.json under codexHome). Returns false when Codex has never signed in
// on this machine.
func codexAccount() (string, bool) {
	dir, err := codexHome()
	if err != nil {
		return "", false
	}
	raw, err := os.ReadFile(filepath.Join(dir, "auth.json"))
	if err != nil {
		return "", false
	}
	var creds struct {
		APIKey string `json:"OPENAI_API_KEY"`
		Tokens struct {
			IDToken string `json:"id_token"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(raw, &creds); err != nil {
		return "", false
	}
	if creds.Tokens.IDToken != "" {
		// The ChatGPT sign-in leaves an OIDC id token; its payload carries the
		// account email.
		if email := jwtEmail(creds.Tokens.IDToken); email != "" {
			return email, true
		}
		return "ChatGPT account", true
	}
	if strings.TrimSpace(creds.APIKey) != "" {
		// `codex login --api-key` stores a key instead of ChatGPT tokens; the
		// connection still works, it just bills the platform key.
		return "Codex (API key)", true
	}
	return "", false
}

// jwtEmail extracts the email claim from a JWT without verifying it — the
// token was read from the user's own disk and is used purely as a display
// label, never as a credential.
func jwtEmail(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	return strings.TrimSpace(claims.Email)
}

// verifyCodexAuth confirms the sign-in actually works with a tiny end-to-end
// round-trip. `codex login status` is not enough: it inspects the stored
// credential without exercising it, and still reports "Logged in" when the
// refresh token has already been consumed (observed 2026-07) — only a real
// request surfaces that.
func verifyCodexAuth() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	_, err := askCodex(ctx, "You are a connectivity check.", "Reply with exactly: OK")
	return err
}

// verifyOpenAIAuth confirms a credential works by listing models.
func verifyOpenAIAuth(key string) error {
	var r struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	status, err := getJSON(openaiModelsURL, map[string]string{
		"Authorization": "Bearer " + key,
	}, &r)
	if err != nil {
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			return fmt.Errorf("OpenAI rejected the credential — check it and try again")
		}
		return fmt.Errorf("could not reach the OpenAI API: %v", err)
	}
	return nil
}

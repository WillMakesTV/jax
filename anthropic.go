package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ---------------------------------------------------------------------------
// Anthropic (Claude)
//
// Two ways to authenticate:
//
//   - Claude account (recommended): links the account Claude Code is signed
//     in with (Pro/Max/Team/Enterprise). AI features then run through Claude
//     Code's headless mode (`claude -p`, the Agent SDK surface) so usage
//     draws on the subscription — Anthropic restricts subscription OAuth to
//     Claude Code, so the app rides its sign-in rather than running the
//     flow itself. No API workspace, no per-token billing.
//
//   - API key: a Console API key stored like the other service credentials
//     and sent to the raw Claude API as `x-api-key`. Billed as API usage.
//
// The connection mode is kept in serviceConn.login so restarts restore it.
// ---------------------------------------------------------------------------

const (
	anthropicService     = "anthropic"
	anthropicModeAccount = "account" // serviceConn.login value for Claude Code
	anthropicModeAPIKey  = "api_key" // serviceConn.login value for an API key

	anthropicVersion   = "2023-06-01"
	anthropicModelsURL = "https://api.anthropic.com/v1/models?limit=1"
)

// ConnectAnthropicAccount links the Claude account that Claude Code on this
// machine is signed in with. When Claude Code exists but isn't signed in, a
// terminal is opened so the user can run /login, and the call reports what
// to do — it does not block waiting for the sign-in.
func (a *App) ConnectAnthropicAccount() (ServiceStatus, error) {
	claudePath, err := findClaudeCode()
	if err != nil {
		return ServiceStatus{}, fmt.Errorf(
			"Claude Code is not installed — install it from claude.com/claude-code (or `npm install -g @anthropic-ai/claude-code`), sign in once, and retry")
	}

	account, ok := claudeCodeAccount()
	if !ok {
		if openTerminal(claudePath) {
			return ServiceStatus{}, fmt.Errorf(
				"Claude Code isn't signed in yet — a terminal has opened; run /login there to sign in with your Claude account, then retry")
		}
		return ServiceStatus{}, fmt.Errorf(
			"Claude Code isn't signed in yet — run `claude` in a terminal and use /login to sign in with your Claude account, then retry")
	}

	// No token is stored at all: account mode invokes Claude Code, which
	// holds and refreshes the subscription credential itself.
	a.setService(anthropicService, serviceConn{
		login:   anthropicModeAccount,
		account: account,
	})
	return ServiceStatus{Name: anthropicService, Connected: true, Account: account}, nil
}

// ConnectAnthropicAPIKey validates and stores a Console API key as the
// Anthropic connection.
func (a *App) ConnectAnthropicAPIKey(key string) (ServiceStatus, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return ServiceStatus{}, fmt.Errorf("an API key is required")
	}
	if err := verifyAnthropicAuth(map[string]string{"x-api-key": key}); err != nil {
		return ServiceStatus{}, err
	}

	a.setService(anthropicService, serviceConn{
		token:   key,
		login:   anthropicModeAPIKey,
		account: "API key",
	})
	return ServiceStatus{Name: anthropicService, Connected: true, Account: "API key"}, nil
}

// claudeHeadlessCmd builds a non-interactive Claude Code invocation
// (`claude -p <prompt>`) for account-mode AI features; the response arrives
// on stdout. API-key mode calls the raw API with anthropicAuthHeaders
// instead.
func claudeHeadlessCmd(ctx context.Context, prompt string, extraArgs ...string) (*exec.Cmd, error) {
	claudePath, err := findClaudeCode()
	if err != nil {
		return nil, fmt.Errorf("Claude Code is no longer available — reconnect Anthropic in Settings → AI")
	}
	args := append([]string{"-p", prompt}, extraArgs...)
	cmd := exec.CommandContext(ctx, claudePath, args...)
	// The claude CLI prefers an ANTHROPIC_API_KEY in its environment over the
	// subscription login — scrub it so account mode always bills the
	// subscription (same lesson as twitch-chatter-bot's llm module).
	cmd.Env = envWithout(os.Environ(), "ANTHROPIC_API_KEY")
	hideWindow(cmd)
	return cmd, nil
}

// envWithout returns env minus any assignment of the named variable.
func envWithout(env []string, name string) []string {
	prefix := name + "="
	out := env[:0]
	for _, kv := range env {
		if !strings.HasPrefix(kv, prefix) {
			out = append(out, kv)
		}
	}
	return out
}

// anthropicAuthHeaders returns raw-API auth headers for API-key connections.
// Account connections don't call the raw API — they go through Claude Code
// (see claudeHeadlessCmd) so usage draws on the subscription.
func (a *App) anthropicAuthHeaders() (map[string]string, error) {
	conn, ok := a.getConn(anthropicService)
	if !ok {
		return nil, fmt.Errorf("Anthropic is not connected — connect it in Settings → AI")
	}
	if conn.login != anthropicModeAPIKey {
		return nil, fmt.Errorf("this Anthropic connection uses the Claude account via Claude Code, not the raw API")
	}
	return map[string]string{
		"anthropic-version": anthropicVersion,
		"x-api-key":         conn.token,
	}, nil
}

// findClaudeCode locates the Claude Code CLI: on PATH first, then the
// installer locations a GUI app's PATH often misses (the native installer's
// ~/.local/bin and npm's global bin on Windows).
func findClaudeCode() (string, error) {
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}
	var candidates []string
	if home, err := os.UserHomeDir(); err == nil {
		// The native installer's location; try every executable name it may
		// use (mirrors twitch-chatter-bot's resolver).
		for _, name := range []string{"claude.exe", "claude.cmd", "claude"} {
			candidates = append(candidates, filepath.Join(home, ".local", "bin", name))
		}
	}
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			candidates = append(candidates, filepath.Join(appData, "npm", "claude.cmd"))
		}
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("claude not found")
}

// claudeCodeAccount reads the signed-in Claude account from Claude Code's
// config (~/.claude.json). Returns false when Claude Code has never signed
// in on this machine.
func claudeCodeAccount() (string, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", false
	}
	raw, err := os.ReadFile(filepath.Join(home, ".claude.json"))
	if err != nil {
		return "", false
	}
	var cfg struct {
		OAuthAccount struct {
			EmailAddress     string `json:"emailAddress"`
			OrganizationName string `json:"organizationName"`
		} `json:"oauthAccount"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return "", false
	}
	account := firstNonEmpty(cfg.OAuthAccount.EmailAddress, cfg.OAuthAccount.OrganizationName)
	if account == "" {
		return "", false
	}
	return account, true
}

// openTerminal opens an interactive terminal running the given program so
// the user can complete a sign-in there. Best-effort; returns whether a
// window was launched.
func openTerminal(program string) bool {
	if runtime.GOOS != "windows" {
		return false
	}
	// `start` detaches a new console window; the empty string is its title.
	cmd := exec.Command("cmd", "/c", "start", "", program)
	hideWindow(cmd)
	return cmd.Start() == nil
}

// verifyAnthropicAuth confirms a credential works by listing models.
func verifyAnthropicAuth(auth map[string]string) error {
	headers := map[string]string{"anthropic-version": anthropicVersion}
	for k, v := range auth {
		headers[k] = v
	}
	var r struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	status, err := getJSON(anthropicModelsURL, headers, &r)
	if err != nil {
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			return fmt.Errorf("Anthropic rejected the credential — check it and try again")
		}
		return fmt.Errorf("could not reach the Anthropic API: %v", err)
	}
	return nil
}

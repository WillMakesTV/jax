package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Anthropic (Claude)
//
// Two ways to authenticate, mirroring Anthropic's own guidance:
//
//   - Claude account (recommended): the Anthropic CLI's OAuth profile
//     (`ant auth login`) covers Pro/Max/Team/Enterprise accounts. The app
//     never stores the OAuth tokens itself — it mints short-lived access
//     tokens on demand via `ant auth print-credentials --access-token` and
//     sends them as `Authorization: Bearer` plus the OAuth beta header.
//
//   - API key: a Console API key stored like the other service credentials
//     and sent as `x-api-key`.
//
// The connection mode is kept in serviceConn.login so restarts restore it.
// ---------------------------------------------------------------------------

const (
	anthropicService     = "anthropic"
	anthropicModeAccount = "account" // serviceConn.login value for CLI OAuth
	anthropicModeAPIKey  = "api_key" // serviceConn.login value for an API key

	anthropicVersion   = "2023-06-01"
	anthropicOAuthBeta = "oauth-2025-04-20"
	anthropicModelsURL = "https://api.anthropic.com/v1/models?limit=1"
)

// ConnectAnthropicAccount signs in with a Claude account via the Anthropic
// CLI, installing the CLI first when it is missing (per Anthropic's
// quickstart: `go install github.com/anthropics/anthropic-cli/cmd/ant`). An
// existing `ant auth login` profile is adopted as-is; otherwise the CLI's
// interactive login opens the default browser and this call waits for it to
// finish. Blocks until the sign-in completes or times out.
func (a *App) ConnectAnthropicAccount() (ServiceStatus, error) {
	antPath, err := findAnt()
	if err != nil {
		if antPath, err = installAnthropicCLI(); err != nil {
			return ServiceStatus{}, err
		}
	}

	// An existing profile mints a token without any interaction; only fall
	// back to the browser login when there is none (or it has expired).
	token, err := antAccessToken(antPath)
	if err != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		login := exec.CommandContext(ctx, antPath, "auth", "login")
		hideWindow(login)
		if out, err := login.CombinedOutput(); err != nil {
			return ServiceStatus{}, fmt.Errorf("Claude sign-in failed: %s",
				firstNonEmpty(trimCLIOutput(out), err.Error()))
		}
		if token, err = antAccessToken(antPath); err != nil {
			return ServiceStatus{}, fmt.Errorf("signed in, but no credential was issued: %v", err)
		}
	}

	if err := verifyAnthropicAuth(map[string]string{
		"Authorization":  "Bearer " + token,
		"anthropic-beta": anthropicOAuthBeta,
	}); err != nil {
		return ServiceStatus{}, err
	}

	// The connection is the account itself: the short-lived token is never
	// stored, and is re-minted from the CLI profile whenever the API is
	// called (see anthropicAuthHeaders).
	account := antAccountLabel(antPath)
	a.setService(anthropicService, serviceConn{
		login:   anthropicModeAccount,
		account: account,
	})
	status := ServiceStatus{Name: anthropicService, Connected: true, Account: account}
	return status, nil
}

// antAccountLabel asks the CLI who is signed in so the UI shows the actual
// Claude account rather than a generic label. `ant auth status` output is
// human-oriented, so parsing is best-effort with a safe fallback.
func antAccountLabel(antPath string) string {
	const fallback = "Claude account"
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, antPath, "auth", "status")
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fallback
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		for _, key := range []string{"account:", "email:", "user:", "organization:"} {
			if strings.HasPrefix(lower, key) {
				if v := strings.TrimSpace(line[len(key):]); v != "" {
					return v
				}
			}
		}
		// A bare email anywhere in the output is the best identity signal.
		if strings.Contains(line, "@") && strings.Contains(line, ".") &&
			!strings.ContainsAny(line, " \t") {
			return line
		}
	}
	return fallback
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
	status := ServiceStatus{Name: anthropicService, Connected: true, Account: "API key"}
	return status, nil
}

// anthropicAuthHeaders returns the auth headers for a Claude API call using
// whichever mode the connection was made with. Account mode re-mints a
// short-lived token from the CLI profile on every call.
func (a *App) anthropicAuthHeaders() (map[string]string, error) {
	conn, ok := a.getConn(anthropicService)
	if !ok {
		return nil, fmt.Errorf("Anthropic is not connected — connect it in Settings → Services")
	}
	headers := map[string]string{"anthropic-version": anthropicVersion}
	switch conn.login {
	case anthropicModeAPIKey:
		headers["x-api-key"] = conn.token
	default:
		antPath, err := findAnt()
		if err != nil {
			return nil, fmt.Errorf("the Anthropic CLI (ant) is no longer available — reconnect in Settings → Services")
		}
		token, err := antAccessToken(antPath)
		if err != nil {
			return nil, fmt.Errorf("Claude session expired — reconnect in Settings → Services (%v)", err)
		}
		headers["Authorization"] = "Bearer " + token
		headers["anthropic-beta"] = anthropicOAuthBeta
	}
	return headers, nil
}

// findAnt locates the Anthropic CLI: on PATH first, then in Go's bin
// directory — `go install` puts it there, and that directory is usually not
// on a GUI app's PATH.
func findAnt() (string, error) {
	if p, err := exec.LookPath("ant"); err == nil {
		return p, nil
	}
	if dir, err := goBinDir(); err == nil {
		p := filepath.Join(dir, antExeName())
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("the Anthropic CLI (ant) is not installed")
}

func antExeName() string {
	if runtime.GOOS == "windows" {
		return "ant.exe"
	}
	return "ant"
}

// goBinDir resolves where `go install` places binaries: GOBIN when set,
// otherwise GOPATH/bin.
func goBinDir() (string, error) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		return "", err
	}
	if out := goEnv(goPath, "GOBIN"); out != "" {
		return out, nil
	}
	if out := goEnv(goPath, "GOPATH"); out != "" {
		return filepath.Join(out, "bin"), nil
	}
	return "", fmt.Errorf("no GOBIN or GOPATH")
}

func goEnv(goPath, key string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, goPath, "env", key)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// installAnthropicCLI installs the CLI the way Anthropic's quickstart
// documents for Go environments:
//
//	go install github.com/anthropics/anthropic-cli/cmd/ant@latest
//
// The first install downloads and compiles the module, so this can take a
// minute or two.
func installAnthropicCLI() (string, error) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		return "", fmt.Errorf(
			"the Anthropic CLI (ant) is not installed, and Go isn't available to install it automatically — install Go (go.dev/dl) and retry, or install ant manually from platform.claude.com/docs/en/cli-sdks-libraries/cli/quickstart")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, goPath, "install", "github.com/anthropics/anthropic-cli/cmd/ant@latest")
	hideWindow(cmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("installing the Anthropic CLI failed: %s",
			firstNonEmpty(trimCLIOutput(out), err.Error()))
	}

	antPath, err := findAnt()
	if err != nil {
		return "", fmt.Errorf("the Anthropic CLI was installed but could not be located — check `go env GOPATH`")
	}
	return antPath, nil
}

// antAccessToken mints a short-lived access token from the CLI's active
// profile (refreshing it if needed). Fails when no profile is logged in.
func antAccessToken(antPath string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, antPath, "auth", "print-credentials", "--access-token")
	hideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s", firstNonEmpty(trimCLIOutput(stderr.Bytes()), err.Error()))
	}
	token := strings.TrimSpace(stdout.String())
	if token == "" {
		return "", fmt.Errorf("no active Claude sign-in")
	}
	return token, nil
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

// trimCLIOutput condenses CLI output into a single short error line.
func trimCLIOutput(out []byte) string {
	s := strings.TrimSpace(string(out))
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

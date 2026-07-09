package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// ---------------------------------------------------------------------------
// Claude Code / Claude Desktop MCP configuration
//
// One button in Settings → AI → Connect Anthropic registers the app as an
// MCP server with both clients by editing their config files:
//
//   - Claude Code:    ~/.claude.json            (user scope, "mcpServers")
//   - Claude Desktop: %APPDATA%\Claude\claude_desktop_config.json
//
// Both get the same stdio entry — this binary relaunched as `jax.exe mcp`
// (see mcp_proxy.go) with the bearer token in its environment. The files are
// owned by the Claude apps and hold unrelated user configuration, so edits
// are strictly surgical: decode with json.Number (so re-encoding never
// mangles large numeric values like timestamps), replace only
// mcpServers.jax, and write the rest back untouched. A file that fails to
// parse is left alone and reported rather than overwritten.
// ---------------------------------------------------------------------------

// MCPTargetStatus describes one Claude client's configuration state.
type MCPTargetStatus struct {
	Name       string `json:"name"`
	Installed  bool   `json:"installed"`
	Configured bool   `json:"configured"` // a jax entry exists in the config
	Current    bool   `json:"current"`    // ...and it matches this exe + token
	Path       string `json:"path"`       // the config file location
}

// MCPStatus is the Settings → AI view of the MCP server.
type MCPStatus struct {
	Token         string          `json:"token"`
	Running       bool            `json:"running"`
	ToolCount     int             `json:"toolCount"`
	ClaudeCode    MCPTargetStatus `json:"claudeCode"`
	ClaudeDesktop MCPTargetStatus `json:"claudeDesktop"`
}

// claudeCodeConfigPath returns Claude Code's user-scope config (~/.claude.json).
func claudeCodeConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude.json"), nil
}

// claudeDesktopConfigPath returns Claude Desktop's config file location for
// this platform.
func claudeDesktopConfigPath() (string, error) {
	switch runtime.GOOS {
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			return "", fmt.Errorf("APPDATA is not set")
		}
		return filepath.Join(appData, "Claude", "claude_desktop_config.json"), nil
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), nil
	default:
		dir, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(dir, "Claude", "claude_desktop_config.json"), nil
	}
}

// claudeCodeInstalled reports whether Claude Code exists on this machine —
// either the CLI resolves or its config file already exists.
func claudeCodeInstalled(configPath string) bool {
	if _, err := findClaudeCode(); err == nil {
		return true
	}
	_, err := os.Stat(configPath)
	return err == nil
}

// claudeDesktopInstalled reports whether Claude Desktop exists — its config
// directory or (on Windows) its install directory is present.
func claudeDesktopInstalled(configPath string) bool {
	if _, err := os.Stat(filepath.Dir(configPath)); err == nil {
		return true
	}
	if runtime.GOOS == "windows" {
		if lad := os.Getenv("LOCALAPPDATA"); lad != "" {
			if _, err := os.Stat(filepath.Join(lad, "AnthropicClaude")); err == nil {
				return true
			}
		}
	}
	return false
}

// mcpServerEntry builds the stdio server entry both clients launch.
func mcpServerEntry(exe, token string) map[string]any {
	return map[string]any{
		"command": exe,
		"args":    []any{"mcp"},
		"env":     map[string]any{mcpEnvToken: token},
	}
}

// readJSONConfig decodes a config file into a generic map, using json.Number
// so numeric values survive a round trip byte-identically. A missing file
// yields an empty map.
func readJSONConfig(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	root := map[string]any{}
	if len(bytes.TrimSpace(raw)) == 0 {
		return root, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&root); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON (%v) — fix or remove it and retry", path, err)
	}
	return root, nil
}

// upsertMCPServerConfig inserts or updates the app's entry under "mcpServers"
// in the config at path, preserving everything else, and writes the file
// atomically.
func upsertMCPServerConfig(path string, entry map[string]any) error {
	root, err := readJSONConfig(path)
	if err != nil {
		return err
	}
	servers, _ := root["mcpServers"].(map[string]any)
	if servers == nil {
		servers = map[string]any{}
	}
	servers[mcpServerName] = entry
	root["mcpServers"] = servers

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(root); err != nil {
		return err
	}
	tmp := path + ".jax-tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// mcpConfiguredEntry returns the app's entry from a client config, if any.
func mcpConfiguredEntry(path string) (map[string]any, bool) {
	root, err := readJSONConfig(path)
	if err != nil {
		return nil, false
	}
	servers, _ := root["mcpServers"].(map[string]any)
	entry, _ := servers[mcpServerName].(map[string]any)
	return entry, entry != nil
}

// mcpEntryCurrent reports whether a configured entry matches this executable
// and token (i.e. no re-setup is needed).
func mcpEntryCurrent(entry map[string]any, exe, token string) bool {
	if entry["command"] != exe {
		return false
	}
	env, _ := entry["env"].(map[string]any)
	if env == nil || env[mcpEnvToken] != token {
		return false
	}
	args, _ := entry["args"].([]any)
	return len(args) == 1 && args[0] == "mcp"
}

// mcpTargets returns the two client targets with their current state.
func (a *App) mcpTargets() []MCPTargetStatus {
	token := a.getMCPToken()
	exe, _ := os.Executable()

	targets := []MCPTargetStatus{}
	if path, err := claudeCodeConfigPath(); err == nil {
		t := MCPTargetStatus{Name: "Claude Code", Path: path, Installed: claudeCodeInstalled(path)}
		if entry, ok := mcpConfiguredEntry(path); ok {
			t.Configured = true
			t.Current = mcpEntryCurrent(entry, exe, token)
		}
		targets = append(targets, t)
	}
	if path, err := claudeDesktopConfigPath(); err == nil {
		t := MCPTargetStatus{Name: "Claude Desktop", Path: path, Installed: claudeDesktopInstalled(path)}
		if entry, ok := mcpConfiguredEntry(path); ok {
			t.Configured = true
			t.Current = mcpEntryCurrent(entry, exe, token)
		}
		targets = append(targets, t)
	}
	return targets
}

func (a *App) mcpStatus() MCPStatus {
	st := MCPStatus{
		Token:     a.ensureMCPToken(),
		Running:   a.getMCPURL() != "",
		ToolCount: len(mcpToolCatalog()),
	}
	for _, t := range a.mcpTargets() {
		switch t.Name {
		case "Claude Code":
			st.ClaudeCode = t
		case "Claude Desktop":
			st.ClaudeDesktop = t
		}
	}
	return st
}

// GetMCPStatus reports the MCP token and each Claude client's configuration
// state for the Settings → AI modal.
func (a *App) GetMCPStatus() MCPStatus {
	return a.mcpStatus()
}

// SetupClaudeMCP registers the app as an MCP server with every Claude client
// installed on this machine (Claude Code and Claude Desktop), preserving all
// other configuration in their files. Clients read the config at launch, so
// the user must restart them afterwards.
func (a *App) SetupClaudeMCP() (MCPStatus, error) {
	return a.writeMCPConfigs(false)
}

// RecycleMCPToken replaces the MCP bearer token with a freshly generated one
// and rewrites the client configs that already carry an entry so they pick up
// the new token. Running clients must be restarted.
func (a *App) RecycleMCPToken() (MCPStatus, error) {
	token, err := generateMCPToken()
	if err != nil {
		return a.mcpStatus(), fmt.Errorf("could not generate a token: %v", err)
	}
	a.mu.Lock()
	a.mcpToken = token
	a.mu.Unlock()
	if a.store != nil {
		if err := a.store.setSetting(keyMCPToken, token); err != nil {
			return a.mcpStatus(), fmt.Errorf("could not persist the new token: %v", err)
		}
	}
	return a.writeMCPConfigs(true)
}

// writeMCPConfigs writes the server entry into the client configs.
// onlyConfigured limits the write to clients that already carry an entry
// (token recycling must not set up a client the user never connected).
func (a *App) writeMCPConfigs(onlyConfigured bool) (MCPStatus, error) {
	token := a.ensureMCPToken()
	if token == "" {
		return a.mcpStatus(), fmt.Errorf("no MCP token is available — check the app's storage")
	}
	exe, err := os.Executable()
	if err != nil {
		return a.mcpStatus(), fmt.Errorf("could not resolve the app executable: %v", err)
	}
	entry := mcpServerEntry(exe, token)

	var errs []string
	wrote := 0
	for _, t := range a.mcpTargets() {
		if onlyConfigured && !t.Configured {
			continue
		}
		if !onlyConfigured && !t.Installed {
			continue
		}
		if err := upsertMCPServerConfig(t.Path, entry); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", t.Name, err))
			continue
		}
		wrote++
	}

	status := a.mcpStatus()
	if len(errs) > 0 {
		return status, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	if wrote == 0 && !onlyConfigured {
		return status, fmt.Errorf("neither Claude Code nor Claude Desktop was found on this computer — install one and retry")
	}
	return status, nil
}

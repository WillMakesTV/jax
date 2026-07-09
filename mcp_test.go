package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- Config merge -----------------------------------------------------------

func TestUpsertMCPServerConfigPreservesExistingConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "claude.json")

	// A realistic ~/.claude.json: unrelated settings, another MCP server, and
	// a large integer that float64 round-tripping would mangle.
	existing := `{
  "theme": "dark",
  "firstStartTime": 1751234567890123,
  "projects": {"C:\\repo": {"allowedTools": ["Bash"]}},
  "mcpServers": {
    "github": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"]}
  }
}`
	if err := os.WriteFile(path, []byte(existing), 0o600); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	if err := upsertMCPServerConfig(path, mcpServerEntry(`C:\apps\jax.exe`, "jaxmcp_abc")); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.Contains(string(raw), "1751234567890123") {
		t.Fatalf("large number was mangled:\n%s", raw)
	}

	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
	if root["theme"] != "dark" {
		t.Fatalf("unrelated key lost: %v", root["theme"])
	}
	if _, ok := root["projects"].(map[string]any)["C:\\repo"]; !ok {
		t.Fatalf("nested unrelated key lost")
	}
	servers := root["mcpServers"].(map[string]any)
	if _, ok := servers["github"]; !ok {
		t.Fatalf("existing MCP server lost")
	}
	jax, ok := servers[mcpServerName].(map[string]any)
	if !ok {
		t.Fatalf("jax entry missing")
	}
	if jax["command"] != `C:\apps\jax.exe` {
		t.Fatalf("command = %v", jax["command"])
	}
	if jax["env"].(map[string]any)[mcpEnvToken] != "jaxmcp_abc" {
		t.Fatalf("token missing from env: %v", jax["env"])
	}
}

func TestUpsertMCPServerConfigUpdatesExistingEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "claude_desktop_config.json")
	if err := upsertMCPServerConfig(path, mcpServerEntry("old.exe", "jaxmcp_old")); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if err := upsertMCPServerConfig(path, mcpServerEntry("new.exe", "jaxmcp_new")); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	entry, ok := mcpConfiguredEntry(path)
	if !ok {
		t.Fatalf("entry missing after update")
	}
	if !mcpEntryCurrent(entry, "new.exe", "jaxmcp_new") {
		t.Fatalf("entry not updated: %v", entry)
	}
	if mcpEntryCurrent(entry, "new.exe", "jaxmcp_old") {
		t.Fatalf("stale token should not read as current")
	}
}

func TestUpsertMCPServerConfigCreatesMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Claude", "claude_desktop_config.json")
	if err := upsertMCPServerConfig(path, mcpServerEntry("jax.exe", "jaxmcp_x")); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if _, ok := mcpConfiguredEntry(path); !ok {
		t.Fatalf("entry missing from created file")
	}
}

func TestUpsertMCPServerConfigRefusesCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "claude.json")
	corrupt := []byte(`{"theme": "dark",`)
	if err := os.WriteFile(path, corrupt, 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := upsertMCPServerConfig(path, mcpServerEntry("jax.exe", "jaxmcp_x")); err == nil {
		t.Fatal("want an error for a corrupt config")
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != string(corrupt) {
		t.Fatalf("corrupt file was modified:\n%s", raw)
	}
}

// --- Token lifecycle --------------------------------------------------------

// isolateClaudeConfigs points every Claude config location at temp dirs so
// tests never touch the developer's real Claude Code / Desktop configuration.
func isolateClaudeConfigs(t *testing.T) {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("PATH", "") // findClaudeCode must not resolve a real CLI
}

func TestMCPTokenPersistsAndRecycles(t *testing.T) {
	a := newTestApp(t)
	isolateClaudeConfigs(t)

	first := a.ensureMCPToken()
	if !strings.HasPrefix(first, mcpTokenPrefix) || len(first) < 40 {
		t.Fatalf("weak token: %q", first)
	}
	if again := a.ensureMCPToken(); again != first {
		t.Fatalf("token not stable: %q vs %q", again, first)
	}

	// A fresh App over the same store restores the same token.
	b := &App{store: a.store}
	if restored := b.ensureMCPToken(); restored != first {
		t.Fatalf("token not persisted: %q vs %q", restored, first)
	}

	status, err := a.RecycleMCPToken()
	if err != nil {
		t.Fatalf("recycle: %v", err)
	}
	if status.Token == first || !strings.HasPrefix(status.Token, mcpTokenPrefix) {
		t.Fatalf("recycle did not rotate the token: %q", status.Token)
	}
	if v, _ := a.store.getSetting(keyMCPToken); v != status.Token {
		t.Fatalf("recycled token not persisted")
	}
}

func TestRecycleRewritesOnlyConfiguredClients(t *testing.T) {
	a := newTestApp(t)
	isolateClaudeConfigs(t)
	home, _ := os.UserHomeDir()

	// Claude Code is "configured" (has a jax entry); Claude Desktop is not.
	codePath := filepath.Join(home, ".claude.json")
	exe, _ := os.Executable()
	if err := upsertMCPServerConfig(codePath, mcpServerEntry(exe, a.ensureMCPToken())); err != nil {
		t.Fatalf("seed code config: %v", err)
	}

	status, err := a.RecycleMCPToken()
	if err != nil {
		t.Fatalf("recycle: %v", err)
	}
	entry, ok := mcpConfiguredEntry(codePath)
	if !ok || !mcpEntryCurrent(entry, exe, status.Token) {
		t.Fatalf("Claude Code config not refreshed with the new token")
	}
	desktopPath, err := claudeDesktopConfigPath()
	if err != nil {
		t.Fatalf("desktop path: %v", err)
	}
	if _, statErr := os.Stat(desktopPath); statErr == nil {
		t.Fatalf("recycle must not create a Claude Desktop config")
	}
}

// --- JSON-RPC endpoint ------------------------------------------------------

func postMCP(t *testing.T, a *App, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", mcpEndpointPath, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	mcpHandler{app: a}.ServeHTTP(rec, req)
	return rec
}

func TestMCPEndpointAuthAndDispatch(t *testing.T) {
	a := newTestApp(t)
	token := a.ensureMCPToken()

	if rec := postMCP(t, a, "", `{"jsonrpc":"2.0","id":1,"method":"ping"}`); rec.Code != 401 {
		t.Fatalf("missing token: want 401, got %d", rec.Code)
	}
	if rec := postMCP(t, a, "jaxmcp_wrong", `{"jsonrpc":"2.0","id":1,"method":"ping"}`); rec.Code != 401 {
		t.Fatalf("wrong token: want 401, got %d", rec.Code)
	}

	rec := postMCP(t, a, token, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}`)
	if rec.Code != 200 {
		t.Fatalf("initialize: want 200, got %d", rec.Code)
	}
	var init struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
			ServerInfo      struct {
				Name string `json:"name"`
			} `json:"serverInfo"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &init); err != nil {
		t.Fatalf("decode initialize: %v", err)
	}
	if init.Result.ProtocolVersion != "2025-03-26" || init.Result.ServerInfo.Name != mcpServerName {
		t.Fatalf("initialize result: %+v", init.Result)
	}

	// Notifications are acknowledged without a body.
	if rec := postMCP(t, a, token, `{"jsonrpc":"2.0","method":"notifications/initialized"}`); rec.Code != 202 {
		t.Fatalf("notification: want 202, got %d", rec.Code)
	}

	rec = postMCP(t, a, token, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	var list struct {
		Result struct {
			Tools []struct {
				Name        string         `json:"name"`
				Description string         `json:"description"`
				InputSchema map[string]any `json:"inputSchema"`
			} `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode tools/list: %v", err)
	}
	if len(list.Result.Tools) != len(mcpToolCatalog()) {
		t.Fatalf("tools/list returned %d tools, catalog has %d", len(list.Result.Tools), len(mcpToolCatalog()))
	}
	for _, tool := range list.Result.Tools {
		if tool.Name == "" || tool.Description == "" || tool.InputSchema["type"] != "object" {
			t.Fatalf("malformed tool descriptor: %+v", tool)
		}
	}

	// A real tool runs against the store.
	if _, err := a.SavePlannedStream(PlannedStream{Title: "Launch day"}); err != nil {
		t.Fatalf("seed plan: %v", err)
	}
	rec = postMCP(t, a, token, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_planned_streams","arguments":{}}}`)
	var call struct {
		Result struct {
			IsError bool `json:"isError"`
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &call); err != nil {
		t.Fatalf("decode tools/call: %v", err)
	}
	if call.Result.IsError || len(call.Result.Content) != 1 ||
		!strings.Contains(call.Result.Content[0].Text, "Launch day") {
		t.Fatalf("tools/call result: %+v", call.Result)
	}

	// A tool-level failure (unknown stream) comes back as an isError result,
	// not a protocol error, so the model can read and react to it.
	rec = postMCP(t, a, token, `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"download_stream","arguments":{"startedAt":"1999-01-01T00:00:00Z"}}}`)
	var dl struct {
		Result struct {
			IsError bool `json:"isError"`
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &dl); err != nil {
		t.Fatalf("decode download_stream call: %v", err)
	}
	if !dl.Result.IsError || len(dl.Result.Content) != 1 ||
		!strings.Contains(dl.Result.Content[0].Text, "list_past_streams") {
		t.Fatalf("download_stream unknown-stream result: %+v", dl.Result)
	}

	// Unknown tools and methods are proper errors.
	rec = postMCP(t, a, token, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope"}}`)
	if !strings.Contains(rec.Body.String(), `"error"`) {
		t.Fatalf("unknown tool should error: %s", rec.Body.String())
	}
	rec = postMCP(t, a, token, `{"jsonrpc":"2.0","id":5,"method":"resources/list"}`)
	if !strings.Contains(rec.Body.String(), `"error"`) {
		t.Fatalf("unknown method should error: %s", rec.Body.String())
	}
}

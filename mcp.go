package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------------------
// MCP server
//
// The app exposes its data and workflows to Claude Code and Claude Desktop as
// an MCP server (tools only). The server itself is a loopback HTTP endpoint
// speaking MCP's JSON-RPC — it lives inside the running app so tools operate
// on the same store, caches, and platform connections the UI uses.
//
// MCP clients don't connect to the HTTP port directly: the port is ephemeral
// (picked at startup, like the media server) so a URL written into a config
// file would go stale. Instead the configs launch this same binary as a stdio
// proxy (`jax.exe mcp`, see mcp_proxy.go) which discovers the current port
// from ~/.jax/mcp.json on every request — app restarts never break the
// client configuration.
//
// Every request must carry a bearer token. The token is generated once,
// persisted in the settings table, shown in Settings → AI → Connect
// Anthropic, and can be recycled there (see mcp_config.go).
// ---------------------------------------------------------------------------

const (
	// mcpServerName keys the app's entry under "mcpServers" in Claude Code's
	// and Claude Desktop's config files.
	mcpServerName = "jax"

	// mcpEnvToken carries the auth token from the client config into the
	// stdio proxy's environment.
	mcpEnvToken = "JAX_MCP_TOKEN"

	mcpEndpointPath = "/mcp"
	keyMCPToken     = "mcp_token"
	mcpTokenPrefix  = "jaxmcp_"

	// mcpProtocolLatest is answered when the client proposes a protocol
	// revision the server doesn't know.
	mcpProtocolLatest = "2025-06-18"
)

// mcpProtocolVersions are the MCP revisions this server can speak. The tools
// surface is identical across them, so "supporting" a revision is just
// echoing it back at initialize time.
var mcpProtocolVersions = map[string]bool{
	"2024-11-05": true,
	"2025-03-26": true,
	"2025-06-18": true,
}

// generateMCPToken returns a new random bearer token. The prefix makes the
// token recognisable in config files and secret scanners.
func generateMCPToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return mcpTokenPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}

// mcpToken returns the current bearer token (empty if generation failed).
func (a *App) getMCPToken() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mcpToken
}

// ensureMCPToken loads the persisted token, generating and persisting one on
// first run, and caches it on the app for the request path.
func (a *App) ensureMCPToken() string {
	if t := a.getMCPToken(); t != "" {
		return t
	}
	token := ""
	if a.store != nil {
		if v, err := a.store.getSetting(keyMCPToken); err == nil {
			token = v
		}
	}
	if token == "" {
		t, err := generateMCPToken()
		if err != nil {
			log.Printf("jax: generate MCP token: %v", err)
			return ""
		}
		token = t
		if a.store != nil {
			if err := a.store.setSetting(keyMCPToken, token); err != nil {
				log.Printf("jax: persist MCP token: %v", err)
			}
		}
	}
	a.mu.Lock()
	a.mcpToken = token
	a.mu.Unlock()
	return token
}

// startMCPServer binds a loopback listener for the MCP endpoint and records
// where it lives in ~/.jax/mcp.json so the stdio proxy can find it.
// Best-effort: on failure the MCP surface is simply unavailable.
func (a *App) startMCPServer() {
	if a.ensureMCPToken() == "" {
		return
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Printf("jax: MCP server listen: %v", err)
		return
	}
	url := "http://" + ln.Addr().String() + mcpEndpointPath
	a.mu.Lock()
	a.mcpURL = url
	a.mu.Unlock()
	writeMCPRuntime(url)

	srv := &http.Server{Handler: mcpHandler{app: a}}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("jax: MCP server: %v", err)
		}
	}()
}

// getMCPURL returns the running MCP endpoint URL ("" until startup).
func (a *App) getMCPURL() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mcpURL
}

// ---------------------------------------------------------------------------
// Runtime discovery file
// ---------------------------------------------------------------------------

// mcpRuntime is the discovery record the stdio proxy reads to find the
// running app's MCP endpoint. It intentionally carries no secret — auth
// travels in the client config, not here.
type mcpRuntime struct {
	URL string `json:"url"`
	PID int    `json:"pid"`
}

// mcpRuntimePath returns ~/.jax/mcp.json.
func mcpRuntimePath() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "mcp.json"), nil
}

// writeMCPRuntime records the live endpoint for the proxy. Best-effort.
func writeMCPRuntime(url string) {
	path, err := mcpRuntimePath()
	if err != nil {
		log.Printf("jax: MCP runtime path: %v", err)
		return
	}
	raw, _ := json.Marshal(mcpRuntime{URL: url, PID: os.Getpid()})
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		log.Printf("jax: write MCP runtime file: %v", err)
	}
}

// removeMCPRuntime clears the discovery record at shutdown so proxies report
// "app not running" instead of dialling a dead port.
func removeMCPRuntime() {
	if path, err := mcpRuntimePath(); err == nil {
		_ = os.Remove(path)
	}
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

const (
	rpcCodeParse          = -32700
	rpcCodeInvalidRequest = -32600
	rpcCodeMethodNotFound = -32601
	rpcCodeInvalidParams  = -32602
	rpcCodeInternal       = -32603
)

// isRPCNotification reports whether the message carries no id (and so must
// not be answered).
func isRPCNotification(id json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(id))
	return trimmed == "" || trimmed == "null"
}

type mcpHandler struct {
	app *App
}

func (h mcpHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("jax: MCP handler panic: %v", rec)
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
	}()

	if r.URL.Path != mcpEndpointPath {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.app.mcpAuthorized(r) {
		http.Error(w, "invalid or missing MCP token", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	var req rpcRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeRPCResponse(w, rpcResponse{
			JSONRPC: "2.0",
			ID:      json.RawMessage("null"),
			Error:   &rpcError{Code: rpcCodeParse, Message: "parse error"},
		})
		return
	}
	if isRPCNotification(req.ID) {
		// Notifications (e.g. notifications/initialized) are acknowledged
		// without a body, per the streamable HTTP transport.
		w.WriteHeader(http.StatusAccepted)
		return
	}
	writeRPCResponse(w, h.app.handleMCPRequest(req))
}

func writeRPCResponse(w http.ResponseWriter, resp rpcResponse) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("jax: MCP write response: %v", err)
	}
}

// mcpAuthorized checks the request's bearer token against the app token in
// constant time.
func (a *App) mcpAuthorized(r *http.Request) bool {
	token := a.getMCPToken()
	if token == "" {
		return false
	}
	auth := r.Header.Get("Authorization")
	const scheme = "Bearer "
	if !strings.HasPrefix(auth, scheme) {
		return false
	}
	presented := strings.TrimSpace(strings.TrimPrefix(auth, scheme))
	return subtle.ConstantTimeCompare([]byte(presented), []byte(token)) == 1
}

// ---------------------------------------------------------------------------
// MCP method dispatch
// ---------------------------------------------------------------------------

func (a *App) handleMCPRequest(req rpcRequest) rpcResponse {
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &params)
		version := mcpProtocolLatest
		if mcpProtocolVersions[params.ProtocolVersion] {
			version = params.ProtocolVersion
		}
		resp.Result = map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo": map[string]any{
				"name":    mcpServerName,
				"title":   "Jax — Brand Producer",
				"version": "1.0.0",
			},
		}
	case "ping":
		resp.Result = map[string]any{}
	case "tools/list":
		resp.Result = map[string]any{"tools": mcpToolDescriptors()}
	case "tools/call":
		resp.Result, resp.Error = a.callMCPTool(req.Params)
	default:
		resp.Error = &rpcError{
			Code:    rpcCodeMethodNotFound,
			Message: fmt.Sprintf("method %q is not supported", req.Method),
		}
	}
	return resp
}

// callMCPTool runs one tool. Tool-level failures come back as isError results
// (so the model can read and react to them); only malformed requests become
// protocol errors.
func (a *App) callMCPTool(params json.RawMessage) (any, *rpcError) {
	var call struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &call); err != nil {
		return nil, &rpcError{Code: rpcCodeInvalidParams, Message: "invalid tools/call params"}
	}
	tool, ok := mcpToolByName(call.Name)
	if !ok {
		return nil, &rpcError{Code: rpcCodeInvalidParams, Message: fmt.Sprintf("unknown tool %q", call.Name)}
	}

	result, err := tool.handler(a, call.Arguments)
	if err != nil {
		return mcpTextResult(err.Error(), true), nil
	}
	text, ok := result.(string)
	if !ok {
		raw, jerr := json.MarshalIndent(result, "", "  ")
		if jerr != nil {
			return mcpTextResult("could not encode the result: "+jerr.Error(), true), nil
		}
		text = string(raw)
	}
	return mcpTextResult(text, false), nil
}

func mcpTextResult(text string, isError bool) map[string]any {
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": text}},
		"isError": isError,
	}
}

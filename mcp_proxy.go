package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// ---------------------------------------------------------------------------
// MCP stdio proxy
//
// `jax.exe mcp` is what the Claude Code / Claude Desktop configs launch. It
// speaks MCP's newline-delimited JSON-RPC on stdio and forwards each message
// to the running app's loopback MCP endpoint (mcp.go). The endpoint URL is
// re-read from ~/.jax/mcp.json on every request, so the proxy survives app
// restarts (and their new ephemeral port) without the client noticing.
//
// The bearer token arrives via the JAX_MCP_TOKEN environment entry the config
// carries; the proxy holds no state of its own.
// ---------------------------------------------------------------------------

// runMCPProxy runs the proxy loop until stdin closes. Returns a process exit
// code.
func runMCPProxy() int {
	token := os.Getenv(mcpEnvToken)
	client := &http.Client{
		// Tool calls can legitimately run for minutes (outline generation);
		// only genuinely hung requests should be cut off.
		Timeout: 15 * time.Minute,
	}

	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 0, 64*1024), 32<<20)
	out := bufio.NewWriter(os.Stdout)

	for in.Scan() {
		line := bytes.TrimSpace(in.Bytes())
		if len(line) == 0 {
			continue
		}
		id := rpcMessageID(line)

		resp, errMsg := forwardMCPMessage(client, token, line)
		if errMsg != "" {
			// Notifications get no reply; requests get a JSON-RPC error the
			// client can surface.
			if id != nil {
				writeRPCErrorLine(out, id, errMsg)
			}
			continue
		}
		if id != nil && len(bytes.TrimSpace(resp)) > 0 {
			out.Write(bytes.TrimSpace(resp))
			out.WriteByte('\n')
			out.Flush()
		}
	}
	return 0
}

// rpcMessageID extracts the message id, or nil for notifications.
func rpcMessageID(line []byte) json.RawMessage {
	var msg struct {
		ID json.RawMessage `json:"id"`
	}
	if err := json.Unmarshal(line, &msg); err != nil {
		return nil
	}
	if isRPCNotification(msg.ID) {
		return nil
	}
	return msg.ID
}

// forwardMCPMessage POSTs one JSON-RPC message to the running app. A non-empty
// errMsg describes a delivery failure in user-actionable terms.
func forwardMCPMessage(client *http.Client, token string, line []byte) (body []byte, errMsg string) {
	url, err := readMCPRuntimeURL()
	if err != nil {
		return nil, "Jax is not running — open the Jax app, then try again."
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(line))
	if err != nil {
		return nil, "could not build the request: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return nil, "Jax is not running — open the Jax app, then try again."
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return nil, "The Jax MCP token doesn't match — in Jax open Settings → AI → Anthropic and press “Connect Claude Code & Claude Desktop” again, then restart this Claude app."
	case resp.StatusCode == http.StatusAccepted, resp.StatusCode == http.StatusNoContent:
		return nil, ""
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Sprintf("Jax MCP server error (HTTP %d)", resp.StatusCode)
	}
	body, err = io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, "could not read the response: " + err.Error()
	}
	return body, ""
}

// readMCPRuntimeURL loads the running app's MCP endpoint from ~/.jax/mcp.json.
func readMCPRuntimeURL() (string, error) {
	path, err := mcpRuntimePath()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var rt mcpRuntime
	if err := json.Unmarshal(raw, &rt); err != nil || rt.URL == "" {
		return "", fmt.Errorf("invalid MCP runtime file")
	}
	return rt.URL, nil
}

// writeRPCErrorLine emits a JSON-RPC error response for id on stdout.
func writeRPCErrorLine(out *bufio.Writer, id json.RawMessage, message string) {
	resp := rpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &rpcError{Code: rpcCodeInternal, Message: message},
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		return
	}
	out.Write(raw)
	out.WriteByte('\n')
	out.Flush()
}

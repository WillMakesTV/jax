package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// AI prompt runner
//
// askAI runs a (system instructions, input document) prompt on whichever AI
// service is connected — Anthropic when available (Claude Code headless or
// the Messages API), otherwise OpenAI (Codex non-interactive or the Chat
// Completions API). Feature code (outlines, plan descriptions, edit
// directions) stays provider-agnostic by going through here.
// ---------------------------------------------------------------------------

const (
	anthropicMessagesURL = "https://api.anthropic.com/v1/messages"
	anthropicAPIModel    = "claude-opus-4-8" // API-key mode; account mode uses Claude Code's default
	openaiChatURL        = "https://api.openai.com/v1/chat/completions"
	openaiAPIModel       = "gpt-5.1" // API-key mode; account mode uses Codex's default
)

// Generation can take minutes on long inputs; the shared 20s client is far
// too tight. Callers bound each run with their own context deadline.
var aiHTTP = &http.Client{Timeout: 5 * time.Minute}

// aiConn resolves which AI service a prompt runs on: Anthropic when
// connected (the original provider, kept first for continuity), else OpenAI.
func (a *App) aiConn() (string, serviceConn, error) {
	if conn, ok := a.getConn(anthropicService); ok {
		return anthropicService, conn, nil
	}
	if conn, ok := a.getConn(openaiService); ok {
		return openaiService, conn, nil
	}
	return "", serviceConn{}, fmt.Errorf("connect an AI service (Anthropic or OpenAI) in Settings → AI first")
}

// claudeMCPArgs builds the flags that attach the app's own MCP server to a
// Claude Code headless run — the same url+token the Settings MCP feature
// registers with Claude clients — scoped to an explicit read-tool allowlist.
// --strict-mcp-config keeps the run from loading the user's other configured
// servers: their tools surface but no permission prompt can be answered
// non-interactively, so the model sees nothing but denials and refuses.
// Returns nil when the app's MCP server is not running.
func (a *App) claudeMCPArgs(allowedTools string) []string {
	url := a.getMCPURL()
	token := a.getMCPToken()
	if url == "" || token == "" {
		return nil
	}
	cfg := map[string]any{
		"mcpServers": map[string]any{
			mcpServerName: map[string]any{
				"type":    "http",
				"url":     url,
				"headers": map[string]string{"Authorization": "Bearer " + token},
			},
		},
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return nil
	}
	dir, err := dataDir()
	if err != nil {
		return nil
	}
	// The file carries the bearer token; keep it private and rewrite it per
	// run (the port changes every app start).
	path := filepath.Join(dir, "headless_mcp.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return nil
	}
	return []string{
		"--mcp-config", path,
		"--strict-mcp-config",
		"--allowedTools", allowedTools,
	}
}

// askAI runs a system+input prompt on the connected AI service. Returns the
// raw response text and a model label for display/storage. claudeArgs extend
// a Claude Code (account-mode) invocation — typically claudeMCPArgs to grant
// the app's read tools; with none, the run is isolated from every MCP config
// so unanswerable permission prompts can't derail it. Other providers answer
// from the prompt alone.
func (a *App) askAI(ctx context.Context, system, input string, claudeArgs ...string) (text, model string, err error) {
	service, conn, err := a.aiConn()
	if err != nil {
		return "", "", err
	}
	switch {
	case service == anthropicService && conn.login == anthropicModeAPIKey:
		return a.askClaudeAPI(ctx, system, input)
	case service == anthropicService:
		if len(claudeArgs) == 0 {
			claudeArgs = []string{"--strict-mcp-config"}
		}
		text, err = askClaudeCode(ctx, system, input, claudeArgs...)
		return text, "Claude Code", err
	case conn.login == openaiModeAPIKey:
		return a.askOpenAIAPI(ctx, system, input)
	default:
		text, err = askCodex(ctx, system, input)
		return text, "Codex", err
	}
}

// aiRunTimeout bounds one prompt. Account-mode runs go through a CLI that
// reads, thinks, and writes whole files (a widget's display, an outline), and
// those routinely run past the few minutes a plain API answer takes — cutting
// them off looked like a crash rather than a deadline (see askClaudeCode).
const aiRunTimeout = 10 * time.Minute

// askAIText is askAI with the common trim/empty handling and the default
// deadline, for callers that only want the text.
func (a *App) askAIText(system, input string, claudeArgs ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), aiRunTimeout)
	defer cancel()
	text, _, err := a.askAI(ctx, system, input, claudeArgs...)
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("the model returned no text — try again")
	}
	return text, nil
}

// askClaudeCode runs the prompt through Claude Code headless (subscription
// usage); the document goes in on stdin — it is far too large for an argv on
// Windows. extraArgs extend the invocation (e.g. attaching the app's MCP
// server for tool access).
func askClaudeCode(ctx context.Context, system, input string, extraArgs ...string) (string, error) {
	cmd, err := claudeHeadlessCmd(ctx, system, extraArgs...)
	if err != nil {
		return "", err
	}
	// A neutral working directory keeps Claude Code from picking up this
	// app's (or any) project context.
	cmd.Dir = os.TempDir()
	cmd.Stdin = strings.NewReader(input)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// Claude Code reports refusals and account limits on stdout, so it is
		// worth reading when stderr is silent.
		return "", aiRunError(ctx, "Claude Code", err, stderr.String(), stdout.String())
	}
	return stdout.String(), nil
}

// aiRunError explains a failed AI CLI run. A run killed by its deadline comes
// back as a plain exit status — on Windows exit code 1, with nothing on
// either stream — which reads as a crash, so it is named for what it is.
// Otherwise the most useful thing the process said wins, with the exit status
// as the last resort.
func aiRunError(ctx context.Context, name string, err error, details ...string) error {
	if ctx.Err() != nil {
		return fmt.Errorf("%s ran out of time — it did not answer before the deadline; try again, or ask for something smaller", name)
	}
	msg := strings.TrimSpace(firstNonEmpty(append(details, err.Error())...))
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return fmt.Errorf("%s could not respond: %s", name, msg)
}

// askClaudeAPI runs the prompt against the Messages API with the stored key.
func (a *App) askClaudeAPI(ctx context.Context, system, input string) (text, model string, err error) {
	headers, err := a.anthropicAuthHeaders()
	if err != nil {
		return "", "", err
	}
	body, err := json.Marshal(map[string]any{
		"model":      anthropicAPIModel,
		"max_tokens": 8192,
		"system":     system,
		"messages": []map[string]any{
			{"role": "user", "content": input},
		},
	})
	if err != nil {
		return "", "", err
	}
	headers["Content-Type"] = "application/json"
	raw, err := postAI(ctx, anthropicMessagesURL, headers, body, "Anthropic")
	if err != nil {
		return "", "", err
	}

	var r struct {
		Model   string `json:"model"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return "", "", err
	}
	var b strings.Builder
	for _, block := range r.Content {
		if block.Type == "text" {
			b.WriteString(block.Text)
		}
	}
	if b.Len() == 0 {
		return "", "", fmt.Errorf("the model returned no text (stop reason: %s)", r.StopReason)
	}
	return b.String(), firstNonEmpty(r.Model, anthropicAPIModel), nil
}

// askCodex runs the prompt through Codex non-interactive (`codex exec`) so
// usage draws on the ChatGPT subscription. Codex takes one prompt (no
// separate system channel) that can exceed Windows argv limits, so the
// combined document goes in on stdin ("-"); the final message is read from a
// temp file (--output-last-message) because stdout carries the session log.
func askCodex(ctx context.Context, system, input string) (string, error) {
	outFile, err := os.CreateTemp("", "jax-codex-*.txt")
	if err != nil {
		return "", err
	}
	outPath := outFile.Name()
	_ = outFile.Close()
	defer os.Remove(outPath)

	cmd, err := codexHeadlessCmd(ctx, "-", "--output-last-message", outPath)
	if err != nil {
		return "", err
	}
	// A neutral working directory keeps Codex from picking up this app's (or
	// any) project context.
	cmd.Dir = os.TempDir()
	cmd.Stdin = strings.NewReader(system + "\n\n---\n\n" + input)
	// Codex reports failures (auth refresh, network) as "ERROR:" lines in the
	// session log on stdout, not on stderr — keep both for error reporting.
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		return "", aiRunError(ctx, "Codex", err, codexErrorDetail(output.String(), err.Error()))
	}
	raw, err := os.ReadFile(outPath)
	if err != nil {
		return "", fmt.Errorf("Codex left no response: %v", err)
	}
	return string(raw), nil
}

// codexErrorDetail pulls the most useful part of a failed run's output: the
// last "ERROR:" line of the session log, else the output's tail.
func codexErrorDetail(log, fallback string) string {
	lines := strings.Split(log, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); strings.HasPrefix(line, "ERROR:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "ERROR:"))
		}
	}
	msg := firstNonEmpty(strings.TrimSpace(log), fallback)
	if len(msg) > 300 {
		msg = msg[len(msg)-300:]
	}
	return msg
}

// askOpenAIAPI runs the prompt against the Chat Completions API with the
// stored key.
func (a *App) askOpenAIAPI(ctx context.Context, system, input string) (text, model string, err error) {
	headers, err := a.openaiAuthHeaders()
	if err != nil {
		return "", "", err
	}
	body, err := json.Marshal(map[string]any{
		"model": openaiAPIModel,
		"messages": []map[string]any{
			{"role": "system", "content": system},
			{"role": "user", "content": input},
		},
	})
	if err != nil {
		return "", "", err
	}
	headers["Content-Type"] = "application/json"
	raw, err := postAI(ctx, openaiChatURL, headers, body, "OpenAI")
	if err != nil {
		return "", "", err
	}

	var r struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return "", "", err
	}
	if len(r.Choices) == 0 || strings.TrimSpace(r.Choices[0].Message.Content) == "" {
		reason := ""
		if len(r.Choices) > 0 {
			reason = r.Choices[0].FinishReason
		}
		return "", "", fmt.Errorf("the model returned no text (finish reason: %s)", reason)
	}
	return r.Choices[0].Message.Content, firstNonEmpty(r.Model, openaiAPIModel), nil
}

// postAI POSTs a JSON body and returns the response body, shaping non-200s
// into short user-facing errors.
func postAI(ctx context.Context, url string, headers map[string]string, body []byte, provider string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := aiHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach the %s API: %v", provider, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		msg := string(raw)
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("%s API error (%d): %s", provider, resp.StatusCode, msg)
	}
	return raw, nil
}

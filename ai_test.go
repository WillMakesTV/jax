package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// Prompts run on Anthropic when it is connected (the original provider),
// fall back to OpenAI, and error with a both-named message when neither is.
func TestAIConnPrefersAnthropicThenOpenAI(t *testing.T) {
	a := &App{}

	if _, _, err := a.aiConn(); err == nil {
		t.Fatal("want an error when no AI service is connected")
	}

	a.conns = map[string]serviceConn{
		openaiService: {login: openaiModeAccount, account: "chatgpt"},
	}
	service, conn, err := a.aiConn()
	if err != nil || service != openaiService || conn.account != "chatgpt" {
		t.Fatalf("openai only: got (%q, %+v, %v)", service, conn, err)
	}

	a.conns[anthropicService] = serviceConn{login: anthropicModeAccount, account: "claude"}
	service, conn, err = a.aiConn()
	if err != nil || service != anthropicService || conn.account != "claude" {
		t.Fatalf("both connected: got (%q, %+v, %v), want anthropic", service, conn, err)
	}
}

// A run killed by its deadline arrives as a bare exit status (exit code 1 on
// Windows) with empty streams; it reads as a timeout, not a crash. Otherwise
// whatever the process said wins, stderr before stdout.
func TestAIRunErrorNamesTheDeadline(t *testing.T) {
	expired, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	err := aiRunError(expired, "Claude Code", errors.New("exit status 1"), "", "")
	if !strings.Contains(err.Error(), "ran out of time") {
		t.Fatalf("timed-out run: %v", err)
	}

	live := context.Background()
	err = aiRunError(live, "Claude Code", errors.New("exit status 1"), "", "Credit balance is too low")
	if want := "Claude Code could not respond: Credit balance is too low"; err.Error() != want {
		t.Fatalf("stdout detail: got %q, want %q", err, want)
	}
	err = aiRunError(live, "Codex", errors.New("exit status 2"), "  ", "")
	if want := "Codex could not respond: exit status 2"; err.Error() != want {
		t.Fatalf("no detail: got %q, want %q", err, want)
	}
	err = aiRunError(live, "Claude Code", errors.New("exit status 1"), strings.Repeat("x", 400))
	if got := len(err.Error()); got > 340 {
		t.Fatalf("detail not truncated: %d chars", got)
	}
}

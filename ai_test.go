package main

import "testing"

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

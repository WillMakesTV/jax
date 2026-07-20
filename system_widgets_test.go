package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSystemWidgets(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"

	// The catalog ships enabled, with a served source address.
	widgets := a.GetSystemWidgets()
	if len(widgets) == 0 {
		t.Fatal("the system widget catalog should not be empty")
	}
	chat := widgets[0]
	if chat.ID != systemWidgetUnifiedChat || !chat.Enabled {
		t.Fatalf("unified chat should lead the catalog, enabled: %+v", chat)
	}
	if chat.SourceURL != "http://127.0.0.1:9999/syswidget/unified-chat" {
		t.Fatalf("source URL mismatch: %q", chat.SourceURL)
	}

	// Unknown ids are refused; a real one toggles and persists.
	if _, err := a.SetSystemWidgetEnabled("nope", false); err == nil {
		t.Fatal("want error for an unknown system widget")
	}
	updated, err := a.SetSystemWidgetEnabled(systemWidgetUnifiedChat, false)
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if updated[0].Enabled {
		t.Fatalf("unified chat should read disabled: %+v", updated[0])
	}
	if a.systemWidgetEnabled(systemWidgetUnifiedChat) {
		t.Fatal("systemWidgetEnabled should report the switch-off")
	}
	if _, err := a.SetSystemWidgetEnabled(systemWidgetUnifiedChat, true); err != nil {
		t.Fatalf("re-enable: %v", err)
	}
	if !a.systemWidgetEnabled(systemWidgetUnifiedChat) {
		t.Fatal("unified chat should be back on")
	}
}

func TestUnifiedChatEndpoints(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	// The page and the data feed serve while the widget is enabled.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/unified-chat", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Unified Chat") {
		t.Fatalf("page: code %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/unified-chat/data", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "messages") {
		t.Fatalf("data: code %d body %q", rec.Code, rec.Body.String())
	}

	// Sending is POST-only.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/unified-chat/send", nil))
	if rec.Code != 405 {
		t.Fatalf("GET send: code %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/syswidget/unified-chat/send",
		strings.NewReader(`{"message": "hello"}`)))
	if rec.Code != 200 {
		t.Fatalf("POST send: code %d", rec.Code)
	}

	// Unknown widgets 404, and disabling 404s the whole widget.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/nope", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown widget: code %d", rec.Code)
	}
	if _, err := a.SetSystemWidgetEnabled(systemWidgetUnifiedChat, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/unified-chat", nil))
	if rec.Code != 404 {
		t.Fatalf("disabled widget page: code %d", rec.Code)
	}
}

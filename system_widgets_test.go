package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestSponsorsWidgetEndpoints(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	if _, err := a.SaveSponsor(Sponsor{Name: "Acme", Website: "https://acme.example"}); err != nil {
		t.Fatalf("save sponsor: %v", err)
	}

	// The page serves, and the feed carries the sponsor's name and website.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/sponsors", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Sponsors") {
		t.Fatalf("page: code %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/sponsors/data", nil))
	if rec.Code != 200 {
		t.Fatalf("data: code %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"Acme"`) || !strings.Contains(body, "acme.example") {
		t.Fatalf("data should carry the sponsor: %q", body)
	}

	// Unknown actions 404, and disabling 404s the whole widget.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/sponsors/nope", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown action: code %d", rec.Code)
	}
	if _, err := a.SetSystemWidgetEnabled(systemWidgetSponsors, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/sponsors", nil))
	if rec.Code != 404 {
		t.Fatalf("disabled widget page: code %d", rec.Code)
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

	// The data feed reports whether a stream session is on the air.
	if !strings.Contains(rec.Body.String(), "sessionActive") {
		t.Fatalf("data should carry sessionActive: %q", rec.Body.String())
	}

	// The user card endpoint answers even for unknown chatters (empty
	// history, an info error for the unconnected platform).
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET",
		"/syswidget/unified-chat/user?platform=twitch&login=someone", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "messages") {
		t.Fatalf("user: code %d body %q", rec.Code, rec.Body.String())
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

func TestIssueTrackerEndpoints(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	// Empty queue: the page serves and the feed is an empty list.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Issue Tracker") {
		t.Fatalf("page: code %d", rec.Code)
	}
	// The data feed renders through the widget display pipeline: a template
	// (the built-in default here, no custom Issue Tracker widget) and an
	// empty item list.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker/data", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"items":[]`) ||
		!strings.Contains(rec.Body.String(), `"template":`) {
		t.Fatalf("empty data: %q", rec.Body.String())
	}

	// A filed report shows up right away, Queued; a checked-out one reads
	// Working; recording an issue number reads Working #N. The values are
	// keyed by the display's Message/Status labels.
	queued, err := a.SaveDebugReport(DebugReport{Description: "cards overflow"})
	if err != nil {
		t.Fatalf("file report: %v", err)
	}
	claimed, _ := a.SaveDebugReport(DebugReport{Description: "banner clips"})
	if _, err := a.CheckOutDebugReport(claimed.ID); err != nil {
		t.Fatalf("check out: %v", err)
	}
	withIssue, _ := a.SaveDebugReport(DebugReport{Description: "needs a fix"})
	withIssue.IssueNumber = 42
	if _, err := a.SaveDebugReport(withIssue); err != nil {
		t.Fatalf("record issue: %v", err)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker/data", nil))
	body := rec.Body.String()
	for _, want := range []string{
		"cards overflow", `"Status":"Queued"`,
		"banner clips", `"Status":"Working"`,
		"needs a fix", `"Status":"Working #42"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("data missing %q:\n%s", want, body)
		}
	}
	// Working items sit above queued ones, and the oldest working leads: the
	// claimed "banner clips" comes before the issue-opened "needs a fix",
	// both above the still-queued "cards overflow".
	iBanner := strings.Index(body, "banner clips")
	iFix := strings.Index(body, "needs a fix")
	iCards := strings.Index(body, "cards overflow")
	if !(iBanner < iFix && iFix < iCards) {
		t.Fatalf("order should be working-first, oldest-first:\n%s", body)
	}
	_ = queued

	// Disabling the widget 404s its page, like the rest of the catalog.
	if _, err := a.SetSystemWidgetEnabled(systemWidgetIssueTracker, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker", nil))
	if rec.Code != 404 {
		t.Fatalf("disabled page: code %d", rec.Code)
	}
}
func TestActiveProjectWidget(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	// With no custom widget, the page serves and the data carries the
	// built-in default display.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/active-project", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Active Project") {
		t.Fatalf("page: code %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/active-project/data", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "apw-project") {
		t.Fatalf("default data: %q", rec.Body.String())
	}

	// A producer "Active Project" widget is adopted, and snapshotted so it
	// survives the widget's deletion.
	cw, err := a.SaveStreamWidget(StreamWidget{
		Name:     "Active Project",
		Template: "<div className=\"apx\">{widget.name}</div>",
		CSS:      ".apx { color: teal; }",
	})
	if err != nil {
		t.Fatalf("save custom widget: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/active-project/data", nil))
	if !strings.Contains(rec.Body.String(), "teal") {
		t.Fatalf("data should adopt the custom widget: %q", rec.Body.String())
	}

	// Delete the custom widget: the snapshot keeps the adopted look.
	if err := a.DeleteStreamWidget(cw.ID); err != nil {
		t.Fatalf("delete custom widget: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/active-project/data", nil))
	if !strings.Contains(rec.Body.String(), "teal") {
		t.Fatalf("snapshot should survive deletion: %q", rec.Body.String())
	}
}

func TestEventFeedEndpoints(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	// The page serves; with no events the feed is an empty group list.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/event-feed", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Event Feed") {
		t.Fatalf("page: code %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/event-feed/data", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"groups":[]`) {
		t.Fatalf("empty data: %q", rec.Body.String())
	}

	// A stream in the history, with events inside its window, becomes one
	// group named for that stream.
	startedAt := "2026-07-01T12:00:00Z"
	start, _ := time.Parse(time.RFC3339, startedAt)
	raw, err := json.Marshal([]PastBroadcast{{
		Platform: "youtube", Title: "Launch stream", URL: "https://youtu.be/l",
		StartedAt: startedAt, DurationSecs: 3600,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.store.setCacheEntry(a.connsCacheKey("past_broadcasts"), string(raw)); err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.saveLiveEvents([]StoredLiveEvent{
		{Platform: "twitch", ID: "f1", Type: "follow", Author: "Ann",
			Detail: "followed", At: start.Add(10 * time.Minute).UnixMilli()},
	}); err != nil {
		t.Fatalf("save events: %v", err)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/event-feed/data", nil))
	body := rec.Body.String()
	if !strings.Contains(body, "Launch stream") || !strings.Contains(body, `"author":"Ann"`) {
		t.Fatalf("feed should group the event under its stream: %q", body)
	}

	// Disabling 404s the page.
	if _, err := a.SetSystemWidgetEnabled(systemWidgetEventFeed, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/event-feed", nil))
	if rec.Code != 404 {
		t.Fatalf("disabled page: code %d", rec.Code)
	}
}

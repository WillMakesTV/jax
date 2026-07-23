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
func TestSystemWidgetDisplayEditable(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	// Every system widget is editable; the template-driven ones through a JSX
	// template, the bespoke overlays through page CSS/JS injection.
	kind := map[string]string{}
	for _, sw := range a.GetSystemWidgets() {
		if !sw.Editable {
			t.Fatalf("every system widget should be editable: %q", sw.ID)
		}
		kind[sw.ID] = sw.DisplayKind
	}
	if kind[systemWidgetIssueTracker] != displayKindTemplate ||
		kind[systemWidgetActiveProject] != displayKindTemplate {
		t.Fatal("issue tracker and active project should be template widgets")
	}
	if kind[systemWidgetUnifiedChat] != displayKindPage ||
		kind[systemWidgetSponsors] != displayKindPage ||
		kind[systemWidgetEventFeed] != displayKindPage {
		t.Fatal("the bespoke overlays should be page widgets")
	}

	// A page widget's display reports its kind and no default template.
	pd, err := a.GetSystemWidgetDisplay(systemWidgetUnifiedChat)
	if err != nil {
		t.Fatalf("get page display: %v", err)
	}
	if pd.Kind != displayKindPage || pd.DefaultTemplate != "" {
		t.Fatalf("page widget display unexpected: %+v", pd)
	}
	// Its override CSS/JS is injected into the served overlay page.
	if _, err := a.SetSystemWidgetDisplay(systemWidgetUnifiedChat, "", ".x{color:red}", "console.log('hi')"); err != nil {
		t.Fatalf("set page display: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/unified-chat", nil))
	body := rec.Body.String()
	if !strings.Contains(body, ".x{color:red}") || !strings.Contains(body, "console.log('hi')") {
		t.Fatalf("page override should be injected into the overlay:\n%s", body)
	}
	// Clearing it returns the untouched page.
	if _, err := a.ResetSystemWidgetDisplay(systemWidgetUnifiedChat); err != nil {
		t.Fatalf("reset page: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/unified-chat", nil))
	if strings.Contains(rec.Body.String(), ".x{color:red}") {
		t.Fatalf("reset should drop the page override")
	}

	// The editable widget starts on its built-in default, uncustomized.
	disp, err := a.GetSystemWidgetDisplay(systemWidgetIssueTracker)
	if err != nil {
		t.Fatalf("get display: %v", err)
	}
	if disp.Customized || disp.Template != disp.DefaultTemplate {
		t.Fatalf("should start on the built-in default: %+v", disp.Customized)
	}

	// A saved override drives the served display and flags the widget
	// customized in the catalog.
	const mine = `<div className="mine">{items.length}</div>`
	if _, err := a.SetSystemWidgetDisplay(systemWidgetIssueTracker, mine, ".mine{color:red}", "// none"); err != nil {
		t.Fatalf("set display: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker/data", nil))
	if body := rec.Body.String(); !strings.Contains(body, `class=\"mine\"`) &&
		!strings.Contains(body, "mine") {
		t.Fatalf("served display should carry the override:\n%s", body)
	}
	customized := false
	for _, sw := range a.GetSystemWidgets() {
		if sw.ID == systemWidgetIssueTracker {
			customized = sw.Customized
		}
	}
	if !customized {
		t.Fatal("the catalog should report the widget customized")
	}

	// Reset drops the override and returns the built-in default to the feed.
	if _, err := a.ResetSystemWidgetDisplay(systemWidgetIssueTracker); err != nil {
		t.Fatalf("reset: %v", err)
	}
	after, _ := a.GetSystemWidgetDisplay(systemWidgetIssueTracker)
	if after.Customized || after.Template != after.DefaultTemplate {
		t.Fatalf("reset should return to the default: %+v", after)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker/data", nil))
	if strings.Contains(rec.Body.String(), "mine") {
		t.Fatalf("reset display should drop the override:\n%s", rec.Body.String())
	}
}

func TestSystemWidgetAssets(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	// Assets are image/sound only, and each needs a name.
	if _, err := a.AddSystemWidgetField(systemWidgetIssueTracker, "field_message", "Nope"); err == nil {
		t.Fatal("want error adding a non-asset field type")
	}
	if _, err := a.AddSystemWidgetField(systemWidgetIssueTracker, "field_image", "  "); err == nil {
		t.Fatal("want error for an unnamed asset")
	}

	// Several assets of the same kind are allowed, told apart by name.
	if _, err := a.AddSystemWidgetField(systemWidgetIssueTracker, "field_image", "Logo"); err != nil {
		t.Fatalf("add image asset: %v", err)
	}
	fields, err := a.AddSystemWidgetField(systemWidgetIssueTracker, "field_image", "Badge")
	if err != nil {
		t.Fatalf("add second image asset: %v", err)
	}
	if len(fields) != 2 {
		t.Fatalf("want 2 assets, got %d", len(fields))
	}
	badgeID := fields[1].ID

	// A recorded file resolves to the widget's own folder URL and reaches the
	// served display as a field.
	filled, err := a.setSystemWidgetFieldFile(systemWidgetIssueTracker, badgeID, "field_1.png")
	if err != nil {
		t.Fatalf("set file: %v", err)
	}
	url := ""
	for _, f := range filled {
		if f.ID == badgeID {
			url = f.ValueURL
		}
	}
	if !strings.Contains(url, "/widgetfiles/issue-tracker/field_1.png") {
		t.Fatalf("asset URL wrong: %q", url)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker/data", nil))
	if body := rec.Body.String(); !strings.Contains(body, `"Badge"`) ||
		!strings.Contains(body, "field_1.png") {
		t.Fatalf("data should carry the asset field:\n%s", body)
	}

	// Removing one leaves the other.
	remaining, err := a.RemoveSystemWidgetField(systemWidgetIssueTracker, badgeID)
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if len(remaining) != 1 || remaining[0].Label != "Logo" {
		t.Fatalf("remove left the wrong set: %+v", remaining)
	}

	// Page widgets expose their assets to the injected overlay: images as a
	// CSS custom property, and every asset on window.jaxAssets.
	added, err := a.AddSystemWidgetField(systemWidgetUnifiedChat, "field_image", "Overlay BG")
	if err != nil {
		t.Fatalf("add page asset: %v", err)
	}
	if _, err := a.setSystemWidgetFieldFile(systemWidgetUnifiedChat, added[0].ID, "bg.png"); err != nil {
		t.Fatalf("set page file: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/unified-chat", nil))
	body := rec.Body.String()
	if !strings.Contains(body, "--asset-overlay-bg") || !strings.Contains(body, "window.jaxAssets") {
		t.Fatalf("page should expose its assets:\n%s", body)
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

func TestIssueTrackerShowsRecentCompletions(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	// A report resolved just now shows as Done with its finish time and how
	// long it took; one resolved long ago has aged off the board.
	now := time.Now().UTC()
	if _, err := a.store.insertFixNotice(FixNotice{
		ReportID: 1, Title: "fresh fix", IssueNumber: 7,
		CreatedAt:  now.Add(-5 * time.Minute).Format(time.RFC3339),
		ResolvedAt: now.Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("insert fresh: %v", err)
	}
	if _, err := a.store.insertFixNotice(FixNotice{
		ReportID: 2, Title: "old fix", IssueNumber: 8,
		ResolvedAt: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("insert old: %v", err)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/syswidget/issue-tracker/data", nil))
	body := rec.Body.String()
	if !strings.Contains(body, "fresh fix") || !strings.Contains(body, `"Status":"Done #7"`) {
		t.Fatalf("recent completion should show as Done: %s", body)
	}
	if !strings.Contains(body, `"Completed":`) || !strings.Contains(body, `"Started":`) {
		t.Fatalf("done item should carry its completion and start time: %s", body)
	}
	if strings.Contains(body, "old fix") {
		t.Fatalf("an aged-off completion should not show: %s", body)
	}
}

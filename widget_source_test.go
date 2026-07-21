package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseWidgetTemplate(t *testing.T) {
	got, err := parseWidgetTemplate("Here you go:\n```json\n" +
		`{"template": "<div>{widget.name}</div>", "css": "div{color:red}", "js": ""}` +
		"\n```")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Template != "<div>{widget.name}</div>" || got.CSS != "div{color:red}" {
		t.Fatalf("parse mismatch: %+v", got)
	}

	if _, err := parseWidgetTemplate("no json here"); err == nil {
		t.Fatal("want error for a response without JSON")
	}
	if _, err := parseWidgetTemplate(`{"template": "", "css": "x"}`); err == nil {
		t.Fatal("want error for an empty template")
	}
}

func TestParseWidgetTestItem(t *testing.T) {
	got, err := parseWidgetTestItem("Sure:\n```json\n" +
		`{"Status": "Live now", "Message": "Big moment"}` + "\n```")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got["Status"] != "Live now" || got["Message"] != "Big moment" {
		t.Fatalf("parse mismatch: %+v", got)
	}
	if _, err := parseWidgetTestItem("no json"); err == nil {
		t.Fatal("want error for a response without JSON")
	}
}

func TestWidgetTestStaging(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	a.GetWidgetFieldTypes() // seed the catalog

	w, err := a.SaveStreamWidget(StreamWidget{Name: "Goal"})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_status", "")
	if err != nil {
		t.Fatalf("add status field: %v", err)
	}
	w, err = a.setWidgetFieldFile(w.ID, w.Fields[0].ID, "Real value")
	if err != nil {
		t.Fatalf("set real value: %v", err)
	}
	fieldID := w.Fields[0].ID

	// An entry filed before the test stays put underneath the staged item.
	w, err = a.AddWidgetItem(w.ID, map[string]string{fieldID: "Existing entry"})
	if err != nil {
		t.Fatalf("add existing item: %v", err)
	}

	// Staging prepends the sample as a real item — joining what is already
	// on screen — and leaves the field's default (configuration) untouched.
	if err := a.stageWidgetTestItem(w.ID, map[string]string{fieldID: "Sample value"}); err != nil {
		t.Fatalf("stage test item: %v", err)
	}
	if got := a.getStreamWidgets(); got[0].Fields[0].Value != "Real value" {
		t.Fatalf("staging must not touch field defaults: %+v", got[0].Fields[0])
	}
	if got := a.getStreamWidgets(); len(got[0].Items) != 2 ||
		got[0].Items[0].Values[fieldID] != "Sample value" {
		t.Fatalf("staged item not prepended: %+v", got[0].Items)
	}

	// Re-staging before the restore fires swaps the staged item rather than
	// stacking a second one.
	if err := a.stageWidgetTestItem(w.ID, map[string]string{fieldID: "Second sample"}); err != nil {
		t.Fatalf("re-stage test item: %v", err)
	}
	if got := a.getStreamWidgets(); len(got[0].Items) != 2 ||
		got[0].Items[0].Values[fieldID] != "Second sample" {
		t.Fatalf("re-stage should swap the staged item: %+v", got[0].Items)
	}

	// The restore drops the staged item and reloads the source.
	a.restoreWidgetTest(w.ID)
	if got := a.getStreamWidgets(); len(got[0].Items) != 1 ||
		got[0].Items[0].Values[fieldID] != "Existing entry" {
		t.Fatalf("restore should drop only the staged item: %+v", got[0].Items)
	}
	if gen := a.widgetReloadGen(w.ID); gen != 1 {
		t.Fatalf("restore should reload the source once, gen = %d", gen)
	}
	// A second restore with nothing pending is a no-op.
	a.restoreWidgetTest(w.ID)
	if gen := a.widgetReloadGen(w.ID); gen != 1 {
		t.Fatalf("idle restore should not reload again, gen = %d", gen)
	}
}

func TestWidgetSourceEndpoints(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	a.GetWidgetFieldTypes() // seed the catalog

	w, err := a.SaveStreamWidget(StreamWidget{
		Name:     "Goal",
		Template: "<div>{fields['Status']}</div>",
		CSS:      "div{color:red}",
		JS:       "root.dataset.ready = '1'",
	})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_status", "")
	if err != nil {
		t.Fatalf("add status field: %v", err)
	}
	w, err = a.setWidgetFieldFile(w.ID, w.Fields[0].ID, "Live now")
	if err != nil {
		t.Fatalf("set status value: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_sound", "Alert")
	if err != nil {
		t.Fatalf("add sound field: %v", err)
	}
	w, err = a.setWidgetFieldFile(w.ID, w.Fields[1].ID, "ding.mp3")
	if err != nil {
		t.Fatalf("set sound value: %v", err)
	}

	h := mediaHandler{app: a}

	// The page renders for a real widget and 404s otherwise.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", widgetSourcePrefix+w.ID, nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "widget-css") {
		t.Fatalf("page: code %d body %q", rec.Code, rec.Body.String()[:80])
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", widgetSourcePrefix+"nope", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown widget page: code %d", rec.Code)
	}

	// The runtime assets are embedded and served.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", widgetSourcePrefix+"assets/react.js", nil))
	if rec.Code != 200 || rec.Body.Len() == 0 {
		t.Fatalf("react asset: code %d len %d", rec.Code, rec.Body.Len())
	}

	// The data feed carries template/css/js and label→value fields, with
	// file kinds resolved to served URLs.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", widgetSourcePrefix+w.ID+"/data", nil))
	if rec.Code != 200 {
		t.Fatalf("data: code %d", rec.Code)
	}
	var data widgetSourceData
	if err := json.Unmarshal(rec.Body.Bytes(), &data); err != nil {
		t.Fatalf("data decode: %v", err)
	}
	if data.Name != "Goal" || data.Template != "<div>{fields['Status']}</div>" ||
		data.CSS != "div{color:red}" || data.JS != "root.dataset.ready = '1'" {
		t.Fatalf("data mismatch: %+v", data)
	}
	if len(data.Fields) != 2 || data.Fields[0].Value != "Live now" {
		t.Fatalf("fields mismatch: %+v", data.Fields)
	}
	wantSound := "http://127.0.0.1:9999" + widgetFilesPrefix + w.ID + "/ding.mp3"
	if data.Fields[1].Kind != "sound" || data.Fields[1].Value != wantSound {
		t.Fatalf("sound field mismatch: %+v", data.Fields[1])
	}
	if data.Testing {
		t.Fatal("no test window should be open yet")
	}

	// A test window flips the feed's testing flag for its 15 seconds.
	if err := a.TestStreamWidget("nope"); err == nil {
		t.Fatal("want error testing an unknown widget")
	}
	if err := a.TestStreamWidget(w.ID); err != nil {
		t.Fatalf("test widget: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", widgetSourcePrefix+w.ID+"/data", nil))
	if err := json.Unmarshal(rec.Body.Bytes(), &data); err != nil {
		t.Fatalf("data decode after test: %v", err)
	}
	if !data.Testing {
		t.Fatal("the feed should report the open test window")
	}
	// An expired window reads as cleared.
	a.mu.Lock()
	a.widgetTests[w.ID] = time.Now().Add(-time.Second)
	a.mu.Unlock()
	if a.widgetTesting(w.ID) {
		t.Fatal("an expired test window should read as cleared")
	}

	// Clear is a one-shot action: each call bumps the feed's reload count,
	// which is what makes the page reload fresh.
	if err := a.ClearStreamWidget("nope"); err == nil {
		t.Fatal("want error clearing an unknown widget")
	}
	if data.Reload != 0 {
		t.Fatalf("no clears yet, reload = %d", data.Reload)
	}
	if err := a.ClearStreamWidget(w.ID); err != nil {
		t.Fatalf("clear widget: %v", err)
	}
	if err := a.ClearStreamWidget(w.ID); err != nil {
		t.Fatalf("clear widget again: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", widgetSourcePrefix+w.ID+"/data", nil))
	if err := json.Unmarshal(rec.Body.Bytes(), &data); err != nil {
		t.Fatalf("data decode after clear: %v", err)
	}
	if data.Reload != 2 {
		t.Fatalf("two clears should read as reload 2, got %d", data.Reload)
	}
	// Clear also empties the populated content: text values go, file-backed
	// assets (the sound's file) stay.
	raw := a.getStreamWidgets()
	if raw[0].Fields[0].Value != "" {
		t.Fatalf("clear should empty text values: %+v", raw[0].Fields[0])
	}
	if raw[0].Fields[1].Value != "ding.mp3" {
		t.Fatalf("clear should keep file-backed values: %+v", raw[0].Fields[1])
	}
}

// Any widget display can poll the app's own state under /widget/app/. The
// active-project feed carries the project's name and cover image, and reads
// empty rather than 404 when nothing is active.
func TestWidgetAppDataActiveProject(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	h := mediaHandler{app: a}

	get := func() map[string]string {
		t.Helper()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET",
			widgetSourcePrefix+widgetAppDataPrefix+"active-project", nil))
		if rec.Code != 200 {
			t.Fatalf("active-project: code %d", rec.Code)
		}
		var got map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return got
	}

	if got := get(); got["id"] != "" || got["title"] != "" {
		t.Fatalf("no project yet, got %+v", got)
	}

	p, err := a.SaveProject(Project{Title: "Chatter Bot v2"})
	if err != nil {
		t.Fatalf("save project: %v", err)
	}
	if _, err := a.SetProjectThumbnail(p.ID, "cover.png"); err != nil {
		t.Fatalf("set thumbnail: %v", err)
	}
	got := get()
	if got["id"] != p.ID || got["title"] != "Chatter Bot v2" {
		t.Fatalf("active project: %+v", got)
	}
	if want := "http://127.0.0.1:9999" + planThumbsPrefix + "cover.png"; got["imageUrl"] != want {
		t.Fatalf("image url: got %q want %q", got["imageUrl"], want)
	}

	// A second project only shows up once it takes the flag.
	other, err := a.SaveProject(Project{Title: "Launch"})
	if err != nil {
		t.Fatalf("save second: %v", err)
	}
	if _, err := a.SetActiveProject(other.ID); err != nil {
		t.Fatalf("set active: %v", err)
	}
	if got := get(); got["title"] != "Launch" {
		t.Fatalf("after switch: %+v", got)
	}

	// An unknown feed name 404s so a typo fails loudly.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET",
		widgetSourcePrefix+widgetAppDataPrefix+"nope", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown feed: code %d", rec.Code)
	}
}

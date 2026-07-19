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

	// The Clear toggle blanks the feed until the widget is shown again.
	if err := a.SetStreamWidgetCleared("nope", true); err == nil {
		t.Fatal("want error clearing an unknown widget")
	}
	if err := a.SetStreamWidgetCleared(w.ID, true); err != nil {
		t.Fatalf("clear widget: %v", err)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", widgetSourcePrefix+w.ID+"/data", nil))
	if err := json.Unmarshal(rec.Body.Bytes(), &data); err != nil {
		t.Fatalf("data decode after clear: %v", err)
	}
	if !data.Cleared {
		t.Fatal("the feed should report the widget cleared")
	}
	if ids := a.GetClearedStreamWidgets(); len(ids) != 1 || ids[0] != w.ID {
		t.Fatalf("cleared list mismatch: %v", ids)
	}
	if err := a.SetStreamWidgetCleared(w.ID, false); err != nil {
		t.Fatalf("show widget: %v", err)
	}
	if a.widgetIsCleared(w.ID) {
		t.Fatal("the widget should read as shown again")
	}
}

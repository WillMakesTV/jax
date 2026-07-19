package main

import (
	"strings"
	"testing"
)

func TestStreamWidgetsPublishDynamicSkills(t *testing.T) {
	a := newTestApp(t)

	w, err := a.SaveStreamWidget(StreamWidget{Name: "Follower goal"})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}

	skills, err := a.ListAppSkills()
	if err != nil {
		t.Fatalf("list skills: %v", err)
	}
	var widgetSkill *AppSkill
	for i := range skills {
		if skills[i].ID == widgetSkillID(w) {
			widgetSkill = &skills[i]
		}
	}
	if widgetSkill == nil {
		t.Fatalf("a stream widget should publish a dynamic skill %q", widgetSkillID(w))
	}
	if !strings.Contains(widgetSkill.Content, "Follower goal") {
		t.Fatalf("widget skill content should name the widget: %q", widgetSkill.Content)
	}

	// Dynamic skills override and reset like catalog skills.
	saved, err := a.SaveAppSkill(widgetSkill.ID, "custom widget brief")
	if err != nil {
		t.Fatalf("override widget skill: %v", err)
	}
	if !saved.Overridden || saved.Content != "custom widget brief" {
		t.Fatalf("override mismatch: %+v", saved)
	}
	reset, err := a.ResetAppSkill(widgetSkill.ID)
	if err != nil {
		t.Fatalf("reset widget skill: %v", err)
	}
	if reset.Overridden {
		t.Fatalf("reset should clear the override: %+v", reset)
	}

	// A deleted widget takes its skill out of the listing.
	if err := a.DeleteStreamWidget(w.ID); err != nil {
		t.Fatalf("delete widget: %v", err)
	}
	skills, err = a.ListAppSkills()
	if err != nil {
		t.Fatalf("list skills after delete: %v", err)
	}
	for _, s := range skills {
		if s.ID == widgetSkillID(w) {
			t.Fatal("deleted widget's skill should be gone")
		}
	}
}

func TestWidgetImageFieldValueURL(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"
	a.GetWidgetFieldTypes() // seed the catalog

	w, err := a.SaveStreamWidget(StreamWidget{Name: "Sponsor banner"})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_image")
	if err != nil {
		t.Fatalf("add image field: %v", err)
	}
	if len(w.Fields) != 1 || w.Fields[0].ValueURL != "" {
		t.Fatalf("an empty image field carries no URL: %+v", w.Fields)
	}

	// Recording a file yields a served URL on every read path.
	w, err = a.setWidgetFieldFile(w.ID, w.Fields[0].ID, "field_1.png")
	if err != nil {
		t.Fatalf("set field file: %v", err)
	}
	want := "http://127.0.0.1:9999" + widgetFilesPrefix + w.ID + "/field_1.png"
	if w.Fields[0].ValueURL != want {
		t.Fatalf("mutate URL = %q, want %q", w.Fields[0].ValueURL, want)
	}
	listed := a.GetStreamWidgets()
	if len(listed) != 1 || listed[0].Fields[0].ValueURL != want {
		t.Fatalf("listed URL mismatch: %+v", listed)
	}

	// The URL is derived, never persisted — a round-tripped save drops it,
	// and the raw stored record carries none.
	saved, err := a.SaveStreamWidget(listed[0])
	if err != nil {
		t.Fatalf("round-trip save: %v", err)
	}
	if saved.Fields[0].Value != "field_1.png" {
		t.Fatalf("round-trip should keep the file value: %+v", saved.Fields)
	}
	if raw := a.getStreamWidgets(); raw[0].Fields[0].ValueURL != "" {
		t.Fatalf("stored record should carry no URL: %+v", raw[0].Fields)
	}

	// Text fields never carry a URL, whatever their value.
	w, err = a.AddWidgetField(w.ID, "field_status")
	if err != nil {
		t.Fatalf("add status field: %v", err)
	}
	w, err = a.setWidgetFieldFile(w.ID, w.Fields[1].ID, "Live now")
	if err != nil {
		t.Fatalf("set status value: %v", err)
	}
	if w.Fields[1].ValueURL != "" {
		t.Fatalf("text fields carry no URL: %+v", w.Fields[1])
	}
}

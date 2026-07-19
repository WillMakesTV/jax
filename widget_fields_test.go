package main

import (
	"strings"
	"testing"
)

func TestWidgetFieldTypeDefaultsSeedOnce(t *testing.T) {
	a := newTestApp(t)

	types := a.GetWidgetFieldTypes()
	if len(types) != 4 {
		t.Fatalf("first read should seed 4 defaults, got %+v", types)
	}
	byID := map[string]WidgetFieldType{}
	for _, ft := range types {
		byID[ft.ID] = ft
	}
	if byID["field_image"].Kind != widgetFieldImage || byID["field_image"].MaxLength != 0 {
		t.Fatalf("image default mismatch: %+v", byID["field_image"])
	}
	if byID["field_message"].MaxLength != widgetMessageMaxLen {
		t.Fatalf("message default mismatch: %+v", byID["field_message"])
	}
	if byID["field_status"].MaxLength != widgetStatusMaxLen {
		t.Fatalf("status default mismatch: %+v", byID["field_status"])
	}
	if byID["field_sound"].Kind != widgetFieldSound || byID["field_sound"].MaxLength != 0 {
		t.Fatalf("sound default mismatch: %+v", byID["field_sound"])
	}

	// A deleted default stays deleted — the catalog only seeds when it has
	// never been stored at all.
	if err := a.DeleteWidgetFieldType("field_image"); err != nil {
		t.Fatalf("delete default: %v", err)
	}
	if got := a.GetWidgetFieldTypes(); len(got) != 3 {
		t.Fatalf("deleted default reseeded: %+v", got)
	}
	// The later-added sound default is no different once offered.
	if err := a.DeleteWidgetFieldType("field_sound"); err != nil {
		t.Fatalf("delete sound default: %v", err)
	}
	if got := a.GetWidgetFieldTypes(); len(got) != 2 {
		t.Fatalf("deleted sound default reseeded: %+v", got)
	}
}

func TestWidgetFieldSoundToppedUpOnce(t *testing.T) {
	a := newTestApp(t)

	// A catalog stored before the sound kind existed gets the new default
	// appended exactly once.
	old := defaultWidgetFieldTypes()[:3]
	if err := a.store.setJSON(keyWidgetFieldTypes, old); err != nil {
		t.Fatalf("store old catalog: %v", err)
	}
	types := a.GetWidgetFieldTypes()
	if len(types) != 4 || types[3].ID != "field_sound" {
		t.Fatalf("sound default should be topped up: %+v", types)
	}

	// Removing it afterwards sticks — the offer is one-time.
	if err := a.DeleteWidgetFieldType("field_sound"); err != nil {
		t.Fatalf("delete sound: %v", err)
	}
	if got := a.GetWidgetFieldTypes(); len(got) != 3 {
		t.Fatalf("sound default should stay deleted: %+v", got)
	}
}

func TestWidgetFieldTypeSaveValidation(t *testing.T) {
	a := newTestApp(t)
	a.GetWidgetFieldTypes() // seed

	if _, err := a.SaveWidgetFieldType(WidgetFieldType{Name: " ", Kind: widgetFieldStatus}); err == nil {
		t.Fatal("want error for a blank name")
	}
	if _, err := a.SaveWidgetFieldType(WidgetFieldType{Name: "X", Kind: "banner"}); err == nil {
		t.Fatal("want error for an unknown kind")
	}

	// Text kinds get their caps defaulted; image kinds carry none.
	ft, err := a.SaveWidgetFieldType(WidgetFieldType{Name: "Ticker", Kind: widgetFieldStatus})
	if err != nil {
		t.Fatalf("save field type: %v", err)
	}
	if ft.ID == "" || ft.MaxLength != widgetStatusMaxLen {
		t.Fatalf("status cap not defaulted: %+v", ft)
	}
	img, err := a.SaveWidgetFieldType(WidgetFieldType{Name: "Banner", Kind: widgetFieldImage, MaxLength: 42})
	if err != nil {
		t.Fatalf("save image type: %v", err)
	}
	if img.MaxLength != 0 {
		t.Fatalf("image kinds carry no cap: %+v", img)
	}

	if got := a.GetWidgetFieldTypes(); len(got) != 6 {
		t.Fatalf("want 4 defaults + 2 new, got %+v", got)
	}
}

func TestWidgetFieldTypesPublishDynamicSkills(t *testing.T) {
	a := newTestApp(t)
	a.GetWidgetFieldTypes() // seed

	skills, err := a.ListAppSkills()
	if err != nil {
		t.Fatalf("list skills: %v", err)
	}
	var imageSkill *AppSkill
	for i := range skills {
		if skills[i].ID == "widget-field-field_image" {
			imageSkill = &skills[i]
		}
	}
	if imageSkill == nil {
		t.Fatalf("image field type should publish a dynamic skill, got ids %v", func() []string {
			ids := make([]string, len(skills))
			for i, s := range skills {
				ids[i] = s.ID
			}
			return ids
		}())
	}
	if !strings.Contains(imageSkill.Content, "image or animation") {
		t.Fatalf("image skill content unexpected: %q", imageSkill.Content)
	}

	// Dynamic skills override and reset like catalog skills.
	saved, err := a.SaveAppSkill(imageSkill.ID, "custom brief")
	if err != nil {
		t.Fatalf("override dynamic skill: %v", err)
	}
	if !saved.Overridden || saved.Content != "custom brief" {
		t.Fatalf("override mismatch: %+v", saved)
	}
	reset, err := a.ResetAppSkill(imageSkill.ID)
	if err != nil {
		t.Fatalf("reset dynamic skill: %v", err)
	}
	if reset.Overridden {
		t.Fatalf("reset should clear the override: %+v", reset)
	}

	// A deleted field type takes its skill out of the listing.
	if err := a.DeleteWidgetFieldType("field_image"); err != nil {
		t.Fatalf("delete field type: %v", err)
	}
	skills, err = a.ListAppSkills()
	if err != nil {
		t.Fatalf("list skills after delete: %v", err)
	}
	for _, s := range skills {
		if s.ID == "widget-field-field_image" {
			t.Fatal("deleted field type's skill should be gone")
		}
	}
}

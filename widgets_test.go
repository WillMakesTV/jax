package main

import (
	"strings"
	"testing"
)

func TestStreamWidgetRoundTrip(t *testing.T) {
	a := newTestApp(t)

	if _, err := a.SaveStreamWidget(StreamWidget{Name: "  "}); err == nil {
		t.Fatal("want error for a blank name")
	}

	w, err := a.SaveStreamWidget(StreamWidget{Name: "Follower goal"})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}
	if w.ID == "" || w.CreatedAt == "" {
		t.Fatalf("save should assign id and createdAt, got %+v", w)
	}

	// Update in place.
	w.Name = "Sub goal"
	updated, err := a.SaveStreamWidget(w)
	if err != nil {
		t.Fatalf("update widget: %v", err)
	}
	if updated.ID != w.ID || updated.Name != "Sub goal" {
		t.Fatalf("update mismatch: %+v", updated)
	}

	all := a.GetStreamWidgets()
	if len(all) != 1 || all[0].Name != "Sub goal" {
		t.Fatalf("want the one saved widget, got %+v", all)
	}

	if err := a.DeleteStreamWidget(w.ID); err != nil {
		t.Fatalf("delete widget: %v", err)
	}
	if got := a.GetStreamWidgets(); len(got) != 0 {
		t.Fatalf("widget should be gone, got %+v", got)
	}
}

func TestWidgetFields(t *testing.T) {
	a := newTestApp(t)
	a.GetWidgetFieldTypes() // seed the type catalog

	w, err := a.SaveStreamWidget(StreamWidget{Name: "Goal"})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}

	if _, err := a.AddWidgetField(w.ID, "nope", ""); err == nil {
		t.Fatal("want error for an unknown field type")
	}

	w, err = a.AddWidgetField(w.ID, "field_status", "")
	if err != nil {
		t.Fatalf("add field: %v", err)
	}
	if len(w.Fields) != 1 || w.Fields[0].Label != "Status" || w.Fields[0].TypeID != "field_status" {
		t.Fatalf("field mismatch: %+v", w.Fields)
	}

	// A custom label lets several fields share a type; blank fell back to
	// the type's name above.
	w, err = a.AddWidgetField(w.ID, "field_status", "  Top donor ")
	if err != nil {
		t.Fatalf("add labelled field: %v", err)
	}
	if len(w.Fields) != 2 || w.Fields[1].Label != "Top donor" {
		t.Fatalf("custom label mismatch: %+v", w.Fields)
	}
	w, err = a.RemoveWidgetField(w.ID, w.Fields[1].ID)
	if err != nil {
		t.Fatalf("remove labelled field: %v", err)
	}

	// A value over the type's cap is rejected on save.
	w.Fields[0].Value = strings.Repeat("x", widgetStatusMaxLen+1)
	if _, err := a.SaveStreamWidget(w); err == nil {
		t.Fatal("want error for an over-cap value")
	}
	w.Fields[0].Value = "Building the parser"
	w, err = a.SaveStreamWidget(w)
	if err != nil {
		t.Fatalf("save with value: %v", err)
	}
	if w.Fields[0].Value != "Building the parser" {
		t.Fatalf("value not stored: %+v", w.Fields)
	}

	w, err = a.RemoveWidgetField(w.ID, w.Fields[0].ID)
	if err != nil {
		t.Fatalf("remove field: %v", err)
	}
	if len(w.Fields) != 0 {
		t.Fatalf("field should be gone, got %+v", w.Fields)
	}
}

func TestWidgetItems(t *testing.T) {
	a := newTestApp(t)
	a.GetWidgetFieldTypes() // seed the type catalog

	w, err := a.SaveStreamWidget(StreamWidget{Name: "Queue"})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_status", "")
	if err != nil {
		t.Fatalf("add status field: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_message", "")
	if err != nil {
		t.Fatalf("add message field: %v", err)
	}
	statusID, messageID := w.Fields[0].ID, w.Fields[1].ID
	w, err = a.setWidgetFieldFile(w.ID, messageID, "Default message")
	if err != nil {
		t.Fatalf("set default: %v", err)
	}

	// New items take passed values and inherit defaults for the rest.
	w, err = a.AddWidgetItem(w.ID, map[string]string{statusID: "Working #1"})
	if err != nil {
		t.Fatalf("add item: %v", err)
	}
	if len(w.Items) != 1 || w.Items[0].Values[statusID] != "Working #1" ||
		w.Items[0].Values[messageID] != "Default message" {
		t.Fatalf("item mismatch: %+v", w.Items)
	}
	if w.Items[0].ID == "" || w.Items[0].CreatedAt == "" {
		t.Fatalf("item identity missing: %+v", w.Items[0])
	}

	// Newest first; caps and unknown fields enforced.
	w, err = a.AddWidgetItem(w.ID, map[string]string{statusID: "Working #2"})
	if err != nil {
		t.Fatalf("add second item: %v", err)
	}
	if w.Items[0].Values[statusID] != "Working #2" {
		t.Fatalf("newest should lead: %+v", w.Items)
	}
	if _, err := a.AddWidgetItem(w.ID, map[string]string{"nope": "x"}); err == nil {
		t.Fatal("want error for an unknown field")
	}
	over := strings.Repeat("x", widgetStatusMaxLen+1)
	if _, err := a.AddWidgetItem(w.ID, map[string]string{statusID: over}); err == nil {
		t.Fatal("want error for an over-cap item value")
	}

	// Update merges only the passed fields; remove deletes.
	first := w.Items[1].ID
	w, err = a.UpdateWidgetItem(w.ID, first, map[string]string{statusID: "Done #1"})
	if err != nil {
		t.Fatalf("update item: %v", err)
	}
	if w.Items[1].Values[statusID] != "Done #1" ||
		w.Items[1].Values[messageID] != "Default message" {
		t.Fatalf("update mismatch: %+v", w.Items[1])
	}
	w, err = a.RemoveWidgetItem(w.ID, first)
	if err != nil {
		t.Fatalf("remove item: %v", err)
	}
	if len(w.Items) != 1 {
		t.Fatalf("item should be gone: %+v", w.Items)
	}
	if _, err := a.RemoveWidgetItem(w.ID, "nope"); err == nil {
		t.Fatal("want error removing an unknown item")
	}

	// Clear removes every item.
	if err := a.ClearStreamWidget(w.ID); err != nil {
		t.Fatalf("clear widget: %v", err)
	}
	if got := a.getStreamWidgets(); len(got[0].Items) != 0 {
		t.Fatalf("clear should remove items: %+v", got[0].Items)
	}

	// The label-keyed translation the MCP surface uses.
	byID, err := a.widgetValuesByID(w.ID, map[string]string{"Status": "hi"})
	if err != nil || byID[statusID] != "hi" {
		t.Fatalf("label translation mismatch: %v %v", byID, err)
	}
	if _, err := a.widgetValuesByID(w.ID, map[string]string{"Nope": "x"}); err == nil {
		t.Fatal("want error for an unknown label")
	}
}

func TestSetWidgetFieldValue(t *testing.T) {
	a := newTestApp(t)
	a.GetWidgetFieldTypes() // seed the type catalog

	w, err := a.SaveStreamWidget(StreamWidget{Name: "Goal"})
	if err != nil {
		t.Fatalf("save widget: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_status", "")
	if err != nil {
		t.Fatalf("add status field: %v", err)
	}
	w, err = a.AddWidgetField(w.ID, "field_image", "")
	if err != nil {
		t.Fatalf("add image field: %v", err)
	}

	// Text values set directly, respecting the type's cap.
	w, err = a.SetWidgetFieldValue(w.ID, w.Fields[0].ID, "Live now")
	if err != nil {
		t.Fatalf("set text value: %v", err)
	}
	if w.Fields[0].Value != "Live now" {
		t.Fatalf("value not stored: %+v", w.Fields[0])
	}
	over := strings.Repeat("x", widgetStatusMaxLen+1)
	if _, err := a.SetWidgetFieldValue(w.ID, w.Fields[0].ID, over); err == nil {
		t.Fatal("want error for an over-cap value")
	}

	// File-backed kinds are refused — their values are managed files.
	if _, err := a.SetWidgetFieldValue(w.ID, w.Fields[1].ID, "sneaky.png"); err == nil {
		t.Fatal("want error setting a file-backed field")
	}
	if _, err := a.SetWidgetFieldValue(w.ID, "nope", "x"); err == nil {
		t.Fatal("want error for an unknown field")
	}

	// ClearWidgetField empties any kind's value.
	w, err = a.setWidgetFieldFile(w.ID, w.Fields[1].ID, "art.png")
	if err != nil {
		t.Fatalf("set image value: %v", err)
	}
	w, err = a.ClearWidgetField(w.ID, w.Fields[1].ID)
	if err != nil {
		t.Fatalf("clear field: %v", err)
	}
	if w.Fields[1].Value != "" {
		t.Fatalf("field should be cleared: %+v", w.Fields[1])
	}
	if _, err := a.ClearWidgetField(w.ID, "nope"); err == nil {
		t.Fatal("want error clearing an unknown field")
	}
}

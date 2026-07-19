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

	if _, err := a.AddWidgetField(w.ID, "nope"); err == nil {
		t.Fatal("want error for an unknown field type")
	}

	w, err = a.AddWidgetField(w.ID, "field_status")
	if err != nil {
		t.Fatalf("add field: %v", err)
	}
	if len(w.Fields) != 1 || w.Fields[0].Label != "Status" || w.Fields[0].TypeID != "field_status" {
		t.Fatalf("field mismatch: %+v", w.Fields)
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

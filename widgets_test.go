package main

import "testing"

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

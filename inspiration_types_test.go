package main

import (
	"strings"
	"testing"
)

func TestInspirationTypesSeedAndSave(t *testing.T) {
	a := newTestApp(t)

	// The library seeds the two lenses the producer works with.
	types := a.GetInspirationTypes()
	if len(types) != 2 {
		t.Fatalf("seeded types = %+v, want 2", types)
	}
	byID := map[string]InspirationType{}
	for _, ty := range types {
		byID[ty.ID] = ty
	}
	if _, ok := byID["tips"]; !ok {
		t.Fatalf("missing the Tips type: %+v", types)
	}
	if editing, ok := byID["editing-style"]; !ok || editing.Brief == "" {
		t.Fatalf("missing the Editing Style type or its brief: %+v", types)
	}

	// A new type gets an id slugged from its name, and re-saving updates in
	// place rather than adding a second entry.
	made, err := a.SaveInspirationType(InspirationType{
		Name: "Thumbnail Craft", Summary: "How the frame sells the click.",
		Brief: "Study this channel for **thumbnails**.",
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if made.ID != "thumbnail-craft" || made.CreatedAt == "" {
		t.Fatalf("new type: %+v", made)
	}
	made.Summary = "Reworded."
	if _, err := a.SaveInspirationType(made); err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := a.GetInspirationTypes(); len(got) != 3 {
		t.Fatalf("updating should not add an entry: %+v", got)
	}
	if got, err := a.GetInspirationType("thumbnail-craft"); err != nil ||
		got.Summary != "Reworded." {
		t.Fatalf("lookup after update: %+v (%v)", got, err)
	}

	// A type with no name is a usage error.
	if _, err := a.SaveInspirationType(InspirationType{Name: "  "}); err == nil {
		t.Fatal("an unnamed type should be rejected")
	}
}

func TestInspirationTypeTagsSteerExtraction(t *testing.T) {
	a := newTestApp(t)

	lib := a.getInspiration()
	lib.Channels = append(lib.Channels, InspirationChannel{ID: "UC1", Name: "Maker"})
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save: %v", err)
	}

	// Untagged, the brief is the app-wide skill alone.
	base, err := a.takeawayInstructions("UC1")
	if err != nil {
		t.Fatalf("instructions: %v", err)
	}
	if strings.Contains(base, "What this channel is studied for") {
		t.Fatalf("an untagged channel should carry no lenses:\n%s", base)
	}

	// Tagged, each type's brief rides along.
	if _, err := a.SetInspirationChannelTypes("UC1", []string{"editing-style"}); err != nil {
		t.Fatalf("tag: %v", err)
	}
	tagged, err := a.takeawayInstructions("UC1")
	if err != nil {
		t.Fatalf("instructions: %v", err)
	}
	if !strings.Contains(tagged, "What this channel is studied for") ||
		!strings.Contains(tagged, "Editing Style") {
		t.Fatalf("the tagged lens should be appended:\n%s", tagged)
	}
	if !strings.HasPrefix(tagged, base) {
		t.Fatal("the lens should extend the base brief, not replace it")
	}

	// A channel override still carries the lenses.
	if _, err := a.SetInspirationChannelTakeaways("UC1", "Custom brief."); err != nil {
		t.Fatalf("override: %v", err)
	}
	custom, err := a.takeawayInstructions("UC1")
	if err != nil {
		t.Fatalf("instructions: %v", err)
	}
	if !strings.HasPrefix(custom, "Custom brief.") ||
		!strings.Contains(custom, "Editing Style") {
		t.Fatalf("override + lens: %s", custom)
	}

	// Deleting a type untags the channels that carried it.
	if err := a.DeleteInspirationType("editing-style"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	ch, err := a.GetInspirationChannel("UC1")
	if err != nil {
		t.Fatalf("channel: %v", err)
	}
	if len(ch.TypeIDs) != 0 {
		t.Fatalf("the deleted type should be untagged: %+v", ch.TypeIDs)
	}
}

// Every type publishes its brief as a skill, so it is editable in Settings
// and readable over MCP.
func TestInspirationTypeSkills(t *testing.T) {
	a := newTestApp(t)
	skills, err := a.ListAppSkills()
	if err != nil {
		t.Fatalf("skills: %v", err)
	}
	found := false
	for _, s := range skills {
		if s.ID != "inspiration-type-tips" {
			continue
		}
		found = true
		if !strings.Contains(s.Content, "how the work gets done") {
			t.Fatalf("the Tips skill should carry its brief:\n%s", s.Content)
		}
		if s.Title != "Inspiration type: Tips" {
			t.Fatalf("title = %q", s.Title)
		}
	}
	if !found {
		t.Fatal("the Tips type should publish a skill")
	}

	// The generic skill explaining what types are for ships too.
	if _, err := a.getAppSkill("inspiration-types"); err != nil {
		t.Fatalf("the generic types skill should exist: %v", err)
	}
}

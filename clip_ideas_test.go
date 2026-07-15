package main

import (
	"testing"
)

func storedIdeaSet(t *testing.T, a *App, startedAt, format string) ClipIdeaSet {
	t.Helper()
	set := ClipIdeaSet{
		StartedAt:   startedAt,
		Format:      format,
		GeneratedAt: "2026-07-14T12:00:00Z",
		Model:       "test",
		Ideas: []ClipIdea{
			{Title: "The peak", Hook: "The boss finally dies.", Script: "# Cut\nOpen at 1:02:11."},
			{Title: "The thread", Hook: "One build, all stream.", Script: "# Cut\nFollow the build."},
			{Title: "The teach", Hook: "How parries work.", Script: "# Cut\nLesson structure."},
		},
	}
	if err := a.store.setJSON(clipIdeasKey(startedAt, format), set); err != nil {
		t.Fatal(err)
	}
	return set
}

func TestGetClipIdeasRoundTrip(t *testing.T) {
	a := newTestApp(t)
	const startedAt = "2026-07-10T18:00:00Z"

	empty, err := a.GetClipIdeas(startedAt, "short")
	if err != nil {
		t.Fatal(err)
	}
	if empty.GeneratedAt != "" || len(empty.Ideas) != 0 {
		t.Fatalf("want empty set before generation, got %+v", empty)
	}

	want := storedIdeaSet(t, a, startedAt, "short")
	got, err := a.GetClipIdeas(startedAt, "short")
	if err != nil {
		t.Fatal(err)
	}
	if got.GeneratedAt != want.GeneratedAt || len(got.Ideas) != 3 {
		t.Fatalf("round trip mismatch: %+v", got)
	}
	// Sets are keyed per format.
	other, _ := a.GetClipIdeas(startedAt, "long")
	if other.GeneratedAt != "" {
		t.Fatalf("long-form set should be empty, got %+v", other)
	}
}

func TestChooseClipIdea(t *testing.T) {
	a := newTestApp(t)
	const startedAt = "2026-07-10T18:00:00Z"

	if _, err := a.ChooseClipIdea(startedAt, "Boss night", "short", 0); err == nil {
		t.Fatal("want error when no set is stored")
	}

	set := storedIdeaSet(t, a, startedAt, "short")
	if _, err := a.ChooseClipIdea(startedAt, "Boss night", "short", 99); err == nil {
		t.Fatal("want error for an out-of-range pick")
	}

	plan, err := a.ChooseClipIdea(startedAt, "Boss night", "short", 1)
	if err != nil {
		t.Fatalf("choose: %v", err)
	}
	if plan.ID == "" || plan.Title != set.Ideas[1].Title || plan.Format != "short" {
		t.Fatalf("plan = %+v", plan)
	}
	if len(plan.Streams) != 1 || plan.Streams[0].StartedAt != startedAt ||
		plan.Streams[0].Title != "Boss night" {
		t.Fatalf("source not fixed to the stream: %+v", plan.Streams)
	}
	// The chosen script is waiting on the Editor tab.
	if got := a.GetEditScript(plan.ID); got != set.Ideas[1].Script {
		t.Fatalf("edit script = %q, want the chosen idea's script", got)
	}
	// The set is consumed by the pick.
	after, _ := a.GetClipIdeas(startedAt, "short")
	if after.GeneratedAt != "" {
		t.Fatalf("idea set should be consumed, got %+v", after)
	}
	if _, err := a.ChooseClipIdea(startedAt, "Boss night", "short", 0); err == nil {
		t.Fatal("want error picking from a consumed set")
	}
}

func TestParseClipIdeas(t *testing.T) {
	set, err := parseClipIdeas("Here you go:\n```json\n" +
		`{"ideas":[{"title":"A","hook":"h","script":"s"},{"title":"","hook":"","script":""},{"title":"B","hook":"","script":"s2"}]}` +
		"\n```")
	if err != nil {
		t.Fatal(err)
	}
	// The empty idea is dropped; usable ones survive.
	if len(set.Ideas) != 2 || set.Ideas[0].Title != "A" || set.Ideas[1].Title != "B" {
		t.Fatalf("ideas = %+v", set.Ideas)
	}
	if _, err := parseClipIdeas("no json here"); err == nil {
		t.Fatal("want error for junk output")
	}
	if _, err := parseClipIdeas(`{"ideas":[]}`); err == nil {
		t.Fatal("want error for zero usable ideas")
	}
}

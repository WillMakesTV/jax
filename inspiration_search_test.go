package main

import (
	"strings"
	"testing"
)

// searchLibrary stores two studied videos with distinct vocabulary, so a
// query can only match one of them.
func searchLibrary(t *testing.T) *App {
	t.Helper()
	a := newTestApp(t)
	lib := a.getInspiration()
	lib.Channels = append(lib.Channels, InspirationChannel{ID: "UC1", Name: "Maker"})
	lib.Videos = append(lib.Videos,
		InspirationVideo{
			ID: "v1", ChannelID: "UC1", Status: inspirationReady,
			Title:       "Lighting a home studio",
			URL:         "https://www.youtube.com/watch?v=v1",
			Description: "Everything about softboxes and key lights.",
			Summary:     "How to light a desk setup on a budget.",
			Outline:     "## 0:30 — Key light\nPlace the key light camera left.\n\n## 2:00 — Fill\nBounce a fill card.",
			Beats: []InspirationBeat{
				{AtSecs: 30, Title: "Key light", Summary: "Softbox camera left at 45 degrees."},
			},
			Takeaways: []InspirationTakeaway{
				{Kind: "tip", Title: "Feather the softbox", Detail: "Aim past the subject.",
					Apply: "Try it on the desk setup.", AtSecs: 45},
			},
			Mentions: []InspirationMention{
				{Kind: "product", Name: "Aputure 120d", Detail: "The key light used.", AtSecs: 60},
			},
			Transcript: []InspirationLine{
				{AtSecs: 120, Text: "The softbox diffuses the highlight across the face."},
				{AtSecs: 300, Text: "A reflector fills the shadow side."},
			},
		},
		InspirationVideo{
			ID: "v2", ChannelID: "UC1", Status: inspirationReady,
			Title:   "Editing podcasts faster",
			URL:     "https://www.youtube.com/watch?v=v2",
			Summary: "Trimming silence and building templates.",
			Transcript: []InspirationLine{
				{AtSecs: 10, Text: "Silence detection removes the dead air."},
			},
		},
	)
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save: %v", err)
	}
	return a
}

func TestSearchInspirationRanksAndCites(t *testing.T) {
	a := searchLibrary(t)

	hits, err := a.SearchInspiration("softbox key light", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatal("no hits for a phrase the library clearly covers")
	}
	for _, h := range hits {
		if h.VideoID != "v1" {
			t.Fatalf("the podcast video should not match a lighting query: %+v", h)
		}
	}

	// Every hit names its source and points at the moment inside it.
	top := hits[0]
	if !strings.Contains(top.Citation, "Lighting a home studio") ||
		!strings.Contains(top.Citation, "Maker") {
		t.Fatalf("citation should name the video and channel: %q", top.Citation)
	}
	if top.AtSecs >= 0 && !strings.Contains(top.Citation, "t=") {
		t.Fatalf("a timestamped hit should link into the video: %q", top.Citation)
	}

	// The passages come from across the notes, not just the transcript.
	kinds := map[string]bool{}
	for _, h := range hits {
		kinds[h.Kind] = true
	}
	if len(kinds) < 2 {
		t.Fatalf("expected several kinds of passage, got %v", kinds)
	}

	// A term only the other video uses finds only the other video.
	hits, err = a.SearchInspiration("silence detection", 5)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 || hits[0].VideoID != "v2" {
		t.Fatalf("silence query should surface the podcast video: %+v", hits)
	}

	// Nothing studied covers this, and a query of only stop words is a
	// usage error rather than an empty result.
	if got, err := a.SearchInspiration("kayaking", 5); err != nil || len(got) != 0 {
		t.Fatalf("unrelated query = %+v (%v), want no hits", got, err)
	}
	if _, err := a.SearchInspiration("the and of", 5); err == nil {
		t.Fatal("a query of stop words should explain itself")
	}

	// The limit is honoured and capped.
	if got, _ := a.SearchInspiration("light", 2); len(got) > 2 {
		t.Fatalf("limit ignored: %d hits", len(got))
	}
}

func TestParseClockAndOutlineSections(t *testing.T) {
	cases := map[string]int{
		"## 0:30 — Key light":     30,
		"## 1:02:03 — Long one":   3723,
		"## No timestamp here":    -1,
		"### 12:00 — Halfway":     720,
		"plain text, no headings": -1,
	}
	for line, want := range cases {
		if got := parseClock(line); got != want {
			t.Errorf("parseClock(%q) = %d, want %d", line, got, want)
		}
	}

	sections := splitOutlineSections("## 0:30 — One\nbody\n\n## 2:00 — Two\nmore")
	if len(sections) != 2 || sections[0].atSecs != 30 || sections[1].atSecs != 120 {
		t.Fatalf("outline sections: %+v", sections)
	}
	// An outline with no headings is still one searchable passage.
	if got := splitOutlineSections("just prose"); len(got) != 1 || got[0].atSecs != -1 {
		t.Fatalf("headless outline: %+v", got)
	}
}

func TestChunkTranscriptWindows(t *testing.T) {
	lines := []InspirationLine{
		{AtSecs: 0, Text: "one"},
		{AtSecs: 10, Text: "two"},
		{AtSecs: 60, Text: "three"},
	}
	chunks := chunkTranscript(lines)
	if len(chunks) != 2 {
		t.Fatalf("chunks = %+v, want 2 windows", chunks)
	}
	if chunks[0].text != "one two" || chunks[0].atSecs != 0 {
		t.Fatalf("first window: %+v", chunks[0])
	}
	if chunks[1].atSecs != 60 {
		t.Fatalf("second window should start at the line that broke it: %+v", chunks[1])
	}
	if got := chunkTranscript(nil); len(got) != 0 {
		t.Fatalf("no transcript should produce no chunks: %+v", got)
	}
}

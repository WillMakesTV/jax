package main

import (
	"strings"
	"testing"
)

func TestVideoStyleSuggestAndStore(t *testing.T) {
	a := newTestApp(t)

	// With nothing studied there is nothing to build a style from.
	if got := a.SuggestVideoStyleTakeaways("fast cuts"); len(got) != 0 {
		t.Fatalf("empty library should suggest nothing: %+v", got)
	}
	if _, err := a.CreateVideoStyle("Fast Cuts", nil); err == nil {
		t.Fatal("want an error when the library has no takeaways")
	}

	lib := a.getInspiration()
	lib.Videos = append(lib.Videos,
		InspirationVideo{ID: "v1", Title: "Colour grading", Status: inspirationReady,
			Takeaways: []InspirationTakeaway{
				{Kind: "technique", Title: "Grade for skin first", Detail: "Warm the mids"},
			}},
		InspirationVideo{ID: "v2", Title: "Pacing", Status: inspirationReady,
			Takeaways: []InspirationTakeaway{
				{Kind: "technique", Title: "Cut on the beat", Detail: "Fast cuts under music"},
				{Kind: "hook", Title: "Open on the result", Apply: "Show the finish first"},
			}},
	)
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save library: %v", err)
	}

	// The name steers the ranking: the takeaway that speaks to it leads.
	got := a.SuggestVideoStyleTakeaways("fast cuts")
	if len(got) != 3 {
		t.Fatalf("every takeaway should be offered: %+v", got)
	}
	if got[0].Title != "Cut on the beat" {
		t.Fatalf("the matching takeaway should lead: %+v", got)
	}

	// A style stores its sources and starts out building; the run itself
	// needs the AI runner, so only the record is asserted here.
	style, err := a.saveVideoStyle(VideoStyle{
		Name: "Fast Cuts", Status: videoStyleBuilding,
		StatusDetail: videoStyleReadingDetail(len(got)), Sources: got,
	})
	if err != nil {
		t.Fatalf("save style: %v", err)
	}
	if style.ID == "" || style.CreatedAt == "" {
		t.Fatalf("save should assign an id and a created time: %+v", style)
	}
	if inFlight := a.VideoStylesInFlight(); len(inFlight) != 1 || inFlight[0].ID != style.ID {
		t.Fatalf("a building style should be in flight: %+v", inFlight)
	}
	if style.StatusDetail != "Reading 3 takeaways" {
		t.Fatalf("status detail = %q", style.StatusDetail)
	}

	// Editing keeps the build's own fields; deleting removes it.
	style.Name = "Fast Cuts v2"
	style.Sources = nil
	edited, err := a.SaveVideoStyle(style)
	if err != nil {
		t.Fatalf("edit style: %v", err)
	}
	if edited.Name != "Fast Cuts v2" || len(edited.Sources) != 3 {
		t.Fatalf("edit should keep the sources: %+v", edited)
	}
	if err := a.DeleteVideoStyle(style.ID); err != nil {
		t.Fatalf("delete style: %v", err)
	}
	if len(a.GetVideoStyles()) != 0 {
		t.Fatal("style not deleted")
	}
}

func TestParseVideoStyleAnswer(t *testing.T) {
	// The shape the model is asked for: the document plus our own directives.
	body, directives := parseVideoStyleAnswer(`Here you go:
{"body": "## What this style is\nFast.", "directives": [
  {"kind": " Pacing ", "title": " Cut on the beat ", "detail": " Hold nothing past its point. "},
  {"kind": "sound", "title": "", "detail": "dropped — no title"}
]}`)
	if body != "## What this style is\nFast." {
		t.Fatalf("body = %q", body)
	}
	if len(directives) != 1 {
		t.Fatalf("a titleless directive should be dropped: %+v", directives)
	}
	if directives[0].Kind != "pacing" || directives[0].Title != "Cut on the beat" ||
		directives[0].Detail != "Hold nothing past its point." {
		t.Fatalf("directive not normalised: %+v", directives[0])
	}

	// A model that answered in plain markdown still leaves a usable style.
	body, directives = parseVideoStyleAnswer("## What this style is\nSlow.\n")
	if body != "## What this style is\nSlow." || directives != nil {
		t.Fatalf("markdown fallback: %q %+v", body, directives)
	}
}

func TestVideoStyleContext(t *testing.T) {
	a := newTestApp(t)

	// No style on the plan (or an id that no longer resolves) adds nothing,
	// so a caller can append it unconditionally.
	if got := a.videoStyleContext(""); got != "" {
		t.Fatalf("no style should render nothing: %q", got)
	}
	if got := a.videoStyleContext("style_gone"); got != "" {
		t.Fatalf("an unknown style should render nothing: %q", got)
	}

	style, err := a.saveVideoStyle(VideoStyle{
		Name: "Fast Cuts", Status: videoStyleReady,
		Body: "## What this style is\nQuick.",
		Directives: []VideoStyleDirective{
			{Kind: "pacing", Title: "Cut on the beat", Detail: "Never hold past the point."},
		},
	})
	if err != nil {
		t.Fatalf("save style: %v", err)
	}
	got := a.videoStyleContext(style.ID)
	for _, want := range []string{
		"Fast Cuts", "## What this style is", "Directives",
		"[pacing] Cut on the beat — Never hold past the point.",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("style context missing %q:\n%s", want, got)
		}
	}
}

func TestEditPromptCarriesTheStyle(t *testing.T) {
	a := newTestApp(t)
	style, err := a.saveVideoStyle(VideoStyle{
		Name: "Fast Cuts", Status: videoStyleReady,
		Body: "## What this style is\nQuick.",
		Directives: []VideoStyleDirective{
			{Kind: "pacing", Title: "Cut on the beat", Detail: "Never hold past the point."},
		},
	})
	if err != nil {
		t.Fatalf("save style: %v", err)
	}

	// A plan with no style leaves the edit prompt free of a style block.
	plain := a.editPrompt(VideoPlan{Title: "Untitled", Format: "long"}, "")
	if strings.Contains(plain, "Video style") {
		t.Fatalf("a styleless plan should carry no style: %q", plain)
	}

	// A plan cut to the style hands the cut its directives, not just the
	// script that was written from it.
	styled := a.editPrompt(VideoPlan{Title: "Boss fight", Format: "long", StyleID: style.ID}, "")
	for _, want := range []string{"Video style: Fast Cuts", "Cut on the beat"} {
		if !strings.Contains(styled, want) {
			t.Fatalf("edit prompt missing %q:\n%s", want, styled)
		}
	}
}

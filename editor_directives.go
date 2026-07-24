package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

// ---------------------------------------------------------------------------
// Growth directives
//
// The Editor tab's "Build directives" reviews the takeaways most relevant to a
// plan's edit directions and spoken script — retrieved from the inspiration
// library's RAG (see takeaway_rag.go) — and distils them into a short list of
// concrete directives for the cut, chosen to grow the channel and hold the
// viewer. They save against the plan and ride along in the edit run's prompt,
// so the cut is actually held to them.
// ---------------------------------------------------------------------------

// EditDirective is one growth/engagement rule for a video's edit, synthesised
// from the takeaways that fit the plan. Like a video-style directive, it is
// written as what WE do — an instruction this cut follows or breaks.
type EditDirective struct {
	Kind   string `json:"kind"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// editDirectivesMaxTakeaways bounds the RAG pull that feeds the builder —
// enough breadth to cover the video without burying the model.
const editDirectivesMaxTakeaways = 16

// keyEditDirectives stores the planID → []EditDirective map.
const keyEditDirectives = "video_plan_edit_directives"

// editDirectives loads the saved directives. Never nil.
func (a *App) editDirectives() map[string][]EditDirective {
	m := map[string][]EditDirective{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyEditDirectives, &m); err != nil {
			log.Printf("jax: load edit directives: %v", err)
		}
	}
	if m == nil {
		return map[string][]EditDirective{}
	}
	return m
}

// GetEditDirectives returns a plan's saved growth directives ([] when none).
func (a *App) GetEditDirectives(planID string) []EditDirective {
	d := a.editDirectives()[planID]
	if d == nil {
		return []EditDirective{}
	}
	return d
}

// SaveEditDirectives persists a plan's growth directives.
func (a *App) SaveEditDirectives(planID string, directives []EditDirective) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	if directives == nil {
		directives = []EditDirective{}
	}
	all := a.editDirectives()
	all[planID] = directives
	return a.store.setJSON(keyEditDirectives, all)
}

// GenerateEditDirectives builds the plan's growth directives: it searches the
// takeaway library for the passages closest to this video's idea, directions,
// and script, then has the connected AI service turn the ones that genuinely
// apply into a focused list of instructions for the cut. The result is saved
// against the plan and returned.
func (a *App) GenerateEditDirectives(planID string) ([]EditDirective, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return nil, err
	}
	directions := strings.TrimSpace(a.GetEditScript(planID))
	script := strings.TrimSpace(a.GetVideoScript(planID))
	if directions == "" && script == "" {
		return nil, fmt.Errorf("write the edit directions or the spoken script first")
	}

	// The video's idea, directions, and script together make the retrieval
	// query, so the takeaways come back matched to what this cut actually is.
	query := strings.TrimSpace(strings.Join([]string{
		plan.Title, plan.Description, directions, script,
	}, "\n"))
	hits, err := a.SearchTakeaways(query, editDirectivesMaxTakeaways)
	if err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return nil, fmt.Errorf("no takeaways to build directives from — study some inspiration videos first")
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# Video\nTitle: %s\nFormat: %s form\n", plan.Title, plan.Format)
	fmt.Fprintf(&b, "%s\n", runtimeTarget(plan.Format))
	if strings.TrimSpace(plan.Description) != "" {
		fmt.Fprintf(&b, "Idea:\n%s\n", strings.TrimSpace(plan.Description))
	}
	if directions != "" {
		fmt.Fprintf(&b, "\n# The edit directions\n%s\n", directions)
	}
	if script != "" {
		fmt.Fprintf(&b, "\n# The spoken script\n%s\n", script)
	}
	b.WriteString("\n# Takeaways from the reference library (most relevant first)\n")
	for _, h := range hits {
		text := strings.TrimSpace(h.Text)
		if text == "" {
			continue
		}
		fmt.Fprintf(&b, "\n- %s", text)
		if h.Citation != "" {
			fmt.Fprintf(&b, "\n  (seen in %s)", h.Citation)
		}
	}

	written, err := a.askAIText(editDirectivesInstructions, b.String())
	if err != nil {
		return nil, err
	}
	directives := parseEditDirectives(written)
	if len(directives) == 0 {
		return nil, fmt.Errorf("the model returned no directives — try again")
	}
	if err := a.SaveEditDirectives(planID, directives); err != nil {
		return nil, err
	}
	return directives, nil
}

// parseEditDirectives reads the directive list out of the model's JSON answer,
// dropping any entry without a title.
func parseEditDirectives(text string) []EditDirective {
	var out struct {
		Directives []EditDirective `json:"directives"`
	}
	if err := json.Unmarshal([]byte(extractJSONObject(text)), &out); err != nil {
		return nil
	}
	kept := []EditDirective{}
	for _, d := range out.Directives {
		d.Title = strings.TrimSpace(d.Title)
		if d.Title == "" {
			continue
		}
		d.Kind = strings.TrimSpace(strings.ToLower(d.Kind))
		d.Detail = strings.TrimSpace(d.Detail)
		kept = append(kept, d)
	}
	return kept
}

// editDirectivesInstructions brief the model that turns takeaways into the
// cut's growth directives.
const editDirectivesInstructions = `You are a video producer deciding how to cut one specific video for maximum audience growth and engagement.

You are given the video's idea, its edit directions, its spoken script, and the takeaways your reference library has lifted from other creators' videos — ranked by how relevant they are to this video.

Your job: choose the takeaways that genuinely apply to THIS video and turn them into a focused list of directives — concrete instructions for this edit that will grow the channel and hold the viewer. Ignore takeaways that do not fit the material, and never pad the list. Prefer the moves that affect retention and shareability (the hook, pacing, payoff placement, packaging) over cosmetic ones.

Respond with one JSON object and nothing else — no preamble, no code fences:

{
  "directives": [{"kind": "<hook|pacing|structure|retention|packaging|sound|look|other>", "title": "<the instruction in a few words>", "detail": "<one or two sentences saying exactly what to do on this video, and why it helps growth>"}]
}

Write six to twelve directives, each one specific to this video's directions and script — name the actual beat, line, or moment it applies to where you can. Write in the second person as what WE do on this cut, never as what another creator did. Where the takeaways are vague, leave the directive out rather than inventing a number.`

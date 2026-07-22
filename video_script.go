package main

import (
	"fmt"
	"log"
	"strings"
)

// ---------------------------------------------------------------------------
// The spoken script
//
// A plan's edit directions (editor.go) say how the video is assembled: which
// source moments to use, in what order, what the cut is doing. They are not
// something anyone can read aloud.
//
// The script is the other half: the words the talent says, and what is on
// screen while they say them. It is written from the plan and its directions,
// stored beside them, and it is what the teleprompter shows while recording
// (see script_window.go). The two documents inform each other — the edit
// session is given both — but neither is the other.
// ---------------------------------------------------------------------------

// keyVideoScripts holds every plan's spoken script, keyed by plan id.
const keyVideoScripts = "video_plan_scripts"

// videoScripts reads the stored scripts. Never nil.
func (a *App) videoScripts() map[string]string {
	out := map[string]string{}
	if a.store == nil {
		return out
	}
	if _, err := a.store.getJSON(keyVideoScripts, &out); err != nil {
		log.Printf("jax: videoScripts: %v", err)
	}
	if out == nil {
		return map[string]string{}
	}
	return out
}

// GetVideoScript returns a plan's spoken script ("" when none).
func (a *App) GetVideoScript(planID string) string {
	return a.videoScripts()[planID]
}

// SaveVideoScript persists a plan's spoken script.
func (a *App) SaveVideoScript(planID, script string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	scripts := a.videoScripts()
	scripts[planID] = script
	return a.store.setJSON(keyVideoScripts, scripts)
}

// GenerateVideoScript drafts (or revises) the plan's spoken script and saves
// it. Notes carry the producer's feedback for a revision pass ("" for the
// first draft); the current script rides along, so a revision rewrites what
// is there rather than starting over.
func (a *App) GenerateVideoScript(planID, notes string) (string, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	b.WriteString("# Video\n")
	fmt.Fprintf(&b, "Title: %s\n", plan.Title)
	fmt.Fprintf(&b, "Format: %s form\n", plan.Format)
	fmt.Fprintf(&b, "%s\n", runtimeTarget(plan.Format))
	if len(plan.Tags) > 0 {
		fmt.Fprintf(&b, "Tags: %s\n", strings.Join(plan.Tags, ", "))
	}
	if idea := strings.TrimSpace(plan.Description); idea != "" {
		fmt.Fprintf(&b, "Idea (what this video is about — the script must deliver on it):\n%s\n", idea)
	}
	// The style the video is made to, when the plan names one: the words are
	// held to the same standard as the cut (see video_style.go).
	if style := a.videoStyleContext(plan.StyleID); style != "" {
		fmt.Fprintf(&b, "\n%s\n", style)
	}
	// The edit directions are the plan for the cut. The script is written to
	// fit them — the same beats, in the same order — without repeating them.
	if directions := strings.TrimSpace(a.GetEditScript(planID)); directions != "" {
		fmt.Fprintf(&b, "\n# The edit directions this script is spoken over\n%s\n", directions)
	}
	// The brand's outward links, so a sign-off names the real socials/site.
	if links := a.brandLinksText(); links != "" {
		fmt.Fprintf(&b, "\n%s\n", links)
	}
	if current := strings.TrimSpace(a.GetVideoScript(planID)); current != "" {
		fmt.Fprintf(&b, "\n# The script as it stands\n%s\n", current)
	}
	if strings.TrimSpace(notes) != "" {
		fmt.Fprintf(&b, "\n# Producer notes for this pass\n%s\n", strings.TrimSpace(notes))
	}

	script, err := a.askAIText(videoScriptInstructions, b.String())
	if err != nil {
		return "", err
	}
	if err := a.SaveVideoScript(planID, script); err != nil {
		return "", err
	}
	return script, nil
}

// videoScriptInstructions brief the model that writes the spoken script.
const videoScriptInstructions = `You are writing the shooting script for one video: the words the talent says to camera, and what is on screen while they say them.

This is not a plan and not a set of edit directions — those already exist and are given to you for context. Nobody can read a plan aloud. Every line you write is either something spoken word for word, or a note about what the viewer is looking at.

Respond with markdown and nothing else — no preamble, no code fences. Follow this shape, repeating the pair for each section of the video:

## <Section name> — <roughly how long it runs>

**On screen:** <what the viewer sees through this section: the shot, the b-roll, the graphic, the demo.>

> <The spoken line, word for word. Several short paragraphs rather than one long one — this is read off a teleprompter.>

Rules:
- Write the spoken lines as they are said: contractions, short sentences, no bullet points inside a quote.
- Never write "talk about X" or "explain Y" — write the actual words.
- Keep each spoken paragraph to two or three sentences, so a line does not run off the prompter.
- The **On screen:** notes are for the person shooting: what is being shown, held up, demonstrated, or cut to. Keep them to a sentence or two.
- Open on the hook the video promises, and close with whatever call to action the idea and the brand links support. Use the real links, never a placeholder.
- Total the spoken words to roughly the runtime given above — about 150 words a minute.`

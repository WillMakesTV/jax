package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Clip ideas
//
// The Clips tab on a past stream turns that broadcast into a video without
// the Plan Video ceremony: the app reads the stream's outline and transcript
// and pitches THREE distinct scripts (per the video-script-ideas skill); the
// producer picks one, and the pick becomes a video plan — source fixed to the
// stream, title from the idea, script already saved — that flows through the
// normal plan pages. The pick itself is feedback: what was chosen over what
// was passed over is folded back into the skill, so the next three pitches
// aim closer.
// ---------------------------------------------------------------------------

// ClipIdea is one pitched script.
type ClipIdea struct {
	Title  string `json:"title"`
	Hook   string `json:"hook"`   // one-line pitch: why this clip lands
	Script string `json:"script"` // markdown script/edit directions
}

// ClipIdeaSet is the stored trio of pitches for one stream + format.
type ClipIdeaSet struct {
	StartedAt   string     `json:"startedAt"`
	Format      string     `json:"format"`      // "short" | "long"
	GeneratedAt string     `json:"generatedAt"` // RFC3339; "" = none stored
	Model       string     `json:"model"`
	Ideas       []ClipIdea `json:"ideas"`
}

// keyClipIdeasPrefix stores the last generated set per stream + format, so
// the tab can re-show it after navigating away without regenerating.
const keyClipIdeasPrefix = "clip_ideas|"

func clipIdeasKey(startedAt, format string) string {
	return keyClipIdeasPrefix + startedAt + "|" + format
}

// scriptIdeasSkillID is the Application Skill behind the pitches — both the
// system prompt for generation and the document the pick feedback refines.
const scriptIdeasSkillID = "video-script-ideas"

// In-flight generations, keyed by startedAt|format, so double-runs are
// rejected and the UI can show progress after navigating away and back.
var (
	clipIdeasMu   sync.Mutex
	clipIdeasJobs = map[string]bool{}
)

const clipIdeasInstructions = `Respond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:
{"ideas": [{"title": "...", "hook": "...", "script": "..."}, {...}, {...}]}

Rules:
- Exactly 3 ideas.
- "title": the video's title, ready to publish under.
- "hook": one sentence pitching why this angle lands.
- "script": the complete script/edit directions in markdown, self-contained — an editor could cut the video from it without reading the other ideas.`

// GetClipIdeas returns the stored idea set for a stream + format
// ("" GeneratedAt when none exists).
func (a *App) GetClipIdeas(startedAt, format string) (ClipIdeaSet, error) {
	out := ClipIdeaSet{StartedAt: startedAt, Format: format, Ideas: []ClipIdea{}}
	if a.store == nil {
		return out, fmt.Errorf("storage unavailable")
	}
	if _, err := a.store.getJSON(clipIdeasKey(startedAt, format), &out); err != nil {
		return out, err
	}
	if out.Ideas == nil {
		out.Ideas = []ClipIdea{}
	}
	return out, nil
}

// ClipIdeasInProgress reports whether ideas are being generated for the
// stream + format right now.
func (a *App) ClipIdeasInProgress(startedAt, format string) bool {
	clipIdeasMu.Lock()
	defer clipIdeasMu.Unlock()
	return clipIdeasJobs[startedAt+"|"+format]
}

// GenerateClipIdeas pitches three scripts for a video cut from the stream,
// per the video-script-ideas skill, and persists the set. Blocks until
// generation finishes — the frontend reflects progress while awaiting.
func (a *App) GenerateClipIdeas(startedAt, streamTitle, format string) (ClipIdeaSet, error) {
	var out ClipIdeaSet
	if a.store == nil {
		return out, fmt.Errorf("storage unavailable")
	}
	if format != "short" {
		format = "long"
	}
	if _, _, err := a.aiConn(); err != nil {
		return out, err
	}

	jobKey := startedAt + "|" + format
	clipIdeasMu.Lock()
	if clipIdeasJobs[jobKey] {
		clipIdeasMu.Unlock()
		return out, fmt.Errorf("script ideas are already being generated for this stream")
	}
	clipIdeasJobs[jobKey] = true
	clipIdeasMu.Unlock()
	defer func() {
		clipIdeasMu.Lock()
		delete(clipIdeasJobs, jobKey)
		clipIdeasMu.Unlock()
	}()

	input, err := a.clipIdeasInput(startedAt, streamTitle, format)
	if err != nil {
		return out, err
	}
	system := a.skillText(scriptIdeasSkillID) + "\n\n" + clipIdeasInstructions

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	text, model, err := a.askAI(ctx, system, input)
	if err != nil {
		return out, err
	}
	out, err = parseClipIdeas(text)
	if err != nil {
		return out, err
	}
	out.StartedAt = startedAt
	out.Format = format
	out.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	out.Model = model
	if err := a.store.setJSON(clipIdeasKey(startedAt, format), out); err != nil {
		return out, err
	}
	return out, nil
}

// clipIdeasInput assembles what the model pitches from: the stream's
// identity, the format's runtime target, the stored outline, and the
// transcript (capped like the outline input — long streams lose tail detail
// rather than failing).
func (a *App) clipIdeasInput(startedAt, streamTitle, format string) (string, error) {
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return "", fmt.Errorf("invalid stream start %q: %v", startedAt, err)
	}

	transcript := a.GetTranscriptForStream(startedAt)
	outline := a.storedOutlineText(startedAt)
	if len(transcript) == 0 && outline == "" {
		return "", fmt.Errorf("no transcript or outline is stored for this stream yet — transcribe it first (or generate the outline on the Outline tab)")
	}

	var b strings.Builder
	b.WriteString("# The video to pitch\n")
	if streamTitle == "" {
		streamTitle = "Stream " + start.Format("Jan 2, 2006")
	}
	fmt.Fprintf(&b, "Cut from the broadcast %q (%s).\n", streamTitle, start.Format("Jan 2, 2006"))
	fmt.Fprintf(&b, "Format: %s form. %s\n", format, runtimeTarget(format))

	if outline != "" {
		b.WriteString("\n# The stream's outline\n")
		b.WriteString(outline)
		b.WriteString("\n")
	}

	b.WriteString("\n# The transcript\n")
	if len(transcript) == 0 {
		b.WriteString("(no transcript was captured — pitch from the outline)\n")
	}
	const sectionCap = 400_000
	startMs := start.UnixMilli()
	sectionStart := b.Len()
	for _, line := range transcript {
		if b.Len()-sectionStart > sectionCap {
			b.WriteString("[transcript truncated]\n")
			break
		}
		fmt.Fprintf(&b, "[%s] %s\n", offsetStamp(line.At, startMs), line.Text)
	}
	return b.String(), nil
}

// parseClipIdeas extracts the idea JSON from the model's response, tolerating
// stray prose or code fences around the object.
func parseClipIdeas(text string) (ClipIdeaSet, error) {
	var out ClipIdeaSet
	lo := strings.Index(text, "{")
	hi := strings.LastIndex(text, "}")
	if lo < 0 || hi <= lo {
		return out, fmt.Errorf("the model returned an unexpected format — try again")
	}
	if err := json.Unmarshal([]byte(text[lo:hi+1]), &out); err != nil {
		return out, fmt.Errorf("the model returned an unexpected format — try again")
	}
	ideas := out.Ideas[:0]
	for _, idea := range out.Ideas {
		if strings.TrimSpace(idea.Title) != "" && strings.TrimSpace(idea.Script) != "" {
			ideas = append(ideas, idea)
		}
	}
	out.Ideas = ideas
	if len(out.Ideas) == 0 {
		return out, fmt.Errorf("the model returned no usable ideas — try again")
	}
	return out, nil
}

// ChooseClipIdea turns the picked pitch into a video plan — source fixed to
// the stream, title from the idea, script saved for the Editor tab — and
// feeds the pick back into the video-script-ideas skill in the background.
func (a *App) ChooseClipIdea(startedAt, streamTitle, format string, chosenIndex int) (VideoPlan, error) {
	if a.store == nil {
		return VideoPlan{}, fmt.Errorf("storage unavailable")
	}
	if format != "short" {
		format = "long"
	}
	set, err := a.GetClipIdeas(startedAt, format)
	if err != nil {
		return VideoPlan{}, err
	}
	if set.GeneratedAt == "" || len(set.Ideas) == 0 {
		return VideoPlan{}, fmt.Errorf("no script ideas are stored for this stream — generate them first")
	}
	if chosenIndex < 0 || chosenIndex >= len(set.Ideas) {
		return VideoPlan{}, fmt.Errorf("that idea no longer exists — regenerate and pick again")
	}
	idea := set.Ideas[chosenIndex]

	if streamTitle == "" {
		if t, err := time.Parse(time.RFC3339, startedAt); err == nil {
			streamTitle = "Stream " + t.Format("Jan 2, 2006")
		}
	}
	plan, err := a.SaveVideoPlan(VideoPlan{
		Title:  idea.Title,
		Format: format,
		Streams: []VideoPlanStream{
			{StartedAt: startedAt, Title: streamTitle},
		},
	})
	if err != nil {
		return VideoPlan{}, err
	}
	if err := a.SaveEditScript(plan.ID, idea.Script); err != nil {
		return plan, err
	}

	// The set is consumed — a stale trio must not be picked from twice.
	if err := a.store.setSetting(clipIdeasKey(startedAt, format), ""); err != nil {
		log.Printf("jax: clear clip ideas: %v", err)
	}

	// The pick is preference data: fold what it reveals into the skill, off
	// the critical path — the producer is already on their way to the Editor.
	rejected := make([]ClipIdea, 0, len(set.Ideas)-1)
	for i, other := range set.Ideas {
		if i != chosenIndex {
			rejected = append(rejected, other)
		}
	}
	go a.learnFromClipChoice(idea, rejected, format)

	return plan, nil
}

const clipChoiceInstructions = `You maintain a skill document: the standing brief an assistant follows when pitching three candidate video scripts cut from a live stream broadcast.

The input is the current skill, the pitch the producer chose, and the pitches they passed over.

Work out what the choice reveals about the producer's taste — angle, tone, structure, hook style, subject matter — and rewrite the skill so the next three pitches aim closer to it.

Rules:

- Return the COMPLETE new skill document, ready to replace the old one. Not a diff, not a commentary.
- Keep everything in the current skill that the choice doesn't contradict. You are folding in, not starting over.
- One pick is weak evidence. Sharpen or add AT MOST one or two rules, and only where the contrast between chosen and rejected actually supports them. If the choice reveals nothing clear, return the skill with at most a light touch.
- Generalize to a RULE. The skill is read before a stream that hasn't happened yet, so it must not reference this stream, these titles, or these topics. State the preference to follow.
- Keep it tight and readable — a brief the assistant can hold in mind, not an archive. Merge overlapping rules rather than accumulating them.
- Preserve the document's markdown shape and voice.

Respond with ONLY the new skill document.`

// learnFromClipChoice folds one pick's chosen-vs-rejected contrast into the
// video-script-ideas skill. Best-effort: failures are logged and dropped —
// the pick itself already succeeded.
func (a *App) learnFromClipChoice(chosen ClipIdea, rejected []ClipIdea, format string) {
	skill, err := a.getAppSkill(scriptIdeasSkillID)
	if err != nil {
		log.Printf("jax: clip choice feedback: %v", err)
		return
	}

	var b strings.Builder
	b.WriteString("# The current skill\n\n")
	b.WriteString(skill.Content)
	fmt.Fprintf(&b, "\n\n# The pitch the producer chose (%s form)\n\n", format)
	fmt.Fprintf(&b, "## %s\n%s\n\n%s\n", chosen.Title, chosen.Hook, chosen.Script)
	b.WriteString("\n# The pitches they passed over\n")
	for _, r := range rejected {
		fmt.Fprintf(&b, "\n## %s\n%s\n\n%s\n", r.Title, r.Hook, r.Script)
	}

	text, err := a.askAIText(clipChoiceInstructions, b.String())
	if err != nil {
		log.Printf("jax: clip choice feedback: %v", err)
		return
	}
	text = strings.TrimSpace(text)
	// A "rewrite" that comes back a fraction of the original has dropped most
	// of the skill rather than folding into it; drop the update instead.
	if text == "" || len(text) < len(skill.Content)/2 {
		log.Printf("jax: clip choice feedback: model returned an implausibly short skill; skipped")
		return
	}
	if _, err := a.SaveAppSkill(scriptIdeasSkillID, text); err != nil {
		log.Printf("jax: clip choice feedback: %v", err)
	}
}

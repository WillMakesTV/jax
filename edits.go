package main

import (
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// The edit record, and the loop back into the skills
//
// Producing a video is a conversation: the editor makes a cut, the producer
// says what's wrong with it, and round it goes. Every round of that
// conversation is a correction to how the editor works — and today it is thrown
// away the moment the video ships, so the next video needs the same corrections
// all over again.
//
// So every edit is kept:
//
//   - "Request edits" on the Editor tab records the producer's words verbatim.
//   - Reprocessing the timeline records what they actually did with their hands
//     (segments dropped, reordered, expanded), described from the cut itself
//     rather than from anything they typed — because they didn't type anything.
//
// Those are then aggregated into one rolling "Changes" text: not a list of
// requests, but the standing difference between what the skill produced and
// what the producer wanted. That summary is what can be folded back into the
// format's editing-preference skill ("Update the long-form video skill with
// these changes"), so the next video starts closer to right.
// ---------------------------------------------------------------------------

const (
	// keyPlanChanges stores the planID → recorded edits + summary map.
	keyPlanChanges = "video_plan_changes"

	// The editing-preference skills the summary folds back into, by format.
	shortEditsSkillID = "video-edits-short"
	longEditsSkillID  = "video-edits-long"
)

// EditRequest is one round of the conversation.
type EditRequest struct {
	At   string `json:"at"`   // RFC3339
	Kind string `json:"kind"` // "ai" (the producer's words) | "timeline" (their hands)
	Text string `json:"text"`
}

// PlanChanges is everything the producer has asked for on one video, and the
// single rolling summary of it.
type PlanChanges struct {
	Requests []EditRequest `json:"requests"`
	// Summary is the "Changes" text: the overall difference between the cut the
	// skill produced and the cut the producer wanted. Rewritten whenever a new
	// edit lands, not appended to — three rounds circling the same complaint
	// are one correction, not three.
	Summary   string `json:"summary"`
	UpdatedAt string `json:"updatedAt"` // RFC3339; when Summary was last written
	// AppliedAt records when this summary was last folded into the skill, so
	// the UI can tell "not yet taught" from "already taught".
	AppliedAt string `json:"appliedAt"`
}

// editsSkillFor returns the editing-preference skill a plan's format learns
// into.
func editsSkillFor(format string) string {
	if format == "short" {
		return shortEditsSkillID
	}
	return longEditsSkillID
}

// formatLabel names a format the way the UI says it.
func formatLabel(format string) string {
	if format == "short" {
		return "short-form"
	}
	return "long-form"
}

// planChanges loads the planID → changes map. Never nil.
func (a *App) planChanges() map[string]PlanChanges {
	m := map[string]PlanChanges{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyPlanChanges, &m); err != nil {
			log.Printf("jax: load plan changes: %v", err)
		}
	}
	if m == nil {
		return map[string]PlanChanges{}
	}
	return m
}

// GetPlanChanges returns a plan's recorded edits and their summary.
func (a *App) GetPlanChanges(planID string) PlanChanges {
	c := a.planChanges()[planID]
	if c.Requests == nil {
		c.Requests = []EditRequest{}
	}
	return c
}

// savePlanChanges persists one plan's record.
func (a *App) savePlanChanges(planID string, c PlanChanges) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	if c.Requests == nil {
		c.Requests = []EditRequest{}
	}
	all := a.planChanges()
	all[planID] = c
	return a.store.setJSON(keyPlanChanges, all)
}

// recordEditRequest files one round of the conversation. Best-effort: losing an
// edit to the record must never fail the edit itself.
func (a *App) recordEditRequest(planID, kind, text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	c := a.GetPlanChanges(planID)
	c.Requests = append(c.Requests, EditRequest{
		At:   time.Now().UTC().Format(time.RFC3339),
		Kind: kind,
		Text: text,
	})
	if err := a.savePlanChanges(planID, c); err != nil {
		log.Printf("jax: record edit request for %s: %v", planID, err)
	}
}

// ---------------------------------------------------------------------------
// Describing a manual timeline pass
//
// The producer says nothing when they cut by hand — they just cut. The record
// would be silent about the most direct feedback there is, so the edit is read
// back out of the cut itself: what was dropped, what moved, what needed more
// room. Written in the producer's voice, because it is their correction; the
// summary downstream can't tell (and doesn't need to tell) which edits were
// typed and which were performed.
// ---------------------------------------------------------------------------

// segLabel names a segment for the description.
func segLabel(s TimelineSegment) string {
	if l := strings.TrimSpace(s.Label); l != "" {
		return "\"" + l + "\""
	}
	return fmt.Sprintf("the segment at %s", fmtClock(s.Start))
}

// fmtClock renders a timestamp as m:ss.
func fmtClock(t float64) string {
	if t < 0 || math.IsNaN(t) {
		t = 0
	}
	m := int(t) / 60
	s := int(t) % 60
	return fmt.Sprintf("%d:%02d", m, s)
}

// describeTimelineEdit reads a manual pass out of the cut: the segments the
// producer dropped, the ones they expanded, and whether they reordered. Returns
// "" when the timeline is unchanged — reprocessing an untouched cut is not
// feedback about anything.
func describeTimelineEdit(before, after []TimelineSegment) string {
	var notes []string

	// Dropped: a segment in the old cut that no longer appears. Matching on the
	// source span, because a segment's position moves but where it came from
	// doesn't.
	kept := map[string]bool{}
	for _, s := range after {
		kept[cutIdentity(s)] = true
	}
	var dropped []string
	for _, s := range before {
		if !kept[cutIdentity(s)] {
			dropped = append(dropped, segLabel(s))
		}
	}
	if len(dropped) > 0 {
		notes = append(notes, fmt.Sprintf("Cut %s from the video.",
			joinList(dropped)))
	}

	// Expanded: the producer needed more room around a moment than the editor
	// left them — the most useful signal in here, because it says the cut was
	// too tight in a specific, repeatable way.
	var widened []string
	for _, s := range after {
		if s.PadStart <= 0 && s.PadEnd <= 0 {
			continue
		}
		switch {
		case s.PadStart > 0 && s.PadEnd > 0:
			widened = append(widened, fmt.Sprintf(
				"%s needed %.1fs more before it and %.1fs after",
				segLabel(s), s.PadStart, s.PadEnd))
		case s.PadStart > 0:
			widened = append(widened, fmt.Sprintf(
				"%s started too late — it needed %.1fs more before it",
				segLabel(s), s.PadStart))
		default:
			widened = append(widened, fmt.Sprintf(
				"%s ended too early — it needed %.1fs more after it",
				segLabel(s), s.PadEnd))
		}
	}
	if len(widened) > 0 {
		notes = append(notes, "The cuts were too tight: "+joinList(widened)+".")
	}

	// Reordered: same segments, different running order.
	if !reordered(before, after) {
		// nothing to say
	} else {
		notes = append(notes, "Reordered the segments.")
	}

	// Trimmed: a segment that survived but got shorter.
	beforeLen := map[string]float64{}
	for _, s := range before {
		beforeLen[cutIdentity(s)] = s.End - s.Start
	}
	var tightened []string
	for _, s := range after {
		was, ok := beforeLen[cutIdentity(s)]
		if !ok {
			continue
		}
		if now := s.End - s.Start; was-now > 0.5 {
			tightened = append(tightened, fmt.Sprintf("%s (%.1fs shorter)",
				segLabel(s), was-now))
		}
	}
	if len(tightened) > 0 {
		notes = append(notes, "Trimmed "+joinList(tightened)+".")
	}

	if len(notes) == 0 {
		return ""
	}
	return "Manual timeline pass — " + strings.Join(notes, " ")
}

// cutIdentity identifies a segment by where its footage came from, so it stays
// recognizable after being moved, trimmed, or expanded.
func cutIdentity(s TimelineSegment) string {
	if s.Source == "" {
		// Sourceless material (title cards) is identified by its label, or by
		// its position when it hasn't got one.
		if l := strings.TrimSpace(s.Label); l != "" {
			return "label:" + l
		}
		return fmt.Sprintf("at:%.1f", s.Start)
	}
	return fmt.Sprintf("%s@%.1f", s.Source, s.SourceStart)
}

// reordered reports whether the surviving segments play in a different order.
func reordered(before, after []TimelineSegment) bool {
	// Only the segments present in both are comparable.
	inAfter := map[string]int{}
	for i, s := range after {
		inAfter[cutIdentity(s)] = i
	}
	var order []int
	for _, s := range before {
		if i, ok := inAfter[cutIdentity(s)]; ok {
			order = append(order, i)
		}
	}
	return !sort.IntsAreSorted(order)
}

// joinList renders a list the way a person would say it.
func joinList(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	case 2:
		return items[0] + " and " + items[1]
	}
	return strings.Join(items[:len(items)-1], ", ") + ", and " + items[len(items)-1]
}

// ---------------------------------------------------------------------------
// The rolling summary
// ---------------------------------------------------------------------------

const changesSummaryInstructions = `You are keeping one running note for a video producer: the standing difference between the cut their automated editor produced and the cut they actually wanted.

The input is every edit they asked for on one video, in order — some typed in their own words, some read back out of a manual pass they made on the timeline.

Write the note as MARKDOWN. Rules:

- It is a set of corrections, not a history. Three rounds circling the same complaint are ONE correction, not three: merge them, and state what they actually want.
- Prefer the general to the specific. "Cut the tangent about the keyboard at 4:12" is one video's problem; "cut tangents that don't pay off within about 30 seconds" is a rule the editor can apply next time. Generalize where the evidence supports it, and don't where it doesn't.
- Keep what is genuinely one-off as one-off, and say so — some notes are about this video and nothing else, and pretending otherwise would teach the editor a rule that isn't one.
- If the producer kept asking for more room around cuts, say that plainly: it means the editor cuts too tight, which is a habit, not an incident.
- Be concise: a handful of bullets, grouped under short headings if there is enough to group. No preamble, no commentary, no restating the task.

Respond with ONLY the note.`

// SummarizePlanChanges rewrites the plan's rolling "Changes" text from every
// edit recorded so far. Rewritten rather than appended: the summary is the
// current standing difference, and an append-only log would just be the
// requests again with extra words.
func (a *App) SummarizePlanChanges(planID string) (PlanChanges, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return PlanChanges{}, err
	}
	c := a.GetPlanChanges(planID)
	if len(c.Requests) == 0 {
		return c, fmt.Errorf("no edits have been requested on this video yet")
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# The video\n%s (%s)\n\n", plan.Title, formatLabel(plan.Format))
	b.WriteString("# Every edit asked for, in order\n")
	for i, r := range c.Requests {
		source := "the producer's words"
		if r.Kind == "timeline" {
			source = "read from a manual pass they made on the timeline"
		}
		fmt.Fprintf(&b, "\n## Round %d (%s)\n%s\n", i+1, source, r.Text)
	}

	text, err := a.askAIText(changesSummaryInstructions, b.String())
	if err != nil {
		return c, err
	}
	if text = strings.TrimSpace(text); text == "" {
		return c, fmt.Errorf("the model returned an empty summary — try again")
	}

	c.Summary = text
	c.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := a.savePlanChanges(planID, c); err != nil {
		return c, err
	}
	return c, nil
}

// ---------------------------------------------------------------------------
// Folding the summary back into the skill
// ---------------------------------------------------------------------------

const skillUpdateInstructions = `You maintain a skill document: the standing editing preferences an automated video editor follows for one video format. It is what the editor reads BEFORE making its first cut.

The input is the current skill, and a note describing the corrections a producer had to make to their most recent video in that format.

Rewrite the skill so those corrections are built in — so that next time, the editor gets it right first and the producer doesn't have to ask again.

Rules:

- Return the COMPLETE new skill document, ready to replace the old one. Not a diff, not a commentary.
- Keep everything in the current skill that the note doesn't contradict. You are folding in, not starting over.
- Fold corrections into the existing rules where they belong, rather than bolting a growing pile onto the end. If a new correction sharpens an existing rule, sharpen that rule.
- Generalize to a RULE. The skill is read before a video that hasn't been made yet, so it must not reference the specific video the note came from — no titles, no timestamps, no "the tangent about the keyboard". State the behaviour to follow.
- Drop nothing that is still true, and invent nothing the note doesn't support.
- Keep it tight and readable — a document the editor can hold in mind, not an archive. If it is growing unwieldy, merge overlapping rules rather than accumulating them.
- Preserve the document's markdown shape and voice.

Respond with ONLY the new skill document.`

// ApplyChangesToSkill folds a plan's rolling "Changes" summary into the editing
// -preference skill for its format, and saves it as the skill's content (a
// Settings → Skills override, so it stays editable and resettable by hand).
//
// This is the point of the whole record: the corrections stop being one video's
// problem and become how the editor works.
func (a *App) ApplyChangesToSkill(planID string) (AppSkill, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return AppSkill{}, err
	}
	c := a.GetPlanChanges(planID)
	if strings.TrimSpace(c.Summary) == "" {
		return AppSkill{}, fmt.Errorf("summarize the changes first — there is nothing to teach the skill yet")
	}

	skillID := editsSkillFor(plan.Format)
	skill, err := a.getAppSkill(skillID)
	if err != nil {
		return AppSkill{}, err
	}

	input := "# The current skill\n\n" + skill.Content +
		"\n\n# Corrections the producer had to make\n\n" + strings.TrimSpace(c.Summary)

	text, err := a.askAIText(skillUpdateInstructions, input)
	if err != nil {
		return AppSkill{}, err
	}
	if text = strings.TrimSpace(text); text == "" {
		return AppSkill{}, fmt.Errorf("the model returned an empty skill — try again")
	}
	// A "rewrite" that comes back a fraction of the original has dropped most
	// of the skill rather than folding into it; refuse it rather than quietly
	// destroying the producer's accumulated preferences (they can still edit
	// the skill by hand in Settings).
	if len(text) < len(skill.Content)/2 {
		return AppSkill{}, fmt.Errorf("the model returned a much shorter skill than the one it was given — it looks like it rewrote rather than folded in. Nothing was changed; try again")
	}

	updated, err := a.SaveAppSkill(skillID, text)
	if err != nil {
		return AppSkill{}, err
	}

	c.AppliedAt = time.Now().UTC().Format(time.RFC3339)
	if err := a.savePlanChanges(planID, c); err != nil {
		log.Printf("jax: mark changes applied for %s: %v", planID, err)
	}
	return updated, nil
}

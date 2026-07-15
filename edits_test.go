package main

import (
	"strings"
	"testing"
)

// The producer says nothing while cutting by hand — the correction has to be
// read out of the cut itself. If this reads it wrong, the skill learns the
// wrong lesson, which is worse than learning none.
func TestDescribeTimelineEdit(t *testing.T) {
	base := []TimelineSegment{
		{Start: 0, End: 10, Source: "EP08.mp4", SourceStart: 100, SourceEnd: 110, Label: "cold open"},
		{Start: 10, End: 20, Source: "EP08.mp4", SourceStart: 200, SourceEnd: 210, Label: "the build"},
		{Start: 20, End: 25, Label: "outro card"},
	}

	t.Run("an untouched cut is not feedback", func(t *testing.T) {
		if got := describeTimelineEdit(base, base); got != "" {
			t.Errorf("reprocessing an unchanged timeline said something: %q", got)
		}
	})

	t.Run("a dropped segment", func(t *testing.T) {
		after := []TimelineSegment{base[0], base[2]}
		got := describeTimelineEdit(base, after)
		if !strings.Contains(got, "Cut") || !strings.Contains(got, "the build") {
			t.Errorf("the dropped segment was not reported: %q", got)
		}
		// The segments that survived must not be reported as cut.
		if strings.Contains(got, "cold open") {
			t.Errorf("a kept segment was reported as cut: %q", got)
		}
	})

	t.Run("expansion is reported as the cut being too tight", func(t *testing.T) {
		after := []TimelineSegment{
			base[0],
			{Start: 10, End: 20, Source: "EP08.mp4", SourceStart: 200, SourceEnd: 210,
				Label: "the build", PadStart: 1.5},
			base[2],
		}
		got := describeTimelineEdit(base, after)
		if !strings.Contains(got, "too tight") {
			t.Errorf("an expansion should say the cut was too tight: %q", got)
		}
		if !strings.Contains(got, "started too late") || !strings.Contains(got, "1.5s") {
			t.Errorf("the expansion was not described: %q", got)
		}
	})

	t.Run("expansion at both ends", func(t *testing.T) {
		after := []TimelineSegment{
			{Start: 0, End: 10, Source: "EP08.mp4", SourceStart: 100, SourceEnd: 110,
				Label: "cold open", PadStart: 2, PadEnd: 1},
			base[1], base[2],
		}
		got := describeTimelineEdit(base, after)
		if !strings.Contains(got, "2.0s more before") || !strings.Contains(got, "1.0s after") {
			t.Errorf("a two-sided expansion was not described: %q", got)
		}
	})

	t.Run("reordering", func(t *testing.T) {
		after := []TimelineSegment{base[1], base[0], base[2]}
		got := describeTimelineEdit(base, after)
		if !strings.Contains(got, "Reordered") {
			t.Errorf("the reorder was not reported: %q", got)
		}
	})

	t.Run("trimming a segment shorter", func(t *testing.T) {
		after := []TimelineSegment{
			{Start: 0, End: 6, Source: "EP08.mp4", SourceStart: 100, SourceEnd: 106, Label: "cold open"},
			base[1], base[2],
		}
		got := describeTimelineEdit(base, after)
		if !strings.Contains(got, "Trimmed") || !strings.Contains(got, "cold open") {
			t.Errorf("the trim was not reported: %q", got)
		}
	})

	t.Run("a segment is still itself after being moved", func(t *testing.T) {
		// Reordering shifts every segment's start time. Identity must not be
		// positional, or every reorder would read as "cut everything and added
		// everything back".
		after := []TimelineSegment{
			{Start: 0, End: 10, Source: "EP08.mp4", SourceStart: 200, SourceEnd: 210, Label: "the build"},
			{Start: 10, End: 20, Source: "EP08.mp4", SourceStart: 100, SourceEnd: 110, Label: "cold open"},
			{Start: 20, End: 25, Label: "outro card"},
		}
		got := describeTimelineEdit(base, after)
		if strings.Contains(got, "Cut ") {
			t.Errorf("moving a segment was mistaken for deleting it: %q", got)
		}
	})
}

func TestEditsSkillFollowsTheFormat(t *testing.T) {
	if got := editsSkillFor("short"); got != shortEditsSkillID {
		t.Errorf("a short learns into %q, want %q", got, shortEditsSkillID)
	}
	for _, format := range []string{"long", "", "anything-else"} {
		if got := editsSkillFor(format); got != longEditsSkillID {
			t.Errorf("format %q learns into %q, want %q", format, got, longEditsSkillID)
		}
	}
}

// Every edit the producer makes is kept — typed or performed.
func TestEditRequestsAreRecordedInOrder(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}

	a.recordEditRequest(plan.ID, "ai", "Tighten the intro.")
	a.recordEditRequest(plan.ID, "timeline", "Manual timeline pass — Cut \"the tangent\".")
	a.recordEditRequest(plan.ID, "ai", "   ") // nothing said; nothing recorded

	c := a.GetPlanChanges(plan.ID)
	if len(c.Requests) != 2 {
		t.Fatalf("recorded %d edits, want 2 (the empty one is not an edit): %+v",
			len(c.Requests), c.Requests)
	}
	if c.Requests[0].Text != "Tighten the intro." || c.Requests[0].Kind != "ai" {
		t.Errorf("the first edit is wrong: %+v", c.Requests[0])
	}
	if c.Requests[1].Kind != "timeline" {
		t.Errorf("the manual pass was not marked as one: %+v", c.Requests[1])
	}
	if c.Requests[0].At == "" {
		t.Error("an edit was recorded without a time")
	}
}

// Summarizing before anything has been asked for must not fabricate a summary.
func TestSummarizeRefusesWithNothingToSummarize(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.SummarizePlanChanges(plan.ID); err == nil {
		t.Error("want an error summarizing a video nobody has asked to change")
	}
}

// Teaching the skill needs something to teach it. Without a summary, the skill
// must be left exactly as it is.
func TestApplyToSkillRefusesWithoutASummary(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	before, err := a.getAppSkill(longEditsSkillID)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := a.ApplyChangesToSkill(plan.ID); err == nil {
		t.Fatal("want an error teaching the skill with nothing to teach it")
	}
	after, err := a.getAppSkill(longEditsSkillID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Content != before.Content || after.Overridden {
		t.Error("the skill was modified despite there being nothing to teach it")
	}
}

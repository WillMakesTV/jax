package main

import "testing"

func TestEditRunLog(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Clocked", Format: "long"})
	if err != nil {
		t.Fatalf("save plan: %v", err)
	}

	if runs := a.GetEditRuns(plan.ID); len(runs) != 0 {
		t.Fatalf("fresh plan should have no runs: %+v", runs)
	}

	// A live run has a start and no end.
	a.recordEditRunStart(plan.ID)
	runs := a.GetEditRuns(plan.ID)
	if len(runs) != 1 || runs[0].StartedAt == "" || runs[0].EndedAt != "" {
		t.Fatalf("live run wrong: %+v", runs)
	}

	// Clocking out closes the newest open run with its outcome.
	a.recordEditRunEnd(plan.ID, "")
	runs = a.GetEditRuns(plan.ID)
	if len(runs) != 1 || runs[0].EndedAt == "" || runs[0].Error != "" {
		t.Fatalf("closed run wrong: %+v", runs)
	}
	if runs[0].DurationSecs < 0 {
		t.Fatalf("negative duration: %+v", runs[0])
	}

	// A failed run keeps its error, and runs accumulate in order.
	a.recordEditRunStart(plan.ID)
	a.recordEditRunEnd(plan.ID, "ffmpeg exploded")
	runs = a.GetEditRuns(plan.ID)
	if len(runs) != 2 || runs[1].Error != "ffmpeg exploded" || runs[1].EndedAt == "" {
		t.Fatalf("failed run wrong: %+v", runs)
	}

	// Ending with nothing open is a no-op, not a panic or a rewrite.
	a.recordEditRunEnd(plan.ID, "late")
	if runs := a.GetEditRuns(plan.ID); len(runs) != 2 || runs[1].Error != "ffmpeg exploded" {
		t.Fatalf("stray end mutated the log: %+v", runs)
	}
}

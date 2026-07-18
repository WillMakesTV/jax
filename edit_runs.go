package main

import (
	"log"
	"time"
)

// ---------------------------------------------------------------------------
// Edit-run log
//
// Every processing session (an AI edit pass rendering the video) is clocked:
// when it started, when it ended, and whether it succeeded — so the Editor
// tab can show how long each revision took to process. Best-effort
// throughout: the log must never fail the run itself.
// ---------------------------------------------------------------------------

// keyEditRuns stores the planID → run-log map.
const keyEditRuns = "video_plan_edit_runs"

// EditRun is one processing session of a plan's video.
type EditRun struct {
	StartedAt string `json:"startedAt"` // RFC3339
	EndedAt   string `json:"endedAt"`   // RFC3339; '' while the run is live
	// DurationSecs is the wall-clock the run took; 0 while it is live.
	DurationSecs int `json:"durationSecs"`
	// Error is the failure detail; '' for a clean run.
	Error string `json:"error,omitempty"`
}

// editRunLog loads the planID → runs map. Never nil.
func (a *App) editRunLog() map[string][]EditRun {
	m := map[string][]EditRun{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyEditRuns, &m); err != nil {
			log.Printf("jax: load edit runs: %v", err)
		}
	}
	if m == nil {
		return map[string][]EditRun{}
	}
	return m
}

// saveEditRunLog persists the map.
func (a *App) saveEditRunLog(m map[string][]EditRun) {
	if a.store == nil {
		return
	}
	if err := a.store.setJSON(keyEditRuns, m); err != nil {
		log.Printf("jax: save edit runs: %v", err)
	}
}

// GetEditRuns returns a plan's processing sessions, oldest first.
func (a *App) GetEditRuns(planID string) []EditRun {
	runs := a.editRunLog()[planID]
	if runs == nil {
		return []EditRun{}
	}
	return runs
}

// recordEditRunStart clocks a session in.
func (a *App) recordEditRunStart(planID string) {
	m := a.editRunLog()
	m[planID] = append(m[planID], EditRun{
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	})
	a.saveEditRunLog(m)
}

// recordEditRunEnd clocks the plan's live session out with its outcome
// (errDetail '' = a clean run).
func (a *App) recordEditRunEnd(planID, errDetail string) {
	m := a.editRunLog()
	runs := m[planID]
	for i := len(runs) - 1; i >= 0; i-- {
		if runs[i].EndedAt != "" {
			continue
		}
		now := time.Now().UTC()
		runs[i].EndedAt = now.Format(time.RFC3339)
		if started, err := time.Parse(time.RFC3339, runs[i].StartedAt); err == nil {
			runs[i].DurationSecs = int(now.Sub(started) / time.Second)
		}
		runs[i].Error = errDetail
		m[planID] = runs
		a.saveEditRunLog(m)
		return
	}
}

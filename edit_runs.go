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
// (errDetail ” = a clean run).
func (a *App) recordEditRunEnd(planID, errDetail string) {
	m := a.editRunLog()
	runs := m[planID]
	for i := len(runs) - 1; i >= 0; i-- {
		if runs[i].EndedAt != "" {
			continue
		}
		closeEditRun(&runs[i], errDetail)
		m[planID] = runs
		a.saveEditRunLog(m)
		return
	}
}

// recordEditRunEndAll clocks out every still-open run of a plan — the broom
// behind StopEditRun, where orphaned rows (an app restart mid-session) may
// have piled up.
func (a *App) recordEditRunEndAll(planID, errDetail string) {
	m := a.editRunLog()
	runs := m[planID]
	closed := false
	for i := range runs {
		if runs[i].EndedAt != "" {
			continue
		}
		closeEditRun(&runs[i], errDetail)
		closed = true
	}
	if closed {
		m[planID] = runs
		a.saveEditRunLog(m)
	}
}

// closeEditRun stamps a run's end, duration, and outcome.
func closeEditRun(r *EditRun, errDetail string) {
	now := time.Now().UTC()
	r.EndedAt = now.Format(time.RFC3339)
	if started, err := time.Parse(time.RFC3339, r.StartedAt); err == nil {
		r.DurationSecs = int(now.Sub(started) / time.Second)
	}
	r.Error = errDetail
}

// StopEditRun stops a plan's processing session from the run log. A live
// session for the plan is killed (with everything it spawned); open rows
// with no live process behind them — a session orphaned by an app restart —
// are simply clocked out as stopped. Either way the plan's log is left with
// no open rows.
func (a *App) StopEditRun(planID string) {
	a.mu.Lock()
	live := a.editPlanID == planID && a.editCmd != nil
	a.mu.Unlock()
	if live {
		a.CancelEditRun()
		return
	}
	a.recordEditRunEndAll(planID, "stopped — the session was no longer running")
}

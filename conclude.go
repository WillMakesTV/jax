package main

import (
	"fmt"
	"log"
	"time"
)

// ---------------------------------------------------------------------------
// Concluding an episode
//
// Once a plan has gone live and its broadcast has stopped, the user concludes
// it: the plan's whole identity — title, description, channels, series,
// episode, tags — is snapshotted onto the stream through the same
// live-assignment mechanism series/episode already use (keyed by the
// session's go-live time until the VODs appear, then adopted onto broadcast
// keys; see past.go). The stream session is closed if still open, and the
// plan itself is removed from Planning. The chat, transcript, and events the
// app captured during the session stay attached to the past stream by its
// time window, so nothing else needs to move.
// ---------------------------------------------------------------------------

// StreamPlanInfo is the plan snapshot a concluded episode leaves on its past
// stream: the description and custom data the plan carried.
type StreamPlanInfo struct {
	PlanID        string   `json:"planId"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Channels      []string `json:"channels"`
	SeriesID      string   `json:"seriesId"`
	EpisodeNumber int      `json:"episodeNumber"`
	Tags          []string `json:"tags"`
	ConcludedAt   string   `json:"concludedAt"` // RFC3339
}

// keyStreamPlans stores the broadcastKey -> StreamPlanInfo assignments (live
// keys until adoption, like series/episode).
const keyStreamPlans = "past_stream_plans"

// streamPlans loads the saved broadcastKey -> plan-snapshot map. Never nil.
func (a *App) streamPlans() map[string]StreamPlanInfo {
	m := map[string]StreamPlanInfo{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamPlans, &m); err != nil {
			log.Printf("jax: load stream plans: %v", err)
		}
	}
	if m == nil {
		return map[string]StreamPlanInfo{}
	}
	return m
}

// PlanSessionInfo is a plan's most recent go-live window.
type PlanSessionInfo struct {
	PlanID    string `json:"planId"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"` // "" while the session is open
}

// GetPlanSessions returns each plan's most recent stream session — how the
// UI knows a plan has gone live (and can be concluded). Never returns nil.
func (a *App) GetPlanSessions() []PlanSessionInfo {
	out := []PlanSessionInfo{}
	if a.store == nil {
		return out
	}
	sessions, err := a.store.planSessions()
	if err != nil {
		log.Printf("jax: GetPlanSessions: %v", err)
		return out
	}
	for id, w := range sessions {
		out = append(out, PlanSessionInfo{PlanID: id, StartedAt: w[0], EndedAt: w[1]})
	}
	return out
}

// ResetPlannedStream forgets that a plan has been broadcast: its stream
// sessions are deleted (so Conclude stops being offered) and the live-keyed
// series/episode assignments those go-lives registered are cleared. The plan
// itself is untouched and can go live again later. Assignments a finished
// VOD has already adopted stay put — reassign those from the stream's
// details page if needed.
func (a *App) ResetPlannedStream(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	starts, err := a.store.deletePlanSessions(id)
	if err != nil {
		return err
	}
	if len(starts) == 0 {
		return nil // never went live; nothing to forget
	}

	plans := a.streamPlans()
	plansChanged := false
	for _, startedAt := range starts {
		key := liveMetaKey(startedAt)
		if err := a.SetPastStreamSeries([]string{key}, ""); err != nil {
			log.Printf("jax: reset plan series: %v", err)
		}
		if err := a.SetStreamEpisode([]string{key}, 0, ""); err != nil {
			log.Printf("jax: reset plan episode: %v", err)
		}
		if _, ok := plans[key]; ok {
			delete(plans, key)
			plansChanged = true
		}
	}
	if plansChanged {
		if err := a.store.setJSON(keyStreamPlans, plans); err != nil {
			return err
		}
	}
	return nil
}

// ConcludePlannedStream concludes an episode that has been broadcast: the
// plan's snapshot is attached to the stream (adopted by the past stream once
// its VODs are listed), any still-open session is closed, and the plan is
// removed from Planning. The plan must have gone live at least once.
func (a *App) ConcludePlannedStream(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	var plan *PlannedStream
	for _, p := range a.GetPlannedStreams() {
		if p.ID == id {
			p := p
			plan = &p
			break
		}
	}
	if plan == nil {
		return fmt.Errorf("that plan no longer exists")
	}
	startedAt, endedAt, ok, err := a.store.latestSessionForPlan(id)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("this plan has not been broadcast yet")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	// Stopping the stream from OBS itself leaves the session open; concluding
	// closes it so chat retention and the live page settle. Only one session
	// can be open at a time and the plan's latest is it.
	if endedAt == "" {
		if err := a.store.endOpenStreamSessions(now); err != nil {
			log.Printf("jax: conclude end session: %v", err)
		}
	}

	// Snapshot the plan onto the stream, keyed by its go-live time until the
	// finished VODs adopt it (see adoptLiveAssignments).
	key := liveMetaKey(startedAt)
	plans := a.streamPlans()
	if plan.Channels == nil {
		plan.Channels = []string{}
	}
	if plan.Tags == nil {
		plan.Tags = []string{}
	}
	plans[key] = StreamPlanInfo{
		PlanID:        plan.ID,
		Title:         plan.Title,
		Description:   plan.Description,
		Channels:      plan.Channels,
		SeriesID:      plan.SeriesID,
		EpisodeNumber: plan.EpisodeNumber,
		Tags:          plan.Tags,
		ConcludedAt:   now,
	}
	if err := a.store.setJSON(keyStreamPlans, plans); err != nil {
		return err
	}

	// Re-assert the series/episode assignments made at go-live (idempotent;
	// they share the same key), in case anything cleared them since.
	if plan.SeriesID != "" {
		if err := a.SetPastStreamSeries([]string{key}, plan.SeriesID); err != nil {
			log.Printf("jax: conclude assign series: %v", err)
		}
	}
	if plan.EpisodeNumber > 0 {
		if err := a.SetStreamEpisode([]string{key}, plan.EpisodeNumber, plan.Description); err != nil {
			log.Printf("jax: conclude assign episode: %v", err)
		}
	}

	// The episode is concluded: the plan leaves Planning (and the Broadcast
	// page's plan list with it).
	return a.DeletePlannedStream(id)
}

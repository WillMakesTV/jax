package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Stream planning
//
// A PlannedStream is a lightweight outline of an upcoming broadcast: a title,
// a description, and the connected channels it should go out to. Plans are
// stored as a single JSON blob in the settings table.
// ---------------------------------------------------------------------------

// PlannedStream is one planned/upcoming broadcast.
type PlannedStream struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Channels are platform ids the stream should broadcast to ("twitch",
	// "youtube").
	Channels []string `json:"channels"`
	// SeriesID optionally links the plan to a ContentSeries for shared context.
	SeriesID  string `json:"seriesId"`
	CreatedAt string `json:"createdAt"` // RFC3339
}

// GetPlannedStreams returns the saved stream plans, newest first. Never nil.
func (a *App) GetPlannedStreams() []PlannedStream {
	if a.store == nil {
		return []PlannedStream{}
	}
	var plans []PlannedStream
	if _, err := a.store.getJSON(keyPlannedStreams, &plans); err != nil {
		log.Printf("jax: GetPlannedStreams: %v", err)
	}
	if plans == nil {
		return []PlannedStream{}
	}
	return plans
}

// SavePlannedStream upserts a plan (matched by ID), assigning an ID and
// creation time on first save, and returns the stored value.
func (a *App) SavePlannedStream(plan PlannedStream) (PlannedStream, error) {
	if a.store == nil {
		return plan, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(plan.Title) == "" {
		return plan, fmt.Errorf("a title is required")
	}
	if plan.Channels == nil {
		plan.Channels = []string{}
	}

	plans := a.GetPlannedStreams()
	if plan.ID == "" {
		plan.ID = fmt.Sprintf("plan_%d", time.Now().UnixNano())
	}
	if plan.CreatedAt == "" {
		plan.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, p := range plans {
		if p.ID == plan.ID {
			plans[i] = plan
			replaced = true
			break
		}
	}
	if !replaced {
		// Newest first.
		plans = append([]PlannedStream{plan}, plans...)
	}

	if err := a.store.setJSON(keyPlannedStreams, plans); err != nil {
		return plan, err
	}
	return plan, nil
}

// DeletePlannedStream removes a plan by ID.
func (a *App) DeletePlannedStream(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	plans := a.GetPlannedStreams()
	out := make([]PlannedStream, 0, len(plans))
	for _, p := range plans {
		if p.ID != id {
			out = append(out, p)
		}
	}
	return a.store.setJSON(keyPlannedStreams, out)
}

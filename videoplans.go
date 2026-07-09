package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Video plans
//
// A video plan is the Planning-side counterpart of a planned stream, for
// produced (non-live) content: a short-form or long-form video being worked
// towards. Plans are stored as a JSON blob in the settings table (like
// planned streams) and surface at the top of the Videos page.
// ---------------------------------------------------------------------------

// VideoPlanStream references one past stream a planned video draws from.
// Streams are identified by their start time (the identity chat, transcript,
// and episode assignments already key off); the title is snapshotted for
// display so the reference stays readable even if the VOD later disappears.
type VideoPlanStream struct {
	StartedAt string `json:"startedAt"` // RFC3339
	Title     string `json:"title"`
}

// VideoPlan is one planned video.
type VideoPlan struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Format distinguishes short-form (Shorts, clips) from long-form videos.
	Format string   `json:"format"` // "short" | "long"
	Tags   []string `json:"tags"`
	// Streams are the past streams this video is sourced from.
	Streams []VideoPlanStream `json:"streams"`
	// ThumbnailFile names the plan's thumbnail image in ~/.jax/plan_thumbs
	// ("" = none; shared with stream-plan thumbnails, see plan_thumbs.go).
	// ThumbnailURL is the served address, recomputed on every read.
	ThumbnailFile string `json:"thumbnailFile"`
	ThumbnailURL  string `json:"thumbnailUrl"`
	// ThumbnailHistory: previous thumbnails (newest first, capped), for
	// restoring an earlier version; maintained server-side on save.
	ThumbnailHistory     []string `json:"thumbnailHistory"`
	ThumbnailHistoryURLs []string `json:"thumbnailHistoryUrls"`
	CreatedAt            string   `json:"createdAt"` // RFC3339
}

// keyVideoPlans stores the video-plan list.
const keyVideoPlans = "video_plans"

// GetVideoPlans returns the saved video plans, newest first. Never nil.
func (a *App) GetVideoPlans() []VideoPlan {
	if a.store == nil {
		return []VideoPlan{}
	}
	var plans []VideoPlan
	if _, err := a.store.getJSON(keyVideoPlans, &plans); err != nil {
		log.Printf("jax: GetVideoPlans: %v", err)
	}
	if plans == nil {
		return []VideoPlan{}
	}
	for i := range plans {
		plans[i].ThumbnailURL = a.planThumbURL(plans[i].ThumbnailFile)
		plans[i].ThumbnailHistoryURLs = a.planThumbHistoryURLs(plans[i].ThumbnailHistory)
	}
	return plans
}

// SaveVideoPlan upserts a video plan (matched by ID), assigning an ID and
// creation time on first save, and returns the stored value.
func (a *App) SaveVideoPlan(plan VideoPlan) (VideoPlan, error) {
	if a.store == nil {
		return plan, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(plan.Title) == "" {
		return plan, fmt.Errorf("a title is required")
	}
	if plan.Format != "short" {
		plan.Format = "long"
	}
	if plan.Tags == nil {
		plan.Tags = []string{}
	}
	if plan.Streams == nil {
		plan.Streams = []VideoPlanStream{}
	}
	// Stored as a bare file name in the plan-thumbs folder; the URL is
	// derived per launch, never persisted. The history is authoritative
	// server-side, recomputed from the stored plan on every save.
	plan.ThumbnailFile = sanitizeThumbFile(plan.ThumbnailFile)
	plan.ThumbnailURL = ""
	plan.ThumbnailHistory = []string{}
	plan.ThumbnailHistoryURLs = nil

	plans := a.GetVideoPlans()
	if plan.ID == "" {
		plan.ID = fmt.Sprintf("vplan_%d", time.Now().UnixNano())
	}
	if plan.CreatedAt == "" {
		plan.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, p := range plans {
		if p.ID == plan.ID {
			plan.ThumbnailHistory = updateThumbHistory(
				p.ThumbnailHistory, p.ThumbnailFile, plan.ThumbnailFile,
			)
			plans[i] = plan
			replaced = true
			break
		}
	}
	if !replaced {
		// Newest first.
		plans = append([]VideoPlan{plan}, plans...)
	}

	if err := a.store.setJSON(keyVideoPlans, plans); err != nil {
		return plan, err
	}
	plan.ThumbnailURL = a.planThumbURL(plan.ThumbnailFile)
	plan.ThumbnailHistoryURLs = a.planThumbHistoryURLs(plan.ThumbnailHistory)
	return plan, nil
}

// DeleteVideoPlan removes a video plan by ID.
func (a *App) DeleteVideoPlan(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	plans := a.GetVideoPlans()
	out := make([]VideoPlan, 0, len(plans))
	for _, p := range plans {
		if p.ID != id {
			out = append(out, p)
		}
	}
	return a.store.setJSON(keyVideoPlans, out)
}

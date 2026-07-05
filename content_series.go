package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Content series
//
// A ContentSeries captures the recurring context/metadata for a series of
// content (a show, segment, or theme): its title, description, category, tags,
// and freeform notes. Plans reference a series so its context is on hand while
// planning a stream. Stored as a single JSON blob in the settings table.
// ---------------------------------------------------------------------------

// ContentSeries is the reusable context for a series of content.
type ContentSeries struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Category    string   `json:"category"` // game / category the series usually runs in
	Tags        []string `json:"tags"`
	Notes       string   `json:"notes"` // freeform planning context
	CreatedAt   string   `json:"createdAt"`
}

// GetContentSeries returns the saved content series, newest first. Never nil.
func (a *App) GetContentSeries() []ContentSeries {
	if a.store == nil {
		return []ContentSeries{}
	}
	var series []ContentSeries
	if _, err := a.store.getJSON(keyContentSeries, &series); err != nil {
		log.Printf("jax: GetContentSeries: %v", err)
	}
	if series == nil {
		return []ContentSeries{}
	}
	return series
}

// SaveContentSeries upserts a series (matched by ID), assigning an ID and
// creation time on first save, and returns the stored value.
func (a *App) SaveContentSeries(series ContentSeries) (ContentSeries, error) {
	if a.store == nil {
		return series, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(series.Title) == "" {
		return series, fmt.Errorf("a title is required")
	}
	if series.Tags == nil {
		series.Tags = []string{}
	}

	all := a.GetContentSeries()
	if series.ID == "" {
		series.ID = fmt.Sprintf("series_%d", time.Now().UnixNano())
	}
	if series.CreatedAt == "" {
		series.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, s := range all {
		if s.ID == series.ID {
			all[i] = series
			replaced = true
			break
		}
	}
	if !replaced {
		all = append([]ContentSeries{series}, all...)
	}

	if err := a.store.setJSON(keyContentSeries, all); err != nil {
		return series, err
	}
	return series, nil
}

// DeleteContentSeries removes a series by ID.
func (a *App) DeleteContentSeries(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.GetContentSeries()
	out := make([]ContentSeries, 0, len(all))
	for _, s := range all {
		if s.ID != id {
			out = append(out, s)
		}
	}
	return a.store.setJSON(keyContentSeries, out)
}

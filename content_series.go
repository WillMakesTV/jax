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
// content (a show, segment, or theme): its title, description, per-platform
// categories, tags, and freeform notes. Plans reference a series so its
// context is on hand while planning a stream. Stored as a single JSON blob in
// the settings table.
// ---------------------------------------------------------------------------

// ContentSeries is the reusable context for a series of content.
type ContentSeries struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Per-platform categories (see categories.go); the IDs feed the platforms'
	// channel/broadcast update APIs when the series goes live. Required for
	// each connected broadcast service.
	TwitchCategory  ServiceCategory `json:"twitchCategory"`
	YouTubeCategory ServiceCategory `json:"youtubeCategory"`
	Tags            []string        `json:"tags"`
	Notes           string          `json:"notes"` // freeform planning context
	CreatedAt       string          `json:"createdAt"`
	// IsDefault marks the series preselected when planning; at most one
	// series holds it (see SetDefaultContentSeries).
	IsDefault bool `json:"isDefault"`
	// TypeID references a SeriesType ("" = untyped); see series_types.go.
	TypeID string `json:"typeId"`
	// Smart-source mapping for episodic series: while an episode of this
	// series is on the air, the mapped OBS text sources are kept updated with
	// the episode's title and number (see SmartSourcesUpdater). Either source
	// may be empty to map just one.
	SmartEpisodeInfo    bool   `json:"smartEpisodeInfo"`
	EpisodeTitleSource  string `json:"episodeTitleSource"`
	EpisodeNumberSource string `json:"episodeNumberSource"`
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
	// A category per connected broadcast service is mandatory — it is what
	// updates the stream information on that platform when the series airs.
	// Only connected services are enforced: their catalogues are the only
	// source of valid category IDs.
	if _, ok := a.getConn("twitch"); ok && series.TwitchCategory.ID == "" {
		return series, fmt.Errorf("choose a Twitch category for this series")
	}
	if _, ok := a.getConn("youtube"); ok && series.YouTubeCategory.ID == "" {
		return series, fmt.Errorf("choose a YouTube category for this series")
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
			// The default flag is managed by SetDefaultContentSeries, not the
			// edit form; an edit must not silently drop it.
			series.IsDefault = s.IsDefault
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

// SetDefaultContentSeries marks one series (by ID) as the default,
// unsetting whichever held it before — at most one series is the default at
// a time. An empty id clears the default entirely.
func (a *App) SetDefaultContentSeries(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.GetContentSeries()
	found := id == ""
	for i := range all {
		all[i].IsDefault = all[i].ID == id
		if all[i].IsDefault {
			found = true
		}
	}
	if !found {
		return fmt.Errorf("that series no longer exists")
	}
	return a.store.setJSON(keyContentSeries, all)
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

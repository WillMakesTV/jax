package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Series types
//
// A SeriesType classifies content series (e.g. "Weekly show", "One-off
// special"): a title, whether the series is episodic, and a longer
// description. Content series reference a type by id (ContentSeries.TypeID).
// Stored as a single JSON blob in the settings table, like the series.
// ---------------------------------------------------------------------------

// SeriesType is one way a content series can be classified.
type SeriesType struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Episodic    bool   `json:"episodic"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
	// IsDefault marks the type preselected when planning; at most one type
	// holds it (see SetDefaultSeriesType).
	IsDefault bool `json:"isDefault"`
}

// GetSeriesTypes returns the saved series types, newest first. Never nil.
func (a *App) GetSeriesTypes() []SeriesType {
	if a.store == nil {
		return []SeriesType{}
	}
	var types []SeriesType
	if _, err := a.store.getJSON(keySeriesTypes, &types); err != nil {
		log.Printf("jax: GetSeriesTypes: %v", err)
	}
	if types == nil {
		return []SeriesType{}
	}
	return types
}

// SaveSeriesType upserts a series type (matched by ID), assigning an ID and
// creation time on first save, and returns the stored value.
func (a *App) SaveSeriesType(seriesType SeriesType) (SeriesType, error) {
	if a.store == nil {
		return seriesType, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(seriesType.Title) == "" {
		return seriesType, fmt.Errorf("a title is required")
	}

	all := a.GetSeriesTypes()
	if seriesType.ID == "" {
		seriesType.ID = fmt.Sprintf("stype_%d", time.Now().UnixNano())
	}
	if seriesType.CreatedAt == "" {
		seriesType.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, t := range all {
		if t.ID == seriesType.ID {
			// The default flag is managed by SetDefaultSeriesType, not the
			// edit form; an edit must not silently drop it.
			seriesType.IsDefault = t.IsDefault
			all[i] = seriesType
			replaced = true
			break
		}
	}
	if !replaced {
		all = append([]SeriesType{seriesType}, all...)
	}

	if err := a.store.setJSON(keySeriesTypes, all); err != nil {
		return seriesType, err
	}
	return seriesType, nil
}

// SetDefaultSeriesType marks one series type (by ID) as the default,
// unsetting whichever held it before — at most one type is the default at a
// time. An empty id clears the default entirely.
func (a *App) SetDefaultSeriesType(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.GetSeriesTypes()
	found := id == ""
	for i := range all {
		all[i].IsDefault = all[i].ID == id
		if all[i].IsDefault {
			found = true
		}
	}
	if !found {
		return fmt.Errorf("that series type no longer exists")
	}
	return a.store.setJSON(keySeriesTypes, all)
}

// DeleteSeriesType removes a series type by ID and clears the reference from
// any content series that used it, so no series points at a missing type.
func (a *App) DeleteSeriesType(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.GetSeriesTypes()
	out := make([]SeriesType, 0, len(all))
	for _, t := range all {
		if t.ID != id {
			out = append(out, t)
		}
	}
	if err := a.store.setJSON(keySeriesTypes, out); err != nil {
		return err
	}

	series := a.GetContentSeries()
	changed := false
	for i := range series {
		if series[i].TypeID == id {
			series[i].TypeID = ""
			changed = true
		}
	}
	if changed {
		return a.store.setJSON(keyContentSeries, series)
	}
	return nil
}

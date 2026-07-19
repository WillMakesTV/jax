package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Stream widgets
//
// A stream widget is an on-stream element the producer defines and manages
// from the OBS section's Stream Widgets tab. The model starts minimal — a
// required name — and grows properties as the feature does. Widgets are
// stored as a single JSON blob in the settings table, like routines.
// ---------------------------------------------------------------------------

// StreamWidget is one stream widget.
type StreamWidget struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"` // RFC3339
}

// getStreamWidgets reads the raw stored widget list. Never nil.
func (a *App) getStreamWidgets() []StreamWidget {
	if a.store == nil {
		return []StreamWidget{}
	}
	var widgets []StreamWidget
	if _, err := a.store.getJSON(keyStreamWidgets, &widgets); err != nil {
		log.Printf("jax: getStreamWidgets: %v", err)
	}
	if widgets == nil {
		return []StreamWidget{}
	}
	return widgets
}

// GetStreamWidgets returns the saved stream widgets, newest first. Never nil.
func (a *App) GetStreamWidgets() []StreamWidget {
	return a.getStreamWidgets()
}

// SaveStreamWidget upserts a stream widget (matched by ID), assigning an ID
// and creation time on first save, and returns the stored value. A name is
// required.
func (a *App) SaveStreamWidget(w StreamWidget) (StreamWidget, error) {
	if a.store == nil {
		return w, fmt.Errorf("storage unavailable")
	}
	w.Name = strings.TrimSpace(w.Name)
	if w.Name == "" {
		return w, fmt.Errorf("a widget name is required")
	}

	all := a.getStreamWidgets()
	if w.ID == "" {
		w.ID = fmt.Sprintf("widget_%d", time.Now().UnixNano())
	}
	if w.CreatedAt == "" {
		w.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, existing := range all {
		if existing.ID == w.ID {
			all[i] = w
			replaced = true
			break
		}
	}
	if !replaced {
		all = append([]StreamWidget{w}, all...)
	}

	if err := a.store.setJSON(keyStreamWidgets, all); err != nil {
		return w, err
	}
	return w, nil
}

// DeleteStreamWidget removes a stream widget.
func (a *App) DeleteStreamWidget(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.getStreamWidgets()
	out := make([]StreamWidget, 0, len(all))
	for _, w := range all {
		if w.ID != id {
			out = append(out, w)
		}
	}
	return a.store.setJSON(keyStreamWidgets, out)
}

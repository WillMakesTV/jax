package main

import (
	"fmt"
	"log"
	"strings"
)

// ---------------------------------------------------------------------------
// Past-stream titles
//
// A past stream's title normally comes from its platform broadcasts (Twitch
// preferred — see pickStreamTitle). The platforms' titles carry live-stream
// decorations and can't always be edited after the fact, so a past stream
// can carry its own title, renamed on its details page. Stored as a
// startedAt → title map like custom descriptions and thumbnails; clearing
// the override falls back to the platform title.
// ---------------------------------------------------------------------------

// keyStreamTitles stores the startedAt → custom title map.
const keyStreamTitles = "past_stream_titles"

// streamTitles loads the saved startedAt → title map. Never nil.
func (a *App) streamTitles() map[string]string {
	m := map[string]string{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamTitles, &m); err != nil {
			log.Printf("jax: load stream titles: %v", err)
		}
	}
	if m == nil {
		return map[string]string{}
	}
	return m
}

// SetStreamTitle renames the past stream that started at startedAt. Clearing
// the text removes the override, falling back to the platform title.
func (a *App) SetStreamTitle(startedAt, title string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	if strings.TrimSpace(startedAt) == "" {
		return fmt.Errorf("no stream identified")
	}
	m := a.streamTitles()
	if strings.TrimSpace(title) == "" {
		delete(m, startedAt)
	} else {
		m[startedAt] = strings.TrimSpace(title)
	}
	return a.store.setJSON(keyStreamTitles, m)
}

// applyStreamTitles resolves each stream's effective title: the user's
// rename wins, then the concluded plan's title — concluding an episode moves
// the plan onto the stream, so the past stream keeps the name it was planned
// under — and otherwise the platform title stands. CustomTitle carries only
// the explicit rename so the UI can tell it apart (and offer to reset it).
func (a *App) applyStreamTitles(out []PastStream) {
	m := a.streamTitles()
	for i := range out {
		if t, ok := m[out[i].StartedAt]; ok && strings.TrimSpace(t) != "" {
			out[i].CustomTitle = t
			out[i].Title = t
			continue
		}
		if out[i].Plan != nil && strings.TrimSpace(out[i].Plan.Title) != "" {
			out[i].Title = strings.TrimSpace(out[i].Plan.Title)
		}
	}
}

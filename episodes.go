package main

import (
	"fmt"
	"log"
	"sort"
)

// ---------------------------------------------------------------------------
// Stream episodes
//
// When a past stream belongs to a content series whose series type is
// episodic, the stream carries an episode number and a short description.
// Assignments persist per broadcast key (the same identity series assignments
// use, so they survive refetches). A number only ever comes from the stream's
// planned broadcast — registered at go-live and adopted onto the finished
// VODs (see past.go) — or from an edit on the stream's details page: the
// planned episode and the past stream's are one and the same, never invented
// here.
// ---------------------------------------------------------------------------

// StreamEpisode is a past stream's place in an episodic series.
type StreamEpisode struct {
	Number      int    `json:"number"`
	Description string `json:"description"`
}

// keyStreamEpisodes stores the broadcastKey -> StreamEpisode assignments.
const keyStreamEpisodes = "past_stream_episodes"

// streamEpisodes loads the saved broadcastKey -> episode map. Never nil.
func (a *App) streamEpisodes() map[string]StreamEpisode {
	m := map[string]StreamEpisode{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamEpisodes, &m); err != nil {
			log.Printf("jax: load stream episodes: %v", err)
		}
	}
	if m == nil {
		return map[string]StreamEpisode{}
	}
	return m
}

// SetStreamEpisode assigns an episode number and short description to the
// past stream identified by its broadcast keys ("platform|url"). A number
// below 1 clears the assignment (the stream then shows no episode).
func (a *App) SetStreamEpisode(keys []string, number int, description string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	m := a.streamEpisodes()
	for _, k := range keys {
		if number < 1 {
			delete(m, k)
		} else {
			m[k] = StreamEpisode{Number: number, Description: description}
		}
	}
	return a.store.setJSON(keyStreamEpisodes, m)
}

// applyStreamEpisodes decorates streams with their stored episode data.
// Numbers are never invented here: streams used to be auto-numbered by date
// on first sight, but that handed out numbers the planning flow had already
// spoken for — a past stream would show an episode separate from its plan's,
// and the duplicates inflated the series' numbering. A stream without an
// assignment simply shows no episode until its plan's adopts or the user
// sets one.
func (a *App) applyStreamEpisodes(out []PastStream) {
	stored := a.streamEpisodes()
	if len(stored) == 0 {
		return
	}
	for i := range out {
		for _, b := range out[i].Broadcasts {
			if e, ok := stored[broadcastKey(b)]; ok {
				out[i].EpisodeNumber = e.Number
				out[i].EpisodeDescription = e.Description
				break
			}
		}
	}
}

// UsedEpisodeNumbers returns every episode number a series has already
// spoken for, ascending: its past streams, its open plans, and the broadcast
// currently on the air (whose assignment still sits under a live key, see
// past.go). Planning validates against this so a number is never reused.
func (a *App) UsedEpisodeNumbers(seriesID string) []int {
	if seriesID == "" {
		return []int{}
	}
	seen := map[int]bool{}
	for _, s := range a.GetPastStreams(false) {
		if s.SeriesID == seriesID && s.EpisodeNumber > 0 {
			seen[s.EpisodeNumber] = true
		}
	}
	for _, p := range a.GetPlannedStreams() {
		if p.SeriesID == seriesID && p.EpisodeNumber > 0 {
			seen[p.EpisodeNumber] = true
		}
	}
	series := a.pastStreamSeries()
	for key, e := range a.streamEpisodes() {
		if _, ok := parseLiveKey(key); !ok {
			continue
		}
		if series[key] == seriesID && e.Number > 0 {
			seen[e.Number] = true
		}
	}

	out := make([]int, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Ints(out)
	return out
}

// NextEpisodeNumber returns the number the series' next stream should carry:
// one past the highest episode already used anywhere in the series.
func (a *App) NextEpisodeNumber(seriesID string) int {
	used := a.UsedEpisodeNumbers(seriesID)
	if len(used) == 0 {
		return 1
	}
	return used[len(used)-1] + 1
}

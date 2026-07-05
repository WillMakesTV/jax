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
// use, so they survive refetches); streams without one are initialised
// sequentially by broadcast date — the series' oldest stream is episode one —
// continuing after the highest number already assigned. The details page can
// then edit both fields per stream.
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
// below 1 clears the assignment (it re-initialises on the next load).
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

// episodicSeriesIDs returns the ids of content series whose type is episodic.
func (a *App) episodicSeriesIDs() map[string]bool {
	episodicTypes := map[string]bool{}
	for _, t := range a.GetSeriesTypes() {
		if t.Episodic {
			episodicTypes[t.ID] = true
		}
	}
	ids := map[string]bool{}
	if len(episodicTypes) == 0 {
		return ids
	}
	for _, s := range a.GetContentSeries() {
		if episodicTypes[s.TypeID] {
			ids[s.ID] = true
		}
	}
	return ids
}

// applyStreamEpisodes decorates episodic-series streams with their episode
// data, first initialising any unnumbered streams by date so every stream of
// an episodic series always shows a number.
func (a *App) applyStreamEpisodes(out []PastStream) {
	episodic := a.episodicSeriesIDs()
	if len(episodic) == 0 {
		return
	}
	stored := a.streamEpisodes()

	episodeOf := func(s PastStream) (StreamEpisode, bool) {
		for _, b := range s.Broadcasts {
			if e, ok := stored[broadcastKey(b)]; ok {
				return e, true
			}
		}
		return StreamEpisode{}, false
	}

	// Index each episodic series' streams, oldest first, so initialisation
	// numbers them in broadcast order (episode one = the first stream).
	bySeries := map[string][]int{}
	for i, s := range out {
		if s.SeriesID != "" && episodic[s.SeriesID] {
			bySeries[s.SeriesID] = append(bySeries[s.SeriesID], i)
		}
	}

	changed := false
	for _, idxs := range bySeries {
		sort.Slice(idxs, func(x, y int) bool {
			return out[idxs[x]].StartedAt < out[idxs[y]].StartedAt
		})
		// New assignments continue after the highest number already given
		// (user edits win; a fresh series starts at one).
		next := 1
		for _, i := range idxs {
			if e, ok := episodeOf(out[i]); ok && e.Number >= next {
				next = e.Number + 1
			}
		}
		for _, i := range idxs {
			e, ok := episodeOf(out[i])
			if !ok {
				e = StreamEpisode{Number: next}
				next++
				for _, b := range out[i].Broadcasts {
					stored[broadcastKey(b)] = e
				}
				changed = true
			}
			out[i].EpisodeNumber = e.Number
			out[i].EpisodeDescription = e.Description
		}
	}

	if changed && a.store != nil {
		if err := a.store.setJSON(keyStreamEpisodes, stored); err != nil {
			log.Printf("jax: save stream episodes: %v", err)
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

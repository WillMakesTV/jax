package main

import (
	"fmt"
	"log"
	"strings"
)

// ---------------------------------------------------------------------------
// Past-stream thumbnails
//
// Platforms usually provide a VOD thumbnail, but local-only streams (and
// expired VODs) have none. A past stream can therefore carry its own
// generated or uploaded thumbnail, produced the same way as plan thumbnails
// (see plan_thumbs.go) but briefed from the stream's AI outline instead of a
// plan description. Files live in the shared plan-thumbs folder; the store
// keeps a startedAt → record map, mirroring how outlines are keyed.
// ---------------------------------------------------------------------------

// keyStreamThumbs stores the startedAt → custom-thumbnail assignments.
const keyStreamThumbs = "past_stream_thumbs"

// storedStreamThumb is the persisted record: the current file and the
// replaced predecessors (newest first, for one-click restore).
type storedStreamThumb struct {
	File    string   `json:"file"`
	History []string `json:"history"`
}

// StreamThumbInfo is a stream's custom thumbnail as served to the frontend:
// the stored file names plus their resolved media-server URLs, and which file
// was last pushed to YouTube (so the UI can offer to sync a changed one).
type StreamThumbInfo struct {
	File         string   `json:"file"`
	URL          string   `json:"url"`
	HistoryFiles []string `json:"historyFiles"`
	HistoryURLs  []string `json:"historyUrls"`
	// PushedFile is the custom file YouTube last received via
	// UpdateYouTubeThumbnail ("" when never pushed). When it differs from
	// File, YouTube is showing an older image.
	PushedFile string `json:"pushedFile"`
}

// streamThumbs loads the saved startedAt → thumbnail map. Never nil.
func (a *App) streamThumbs() map[string]storedStreamThumb {
	m := map[string]storedStreamThumb{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamThumbs, &m); err != nil {
			log.Printf("jax: load stream thumbnails: %v", err)
		}
	}
	if m == nil {
		return map[string]storedStreamThumb{}
	}
	return m
}

// thumbInfo resolves a stored record to its served form.
func (a *App) thumbInfo(rec storedStreamThumb, pushedFile string) StreamThumbInfo {
	return StreamThumbInfo{
		File:         rec.File,
		URL:          a.planThumbURL(rec.File),
		HistoryFiles: append([]string{}, rec.History...),
		HistoryURLs:  a.planThumbHistoryURLs(rec.History),
		PushedFile:   pushedFile,
	}
}

// SetStreamThumbnail assigns a custom thumbnail file to the past stream that
// started at startedAt, folding the replaced image into the history. An empty
// file clears the thumbnail (the history stays restorable). Returns the
// updated record for the frontend to reflect.
func (a *App) SetStreamThumbnail(startedAt, file string) (StreamThumbInfo, error) {
	if a.store == nil {
		return StreamThumbInfo{}, fmt.Errorf("storage is unavailable")
	}
	if strings.TrimSpace(startedAt) == "" {
		return StreamThumbInfo{}, fmt.Errorf("no stream identified")
	}
	m := a.streamThumbs()
	rec := m[startedAt]
	file = sanitizeThumbFile(file)
	rec.History = updateThumbHistory(rec.History, rec.File, file)
	rec.File = file
	if rec.File == "" && len(rec.History) == 0 {
		delete(m, startedAt)
	} else {
		m[startedAt] = rec
	}
	if err := a.store.setJSON(keyStreamThumbs, m); err != nil {
		return StreamThumbInfo{}, err
	}
	return a.thumbInfo(rec, a.thumbPushes()[startedAt]), nil
}

// adoptPlanThumbs carries a concluded plan's thumbnail onto its finished
// stream: a stream whose plan brought a thumbnail and that has never had a
// custom thumbnail of its own adopts the plan's file (both live in the
// shared plan-thumbs folder). Non-clobbering: any existing record — even a
// cleared one, whose history keeps the record alive — wins, so a choice
// made on the stream's page is never overwritten. From there the stream
// page's usual generate/revise/upload options apply.
func (a *App) adoptPlanThumbs(out []PastStream) {
	if a.store == nil {
		return
	}
	m := a.streamThumbs()
	changed := false
	for i := range out {
		p := out[i].Plan
		if p == nil {
			continue
		}
		file := sanitizeThumbFile(p.ThumbnailFile)
		if file == "" {
			continue
		}
		if _, ok := m[out[i].StartedAt]; ok {
			continue
		}
		m[out[i].StartedAt] = storedStreamThumb{File: file}
		changed = true
	}
	if changed {
		if err := a.store.setJSON(keyStreamThumbs, m); err != nil {
			log.Printf("jax: adopt plan thumbnails: %v", err)
		}
	}
}

// applyStreamThumbs attaches custom thumbnails to the aggregated past
// streams. A set custom file also becomes the stream's ThumbnailURL, taking
// precedence over the platform image — the user chose it deliberately.
func (a *App) applyStreamThumbs(out []PastStream) {
	m := a.streamThumbs()
	if len(m) == 0 {
		return
	}
	pushes := a.thumbPushes()
	for i := range out {
		rec, ok := m[out[i].StartedAt]
		if !ok {
			continue
		}
		info := a.thumbInfo(rec, pushes[out[i].StartedAt])
		out[i].CustomThumb = &info
		if info.URL != "" {
			out[i].ThumbnailURL = info.URL
		}
	}
}

// pastStreamThumbContext steers generation away from live-broadcast styling:
// these thumbnails represent a finished VOD, so "LIVE" tags and on-air
// framing would be wrong.
const pastStreamThumbContext = "This thumbnail is for a PAST broadcast — a finished stream now available as a video on demand. Do not include any \"LIVE\" text, live badges, on-air indicators, or other live-broadcast framing."

// GenerateStreamThumbnail creates (or revises) a thumbnail for a past stream.
// The creative input is the stream's title plus its AI outline, so an outline
// must exist first. Persisting the result on the stream is the frontend's
// call (SetStreamThumbnail), matching how plan thumbnails apply.
func (a *App) GenerateStreamThumbnail(startedAt, title, feedback, currentFile string) (PlanThumbnail, error) {
	outline, err := a.GetStreamOutline(startedAt)
	if err != nil {
		return PlanThumbnail{}, err
	}
	if outline.GeneratedAt == "" {
		return PlanThumbnail{}, fmt.Errorf("this stream has no outline yet — generate one on the Outline tab first, it's what the thumbnail is briefed from")
	}

	var b strings.Builder
	b.WriteString(strings.TrimSpace(outline.Summary))
	if len(outline.Items) > 0 {
		b.WriteString("\n\nWhat happened on the stream:\n")
		for _, item := range outline.Items {
			fmt.Fprintf(&b, "- %s", item.Title)
			if strings.TrimSpace(item.Note) != "" {
				fmt.Fprintf(&b, ": %s", strings.TrimSpace(item.Note))
			}
			b.WriteString("\n")
		}
	}
	// A past broadcast's thumbnail is the VOD's card — always the 16:9 frame.
	return a.generateThumbnail(title, b.String(), pastStreamThumbContext, feedback, currentFile, landscapeThumb)
}

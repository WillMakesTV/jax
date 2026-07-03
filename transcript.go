package main

import (
	"fmt"
	"log"
	"time"
)

// ---------------------------------------------------------------------------
// Transcript persistence
//
// The frontend opens a session when capture starts (keyed by the live
// stream's start timestamp) and appends each transcribed utterance. Past
// streams look their log up by timing — the same margin-based matching that
// groups broadcasts into one stream (see past.go).
// ---------------------------------------------------------------------------

// TranscriptLineRec is one stored utterance.
type TranscriptLineRec struct {
	At    int64  `json:"at"`    // unix millis, start of the utterance
	EndAt int64  `json:"endAt"` // unix millis, end of the utterance
	Text  string `json:"text"`
}

// BeginTranscriptSession opens (or reopens) the transcript log for a stream,
// identified by its start timestamp (RFC3339). Returns the session id used
// with AddTranscriptLine.
func (a *App) BeginTranscriptSession(startedAt, title string) (int64, error) {
	if a.store == nil {
		return 0, fmt.Errorf("storage is unavailable")
	}
	return a.store.beginTranscriptSession(startedAt, title)
}

// AddTranscriptLine appends one transcribed utterance to a session's log.
func (a *App) AddTranscriptLine(sessionID, at, endAt int64, text string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	return a.store.addTranscriptLine(sessionID, at, endAt, text)
}

// GetTranscriptForStream returns the stored transcript for a stream, matching
// sessions whose stream start lies within the configured matching margin of
// startedAt (RFC3339). Never returns nil.
func (a *App) GetTranscriptForStream(startedAt string) []TranscriptLineRec {
	if a.store == nil {
		return []TranscriptLineRec{}
	}
	target, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return []TranscriptLineRec{}
	}
	sessions, err := a.store.getTranscriptSessions()
	if err != nil {
		log.Printf("jax: transcript sessions: %v", err)
		return []TranscriptLineRec{}
	}

	margin := a.pastMatchMargin()
	ids := []int64{}
	for _, s := range sessions {
		at, err := time.Parse(time.RFC3339, s.startedAt)
		if err != nil {
			continue
		}
		dt := target.Sub(at)
		if dt < 0 {
			dt = -dt
		}
		if dt <= margin {
			ids = append(ids, s.id)
		}
	}

	lines, err := a.store.getTranscriptLines(ids)
	if err != nil {
		log.Printf("jax: transcript lines: %v", err)
		return []TranscriptLineRec{}
	}
	return lines
}

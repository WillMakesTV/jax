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

// streamAnchorTimes returns every timestamp that identifies the stream
// startedAt belongs to: the time itself, plus each broadcast go-live of the
// aggregated past stream containing it. A stream's segments can start further
// apart than the matching margin (manual groups make the group the identity,
// not timing), and the aggregate's StartedAt is the most recent segment while
// downloads anchor to the earliest — so a transcript anchored to any segment
// must count for the whole stream.
func (a *App) streamAnchorTimes(target time.Time, margin time.Duration) []time.Time {
	anchors := []time.Time{target}
	for _, ps := range a.GetPastStreams(false) {
		starts := make([]time.Time, 0, len(ps.Broadcasts)+1)
		if t, err := time.Parse(time.RFC3339, ps.StartedAt); err == nil {
			starts = append(starts, t)
		}
		for _, b := range ps.Broadcasts {
			if t, err := time.Parse(time.RFC3339, b.StartedAt); err == nil {
				starts = append(starts, t)
			}
		}
		for _, t := range starts {
			if absDuration(target.Sub(t)) <= margin {
				return append(anchors, starts...)
			}
		}
	}
	return anchors
}

// matchingTranscriptSessionIDs returns the ids of sessions whose stream start
// lies within the configured matching margin of the stream startedAt (RFC3339)
// belongs to — matched against every segment of the aggregated stream, not
// just the given timestamp, so multi-segment and manually grouped streams find
// transcripts anchored to any of their broadcasts.
func (a *App) matchingTranscriptSessionIDs(startedAt string) ([]int64, error) {
	target, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return nil, fmt.Errorf("invalid stream start %q: %w", startedAt, err)
	}
	sessions, err := a.store.getTranscriptSessions()
	if err != nil {
		return nil, err
	}

	margin := a.pastMatchMargin()
	anchors := a.streamAnchorTimes(target, margin)
	ids := []int64{}
	for _, s := range sessions {
		at, err := time.Parse(time.RFC3339, s.startedAt)
		if err != nil {
			continue
		}
		for _, anchor := range anchors {
			if absDuration(anchor.Sub(at)) <= margin {
				ids = append(ids, s.id)
				break
			}
		}
	}
	return ids, nil
}

// GetTranscriptForStream returns the stored transcript for a stream, matching
// sessions whose stream start lies within the configured matching margin of
// startedAt (RFC3339). Never returns nil.
func (a *App) GetTranscriptForStream(startedAt string) []TranscriptLineRec {
	if a.store == nil {
		return []TranscriptLineRec{}
	}
	ids, err := a.matchingTranscriptSessionIDs(startedAt)
	if err != nil {
		log.Printf("jax: transcript sessions: %v", err)
		return []TranscriptLineRec{}
	}

	lines, err := a.store.getTranscriptLines(ids)
	if err != nil {
		log.Printf("jax: transcript lines: %v", err)
		return []TranscriptLineRec{}
	}
	return lines
}

// replaceTranscriptForStream swaps out every transcript session matching the
// stream (e.g. the one captured live) for a single new session holding the
// supplied lines.
func (a *App) replaceTranscriptForStream(startedAt, title string, lines []TranscriptLineRec) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	ids, err := a.matchingTranscriptSessionIDs(startedAt)
	if err != nil {
		return err
	}
	return a.store.replaceTranscript(ids, startedAt, title, lines)
}

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Stream outlines
//
// An outline is an AI-generated, timestamped table of contents for a past
// stream, built from the stored transcript and chat log. Generation runs on
// the connected AI service via askAI (see ai.go): subscription accounts go
// through Claude Code / Codex headless, API keys call the raw APIs.
// Outlines persist per stream (keyed by start time) so they generate once.
// ---------------------------------------------------------------------------

// OutlineItem is one entry in a stream's outline.
type OutlineItem struct {
	At    string `json:"at"` // "H:MM:SS" offset from the stream start
	Title string `json:"title"`
	Note  string `json:"note"`
}

// StreamOutline is the stored outline for one past stream.
type StreamOutline struct {
	StartedAt   string        `json:"startedAt"`
	GeneratedAt string        `json:"generatedAt"` // RFC3339; "" = none stored
	Model       string        `json:"model"`
	Summary     string        `json:"summary"`
	Items       []OutlineItem `json:"items"`
}

const keyOutlinePrefix = "stream_outline|"

// In-flight generations, keyed by stream start time, so the UI can show
// progress after navigating away and back, and double-runs are rejected.
var (
	outlineMu   sync.Mutex
	outlineJobs = map[string]bool{}
)

const outlineInstructions = `You are producing a timestamped outline of a live stream broadcast for the streamer's own notes.

The input contains the stream's spoken transcript and its viewer chat log. Every line is prefixed with a [H:MM:SS] timestamp measured from the stream start.

Respond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:
{"summary": "...", "items": [{"at": "H:MM:SS", "title": "...", "note": "..."}]}

Rules:
- "summary": 2-4 sentences describing the stream overall.
- "items": the outline, in chronological order — typically 8 to 20 entries covering the whole stream.
- "at": the timestamp where that segment begins, copied from the input's offsets.
- "title": a short segment heading (a few words).
- "note": 1-2 sentences on what happened; weave in notable chat moments or questions when they shaped the segment.`

// GetStreamOutline returns the stored outline for a stream ("" GeneratedAt
// when none exists yet).
func (a *App) GetStreamOutline(startedAt string) (StreamOutline, error) {
	out := StreamOutline{StartedAt: startedAt, Items: []OutlineItem{}}
	if a.store == nil {
		return out, fmt.Errorf("storage unavailable")
	}
	if _, err := a.store.getJSON(keyOutlinePrefix+startedAt, &out); err != nil {
		return out, err
	}
	if out.Items == nil {
		out.Items = []OutlineItem{}
	}
	return out, nil
}

// OutlineInProgress reports whether an outline is currently being generated
// for the stream.
func (a *App) OutlineInProgress(startedAt string) bool {
	outlineMu.Lock()
	defer outlineMu.Unlock()
	return outlineJobs[startedAt]
}

// GenerateStreamOutline builds (or rebuilds) a stream's outline from its
// stored chat and transcript and persists it. Blocks until generation
// finishes — the frontend reflects progress while awaiting.
func (a *App) GenerateStreamOutline(startedAt string, durationSecs int) (StreamOutline, error) {
	var out StreamOutline
	if a.store == nil {
		return out, fmt.Errorf("storage unavailable")
	}
	if _, _, err := a.aiConn(); err != nil {
		return out, err
	}

	outlineMu.Lock()
	if outlineJobs[startedAt] {
		outlineMu.Unlock()
		return out, fmt.Errorf("an outline is already being generated for this stream")
	}
	outlineJobs[startedAt] = true
	outlineMu.Unlock()
	defer func() {
		outlineMu.Lock()
		delete(outlineJobs, startedAt)
		outlineMu.Unlock()
	}()

	input, err := a.outlineInput(startedAt, durationSecs)
	if err != nil {
		return out, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	text, model, err := a.askAI(ctx, outlineInstructions, input)
	if err != nil {
		return out, err
	}

	out, err = parseOutline(text)
	if err != nil {
		return out, err
	}
	out.StartedAt = startedAt
	out.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	out.Model = model
	if err := a.store.setJSON(keyOutlinePrefix+startedAt, out); err != nil {
		return out, err
	}
	return out, nil
}

// outlineInput assembles the timestamped transcript + chat document the
// model reads. Errors when neither source has any content.
func (a *App) outlineInput(startedAt string, durationSecs int) (string, error) {
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return "", fmt.Errorf("invalid stream start %q: %v", startedAt, err)
	}
	startMs := start.UnixMilli()

	transcript := a.GetTranscriptForStream(startedAt)
	chat := a.GetChatForStream(startedAt, durationSecs)
	if len(transcript) == 0 && len(chat) == 0 {
		return "", fmt.Errorf("no transcript or chat is stored for this stream yet")
	}

	// Soft cap per section keeps degenerate cases (marathon streams, spam
	// floods) from ballooning the prompt; the outline loses tail detail
	// rather than failing.
	const sectionCap = 400_000

	var b strings.Builder
	b.WriteString("# Transcript\n")
	if len(transcript) == 0 {
		b.WriteString("(no transcript was captured)\n")
	}
	sectionStart := b.Len()
	for _, line := range transcript {
		if b.Len()-sectionStart > sectionCap {
			b.WriteString("[transcript truncated]\n")
			break
		}
		fmt.Fprintf(&b, "[%s] %s\n", offsetStamp(line.At, startMs), line.Text)
	}

	b.WriteString("\n# Chat\n")
	if len(chat) == 0 {
		b.WriteString("(no chat was captured)\n")
	}
	sectionStart = b.Len()
	for _, m := range chat {
		if b.Len()-sectionStart > sectionCap {
			b.WriteString("[chat truncated]\n")
			break
		}
		fmt.Fprintf(&b, "[%s] %s: %s\n", offsetStamp(m.At, startMs), m.Author, m.Text)
	}
	return b.String(), nil
}

// offsetStamp renders unix-millis at as "H:MM:SS" from the stream start.
func offsetStamp(atMs, startMs int64) string {
	secs := (atMs - startMs) / 1000
	if secs < 0 {
		secs = 0
	}
	return fmt.Sprintf("%d:%02d:%02d", secs/3600, (secs/60)%60, secs%60)
}

// parseOutline extracts the outline JSON from the model's response,
// tolerating stray prose or code fences around the object.
func parseOutline(text string) (StreamOutline, error) {
	var out StreamOutline
	lo := strings.Index(text, "{")
	hi := strings.LastIndex(text, "}")
	if lo < 0 || hi <= lo {
		return out, fmt.Errorf("the model returned an unexpected format — try again")
	}
	if err := json.Unmarshal([]byte(text[lo:hi+1]), &out); err != nil {
		return out, fmt.Errorf("the model returned an unexpected format — try again")
	}
	if out.Items == nil {
		out.Items = []OutlineItem{}
	}
	if strings.TrimSpace(out.Summary) == "" && len(out.Items) == 0 {
		return out, fmt.Errorf("the model returned an empty outline — try again")
	}
	return out, nil
}

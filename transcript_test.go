package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writeTestDownload materialises a download subfolder: a manifest plus a dummy
// playable file so GetDownloads lists it.
func writeTestDownload(t *testing.T, dir, sub string, dv DownloadedVideo) {
	t.Helper()
	folder := filepath.Join(dir, sub)
	if err := os.MkdirAll(folder, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "video.mp4"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(dv)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "manifest.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

// A stream's segments can start further apart than the matching margin (here a
// manual group, like a crashed-and-restarted broadcast). The aggregate's
// StartedAt is the most recent segment while the download — and therefore its
// transcript — anchors to the earliest, so the transcript must be found when
// looked up by either segment's time.
func TestTranscriptMatchesEveryStreamSegment(t *testing.T) {
	a := newTestApp(t)
	dlDir := t.TempDir()
	if err := a.store.setSetting("download_dir", dlDir); err != nil {
		t.Fatal(err)
	}

	const (
		partOneStart = "2026-06-29T04:01:03Z"
		mainStart    = "2026-06-29T04:18:19Z" // 17m16s later — beyond the 5m margin
		partOneURL   = "https://youtube.com/watch?v=part1"
		mainURL      = "https://youtube.com/watch?v=main"
	)
	writeTestDownload(t, dlDir, "ep2-part-one", DownloadedVideo{
		Title: "Episode 2 (part one)", Platform: "youtube",
		StartedAt: partOneStart, DurationSecs: 556, URLs: []string{partOneURL},
	})
	writeTestDownload(t, dlDir, "ep2-main", DownloadedVideo{
		Title: "Episode 2", Platform: "youtube",
		StartedAt: mainStart, DurationSecs: 2492, URLs: []string{mainURL},
	})
	if err := a.GroupPastStreams([]string{
		"youtube|" + partOneURL,
		"youtube|" + mainURL,
	}); err != nil {
		t.Fatalf("group: %v", err)
	}

	// The transcript lands anchored to the earliest segment, as transcribing
	// the merged download stores it.
	sid, err := a.BeginTranscriptSession(partOneStart, "Episode 2")
	if err != nil {
		t.Fatalf("begin session: %v", err)
	}
	if err := a.AddTranscriptLine(sid, 1, 2, "hello"); err != nil {
		t.Fatalf("add line: %v", err)
	}

	// The details page looks up by the aggregate's StartedAt (the later
	// segment) and must still find the transcript.
	if lines := a.GetTranscriptForStream(mainStart); len(lines) != 1 {
		t.Fatalf("lookup by later segment: got %d lines, want 1", len(lines))
	}
	if lines := a.GetTranscriptForStream(partOneStart); len(lines) != 1 {
		t.Fatalf("lookup by earlier segment: got %d lines, want 1", len(lines))
	}

	// A time belonging to no segment must not borrow the transcript.
	if lines := a.GetTranscriptForStream("2026-06-29T06:00:00Z"); len(lines) != 0 {
		t.Fatalf("unrelated lookup: got %d lines, want 0", len(lines))
	}
}

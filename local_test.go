package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writeDownload lays out one downloaded broadcast (manifest + video file) in
// the app's download dir and returns its subfolder name.
func writeDownload(t *testing.T, a *App, dv DownloadedVideo) string {
	t.Helper()
	folder := filepath.Join(a.resolveDownloadDir(), dv.Subfolder)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	raw, err := json.Marshal(dv)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(folder, "manifest.json"), raw, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(folder, dv.VideoFile), []byte("x"), 0o600); err != nil {
		t.Fatalf("write video: %v", err)
	}
	return dv.Subfolder
}

func TestMergeLocalBroadcasts(t *testing.T) {
	a := newTestApp(t)
	if err := a.store.setSetting("download_dir", t.TempDir()); err != nil {
		t.Fatalf("set download dir: %v", err)
	}

	const vodURL = "https://www.twitch.tv/videos/123"
	writeDownload(t, a, DownloadedVideo{
		ID:           "twitch|" + vodURL,
		Title:        "Episode 1",
		Platform:     "twitch",
		StartedAt:    "2026-06-28T03:43:45Z",
		DurationSecs: 6786,
		ViewCount:    14,
		URLs:         []string{vodURL},
		Subfolder:    "ep1",
		VideoFile:    "ep1.mp4",
	})

	// While the platform still lists the VOD, the broadcast passes through
	// unchanged and a snapshot is taken.
	live := PastBroadcast{
		Platform: "twitch", Title: "Episode 1 (platform)", URL: vodURL,
		StartedAt: "2026-06-28T03:43:45Z", Duration: "1h53m6s",
		DurationSecs: 6786, ViewCount: 20,
	}
	merged := a.mergeLocalBroadcasts([]PastBroadcast{live})
	if len(merged) != 1 || merged[0].Local {
		t.Fatalf("listed broadcast should pass through un-tagged: %+v", merged)
	}
	stored, err := a.store.getLocalBroadcasts()
	if err != nil || len(stored) != 1 {
		t.Fatalf("want one snapshot, got %v (err %v)", stored, err)
	}

	// Once the platform drops it, the snapshot is replayed marked Local,
	// keeping the platform's richer data (view count 20, not the manifest's).
	merged = a.mergeLocalBroadcasts(nil)
	if len(merged) != 1 || !merged[0].Local {
		t.Fatalf("dropped broadcast should be replayed Local: %+v", merged)
	}
	if merged[0].ViewCount != 20 || merged[0].Title != "Episode 1 (platform)" {
		t.Fatalf("replay should use the snapshot, got %+v", merged[0])
	}

	// A local-only broadcast aggregates into a Local past stream.
	streams := aggregatePastStreams(merged, defaultMatchMargin)
	if len(streams) != 1 || !streams[0].Local {
		t.Fatalf("want one Local past stream, got %+v", streams)
	}
}

func TestMergeLocalBroadcastsManifestFallback(t *testing.T) {
	a := newTestApp(t)
	if err := a.store.setSetting("download_dir", t.TempDir()); err != nil {
		t.Fatalf("set download dir: %v", err)
	}

	// A download that predates snapshotting: no local_broadcasts row exists,
	// so the manifest itself supplies the broadcast.
	const vodURL = "https://www.twitch.tv/videos/456"
	writeDownload(t, a, DownloadedVideo{
		ID:           "twitch|" + vodURL,
		Title:        "Episode 2",
		Platform:     "twitch",
		StartedAt:    "2026-06-29T03:00:00Z",
		DurationSecs: 6786,
		ViewCount:    14,
		URLs:         []string{vodURL},
		Subfolder:    "ep2",
		VideoFile:    "ep2.mp4",
	})

	merged := a.mergeLocalBroadcasts(nil)
	if len(merged) != 1 {
		t.Fatalf("want the manifest broadcast, got %+v", merged)
	}
	b := merged[0]
	if !b.Local || b.URL != vodURL || b.Platform != "twitch" {
		t.Fatalf("bad synthesized broadcast: %+v", b)
	}
	if b.Duration != "1h53m6s" || b.ViewCount != 14 {
		t.Fatalf("manifest fields not carried over: %+v", b)
	}
	// The synthesized broadcast is persisted so it is now in sqlite too.
	stored, err := a.store.getLocalBroadcasts()
	if err != nil || len(stored) != 1 {
		t.Fatalf("want the synthesized snapshot stored, got %v (err %v)", stored, err)
	}
}

func TestDeleteLocalStream(t *testing.T) {
	a := newTestApp(t)
	if err := a.store.setSetting("download_dir", t.TempDir()); err != nil {
		t.Fatalf("set download dir: %v", err)
	}

	const vodURL = "https://www.twitch.tv/videos/789"
	sub := writeDownload(t, a, DownloadedVideo{
		ID: "twitch|" + vodURL, Title: "Ep", Platform: "twitch",
		StartedAt: "2026-06-30T03:00:00Z", DurationSecs: 60,
		URLs: []string{vodURL}, Subfolder: "ep3", VideoFile: "ep3.mp4",
	})
	// Materialise the snapshot.
	if got := a.mergeLocalBroadcasts(nil); len(got) != 1 {
		t.Fatalf("setup: %+v", got)
	}

	for _, bad := range []string{"", ".", "..", `evil\..`, "../ep3"} {
		if err := a.DeleteLocalStream(bad); err == nil {
			t.Fatalf("want error for subfolder %q", bad)
		}
	}
	if err := a.DeleteLocalStream("nope"); err == nil {
		t.Fatal("want error for a folder without a manifest")
	}

	if err := a.DeleteLocalStream(sub); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(a.resolveDownloadDir(), sub)); !os.IsNotExist(err) {
		t.Fatalf("folder should be gone, stat err %v", err)
	}
	if got := a.mergeLocalBroadcasts(nil); len(got) != 0 {
		t.Fatalf("deleted stream should no longer merge: %+v", got)
	}
	if stored, _ := a.store.getLocalBroadcasts(); len(stored) != 0 {
		t.Fatalf("snapshots should be gone: %v", stored)
	}
}

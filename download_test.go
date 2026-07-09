package main

import (
	"strings"
	"testing"
	"time"
)

func TestResolveStreamDownloadPrefersSourcePerSegment(t *testing.T) {
	margin := 5 * time.Minute
	// One simulcast segment on both platforms, plus a second sitting that
	// aired on Twitch only.
	broadcasts := []PastBroadcast{
		{Platform: "twitch", URL: "https://twitch.tv/videos/1", StartedAt: "2026-07-01T19:00:00Z", DurationSecs: 3600, ViewCount: 10},
		{Platform: "youtube", URL: "https://youtu.be/a", StartedAt: "2026-07-01T19:01:00Z", DurationSecs: 3610, ViewCount: 25},
		{Platform: "twitch", URL: "https://twitch.tv/videos/2", StartedAt: "2026-07-01T22:00:00Z", DurationSecs: 1800, ViewCount: 5},
	}

	clusters := clusterPastBroadcasts(broadcasts, margin)
	if len(clusters) != 2 {
		t.Fatalf("want 2 segments, got %d: %+v", len(clusters), clusters)
	}

	// Auto prefers YouTube where available, falls back to Twitch.
	plan := resolveStreamDownload(clusters, "auto")
	if plan == nil {
		t.Fatal("want a plan")
	}
	wantURLs := []string{"https://youtu.be/a", "https://twitch.tv/videos/2"}
	if len(plan.urls) != 2 || plan.urls[0] != wantURLs[0] || plan.urls[1] != wantURLs[1] {
		t.Fatalf("auto urls = %v, want %v", plan.urls, wantURLs)
	}
	if plan.platform != "youtube" {
		t.Fatalf("auto platform = %q, want youtube", plan.platform)
	}

	// Twitch preference picks the Twitch VOD for the simulcast segment.
	plan = resolveStreamDownload(clusters, "twitch")
	if plan == nil || plan.urls[0] != "https://twitch.tv/videos/1" || plan.platform != "twitch" {
		t.Fatalf("twitch plan = %+v", plan)
	}
}

func TestResolveStreamDownloadSkipsURLlessBroadcasts(t *testing.T) {
	clusters := clusterPastBroadcasts([]PastBroadcast{
		{Platform: "youtube", URL: "", StartedAt: "2026-07-01T19:00:00Z"},
	}, 5*time.Minute)
	if plan := resolveStreamDownload(clusters, "auto"); plan != nil {
		t.Fatalf("want nil plan for URL-less broadcasts, got %+v", plan)
	}
}

func TestDownloadPastStreamRefusesDuplicateAndUnknown(t *testing.T) {
	a := newTestApp(t)
	if err := a.store.setSetting("download_dir", t.TempDir()); err != nil {
		t.Fatalf("set download dir: %v", err)
	}

	if _, err := a.downloadPastStream("2026-01-01T00:00:00Z", "", false); err == nil {
		t.Fatal("want an error for an unknown stream")
	}

	// A stream whose VOD is already downloaded is refused without force. The
	// local snapshot also makes the stream appear in GetPastStreams, so this
	// exercises the whole lookup path offline.
	const vodURL = "https://www.twitch.tv/videos/123"
	writeDownload(t, a, DownloadedVideo{
		ID: "twitch|" + vodURL, Title: "Episode 1", Platform: "twitch",
		StartedAt: "2026-06-28T03:43:45Z", DurationSecs: 6786,
		URLs: []string{vodURL}, Subfolder: "ep1", VideoFile: "ep1.mp4",
	})
	streams := a.GetPastStreams(false)
	if len(streams) == 0 {
		t.Fatal("local download should surface as a past stream")
	}
	_, err := a.downloadPastStream(streams[0].StartedAt, "", false)
	if err == nil || !strings.Contains(err.Error(), "already downloaded") {
		t.Fatalf("want an already-downloaded refusal, got %v", err)
	}
}

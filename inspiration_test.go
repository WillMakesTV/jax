package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A studied video's local copy is dropped once its notes are complete; the
// entry, its thumbnail, and its folder stay put.
func TestDropInspirationDownload(t *testing.T) {
	a := newTestApp(t)
	root, err := a.inspirationRoot()
	if err != nil {
		t.Fatalf("root: %v", err)
	}
	dir := filepath.Join(root, "Maker", "v1")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	media := filepath.Join(dir, "v1.mp4")
	if err := os.WriteFile(media, []byte("video"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	lib := a.getInspiration()
	lib.Videos = append(lib.Videos, InspirationVideo{
		ID: "v1", Title: "Studied", Status: inspirationReady,
		Folder: "Maker/v1", VideoFile: "v1.mp4", ThumbnailFile: "v1.jpg",
	})
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save: %v", err)
	}

	a.dropInspirationDownload("v1")
	if _, err := os.Stat(media); !os.IsNotExist(err) {
		t.Fatalf("the media file should be gone, stat = %v", err)
	}
	got, err := a.GetInspirationVideo("v1")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got.VideoFile != "" || got.MediaURL != "" {
		t.Fatalf("the local copy should be forgotten: %+v", got)
	}
	if got.Folder == "" || got.ThumbnailFile == "" || got.Status != inspirationReady {
		t.Fatalf("the rest of the entry should survive: %+v", got)
	}

	// Running it again on a video with nothing to drop is harmless.
	a.dropInspirationDownload("v1")
	a.dropInspirationDownload("missing")
}

func TestFormatClock(t *testing.T) {
	cases := map[int]string{
		0: "0:00", 9: "0:09", 75: "1:15", 3599: "59:59",
		3600: "1:00:00", 7325: "2:02:05", -5: "0:00",
	}
	for secs, want := range cases {
		if got := formatClock(secs); got != want {
			t.Fatalf("formatClock(%d) = %q, want %q", secs, got, want)
		}
	}
}

// A model may wrap its JSON in prose or a code fence; the manifest parser
// takes the outermost object either way.
func TestExtractJSONObject(t *testing.T) {
	body := `{"summary": "x", "beats": [{"atSecs": 1}]}`
	for _, wrapped := range []string{
		body,
		"Here you go:\n```json\n" + body + "\n```",
		"prose before " + body + " and after",
	} {
		if got := extractJSONObject(wrapped); got != body {
			t.Fatalf("extractJSONObject(%q) = %q", wrapped, got)
		}
	}
	if got := extractJSONObject("no json here"); got != "no json here" {
		t.Fatalf("plain text should pass through, got %q", got)
	}
}

func TestInspirationLibrary(t *testing.T) {
	a := newTestApp(t)
	a.mediaBaseURL = "http://127.0.0.1:9999"

	if got := a.GetInspirationChannels(); len(got) != 0 {
		t.Fatalf("empty library should have no channels, got %+v", got)
	}
	if got := a.GetInspirationVideos(""); len(got) != 0 {
		t.Fatalf("empty library should have no videos, got %+v", got)
	}

	// Indexing a channel twice keeps one entry, and its AddedAt.
	lib := a.getInspiration()
	id := a.upsertInspirationChannel(&lib, InspirationChannel{ID: "UC1", Name: "Maker"})
	added := lib.Channels[0].AddedAt
	if id != "UC1" || added == "" {
		t.Fatalf("channel not stored: %+v", lib.Channels)
	}
	a.upsertInspirationChannel(&lib, InspirationChannel{ID: "UC1", Name: "Maker Renamed"})
	if len(lib.Channels) != 1 || lib.Channels[0].Name != "Maker Renamed" ||
		lib.Channels[0].AddedAt != added {
		t.Fatalf("re-index should update in place: %+v", lib.Channels)
	}

	// A full index brings in the branding; the thinner report that rides
	// along with a video must not blank it again.
	a.upsertInspirationChannel(&lib, InspirationChannel{
		ID: "UC1", Name: "Maker", Description: "Builds things",
		AvatarURL: "https://img/avatar.jpg", BannerURL: "https://img/banner.jpg",
		Subscribers: 4200, VideoCount: 91,
		Tags:  []string{"diy"},
		Links: []InspirationLink{{Label: "X", URL: "https://x.com/maker"}},
	})
	a.upsertInspirationChannel(&lib, InspirationChannel{ID: "UC1", Name: "Maker"})
	ch := lib.Channels[0]
	if ch.AvatarURL == "" || ch.BannerURL == "" || ch.Subscribers != 4200 ||
		ch.VideoCount != 91 || len(ch.Tags) != 1 || len(ch.Links) != 1 ||
		ch.Description != "Builds things" {
		t.Fatalf("a partial re-index should keep the branding: %+v", ch)
	}

	lib.Videos = append(lib.Videos,
		InspirationVideo{ID: "v1", ChannelID: "UC1", Title: "Older",
			PublishedAt: "2026-01-01T00:00:00Z", Status: inspirationTracked},
		InspirationVideo{ID: "v2", ChannelID: "UC1", Title: "Newer",
			PublishedAt: "2026-06-01T00:00:00Z", Status: inspirationReady,
			Folder: "Maker/v2", VideoFile: "v2.mp4", ThumbnailFile: "v2.jpg"},
		InspirationVideo{ID: "v3", ChannelID: "UC2", Title: "Elsewhere"},
	)
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save: %v", err)
	}

	// Newest published first, scoped to the channel when one is named.
	got := a.GetInspirationVideos("UC1")
	if len(got) != 2 || got[0].ID != "v2" || got[1].ID != "v1" {
		t.Fatalf("channel videos out of order: %+v", got)
	}
	if len(a.GetInspirationVideos("")) != 3 {
		t.Fatal("an empty channel id should return every video")
	}

	// A downloaded video is addressable through the workspace media route.
	wantMedia := "http://127.0.0.1:9999" + editsPrefix + "inspiration/Maker/v2/v2.mp4"
	if got[0].MediaURL != wantMedia {
		t.Fatalf("media url = %q, want %q", got[0].MediaURL, wantMedia)
	}
	if !strings.HasSuffix(got[0].ThumbURL, "/v2.jpg") {
		t.Fatalf("thumb url = %q", got[0].ThumbURL)
	}
	// A tracked (not yet downloaded) video has no local address, and its
	// slices are never nil for the frontend.
	if got[1].MediaURL != "" || got[1].Tags == nil || got[1].Beats == nil ||
		got[1].Takeaways == nil {
		t.Fatalf("tracked video: %+v", got[1])
	}

	if _, err := a.GetInspirationVideo("v2"); err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if _, err := a.GetInspirationVideo("nope"); err == nil {
		t.Fatal("want an error for an unknown video")
	}

	// Deleting a channel takes its videos with it, and leaves the rest.
	if err := a.DeleteInspirationChannel("UC1"); err != nil {
		t.Fatalf("delete channel: %v", err)
	}
	if len(a.GetInspirationChannels()) != 0 {
		t.Fatal("channel not deleted")
	}
	rest := a.GetInspirationVideos("")
	if len(rest) != 1 || rest[0].ID != "v3" {
		t.Fatalf("channel delete should drop only its videos: %+v", rest)
	}
	if err := a.DeleteInspirationVideo("v3"); err != nil {
		t.Fatalf("delete video: %v", err)
	}
	if len(a.GetInspirationVideos("")) != 0 {
		t.Fatal("video not deleted")
	}
}

func TestInspirationInFlight(t *testing.T) {
	a := newTestApp(t)

	lib := a.getInspiration()
	lib.Videos = append(lib.Videos,
		InspirationVideo{ID: "v1", Title: "Tracked", Status: inspirationTracked},
		InspirationVideo{ID: "v2", Title: "Waiting", Status: inspirationQueued},
		InspirationVideo{ID: "v3", Title: "Mid-run", Status: inspirationTranscribing,
			StatusDetail: "00:04:10", Progress: 250},
		InspirationVideo{ID: "v4", Title: "Studied", Status: inspirationReady},
		InspirationVideo{ID: "v5", Title: "Failed", Status: inspirationError},
	)
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save: %v", err)
	}

	// Only the videos the pipeline still owes work, carrying the detail the
	// status bar draws.
	got := a.InspirationInFlight()
	if len(got) != 2 || got[0].ID != "v2" || got[1].ID != "v3" {
		t.Fatalf("in-flight videos: %+v", got)
	}
	if got[1].StatusDetail != "00:04:10" || got[1].Progress != 250 {
		t.Fatalf("in-flight video should carry its progress: %+v", got[1])
	}
}

func TestCancelInspirationVideo(t *testing.T) {
	a := newTestApp(t)

	lib := a.getInspiration()
	lib.Videos = append(lib.Videos,
		InspirationVideo{ID: "q1", Title: "Queued", Status: inspirationQueued},
		InspirationVideo{ID: "done", Title: "Studied", Status: inspirationReady},
	)
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save: %v", err)
	}

	// Simulate a populated queue with q1 waiting.
	inspirationQueue.Lock()
	inspirationQueue.ids = []string{"q1"}
	inspirationQueue.canceled = nil
	inspirationQueue.Unlock()
	t.Cleanup(func() {
		inspirationQueue.Lock()
		inspirationQueue.ids = nil
		inspirationQueue.canceled = nil
		inspirationQueue.current = ""
		inspirationQueue.cancel = nil
		inspirationQueue.Unlock()
	})

	// Cancelling a queued video pulls it from the line, flags it, and drops it
	// back to tracked so it leaves the in-flight list.
	if err := a.CancelInspirationVideo("q1"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	inspirationQueue.Lock()
	inLine := len(inspirationQueue.ids)
	flagged := inspirationQueue.canceled["q1"]
	inspirationQueue.Unlock()
	if inLine != 0 {
		t.Fatalf("q1 should be pulled from the queue, %d left", inLine)
	}
	if !flagged {
		t.Fatal("q1 should be flagged cancelled")
	}
	if v, _ := a.GetInspirationVideo("q1"); v.Status != inspirationTracked {
		t.Fatalf("q1 should revert to tracked, got %q", v.Status)
	}

	// A finished video keeps its result — cancel leaves it alone.
	if err := a.CancelInspirationVideo("done"); err != nil {
		t.Fatalf("cancel done: %v", err)
	}
	if v, _ := a.GetInspirationVideo("done"); v.Status != inspirationReady {
		t.Fatalf("a studied video must keep its result, got %q", v.Status)
	}
}

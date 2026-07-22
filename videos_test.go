package main

import (
	"testing"
	"time"
)

func TestGetVideosServesStaleCache(t *testing.T) {
	a := newTestApp(t)
	seedVideoCache(t, a, []Video{
		{Platform: "youtube", ID: "v1", Title: "Cached", URL: "https://youtu.be/v1"},
	})

	// A fresh copy is served as-is, with nothing running behind it.
	list := a.GetVideos(false)
	if len(list.Videos) != 1 || list.Videos[0].ID != "v1" {
		t.Fatalf("cached videos not served: %+v", list)
	}
	if !list.FromCache || list.Refreshing {
		t.Fatalf("a fresh cache should not report a refresh: %+v", list)
	}

	// Age it past the TTL: the stale copy still comes back — the page draws
	// what it knows — and the read says a refresh is running behind it.
	key := a.connsCacheKey("videos_v7")
	if _, err := a.store.db.Exec(
		`UPDATE api_cache SET fetched_at = ? WHERE key = ?`,
		time.Now().Add(-2*apiCacheTTL).Unix(), key,
	); err != nil {
		t.Fatalf("age the cache: %v", err)
	}
	list = a.GetVideos(false)
	if len(list.Videos) != 1 || list.Videos[0].ID != "v1" {
		t.Fatalf("stale cache should still be served: %+v", list)
	}
	if !list.Refreshing {
		t.Fatalf("a stale read should report the refresh: %+v", list)
	}

	// The refresh runs once: with no platforms connected it fails and clears
	// its flag, leaving the cached copy in place rather than an empty page.
	deadline := time.Now().Add(5 * time.Second)
	for {
		a.mu.Lock()
		running := a.videosRefreshing
		a.mu.Unlock()
		if !running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the background refresh never finished")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := a.GetVideos(false); len(got.Videos) != 1 {
		t.Fatalf("a failed refresh should leave the cache alone: %+v", got)
	}
}

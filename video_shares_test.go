package main

import (
	"encoding/json"
	"testing"
)

func TestParseVideoURL(t *testing.T) {
	cases := []struct {
		url, platform, id string
	}{
		{"https://www.youtube.com/watch?v=abc123", "youtube", "abc123"},
		{"https://youtube.com/watch?v=abc123&si=tracker", "youtube", "abc123"},
		{"https://youtu.be/abc123?si=tracker", "youtube", "abc123"},
		{"https://www.youtube.com/shorts/xyz789", "youtube", "xyz789"},
		{"https://m.youtube.com/watch?v=abc123", "youtube", "abc123"},
		{"https://www.youtube.com/live/lv1", "youtube", "lv1"},
		{"https://www.youtube.com/@somechannel", "youtube", ""},
		{"https://www.tiktok.com/@creator/video/7300000001", "tiktok", "7300000001"},
		{"https://vm.tiktok.com/ZM8abc/", "tiktok", ""},
		{"https://www.instagram.com/reel/Cxyz123/", "instagram", ""},
		{"https://www.instagram.com/p/Cxyz123/", "instagram", ""},
		{"https://www.facebook.com/reel/1234567890", "facebook", "1234567890"},
		{"https://www.facebook.com/somepage/videos/1234567890/", "facebook", "1234567890"},
		{"https://www.facebook.com/watch/?v=1234567890", "facebook", "1234567890"},
		{"https://fb.watch/abc123/", "facebook", ""},
		{"https://kick.com/somelogin/videos/0198c9c8-aaaa-bbbb-cccc-121314151617", "kick", "0198c9c8-aaaa-bbbb-cccc-121314151617"},
		{"https://www.twitch.tv/videos/2200000000", "twitch", "2200000000"},
		{"https://www.twitch.tv/somelogin/clip/FunnyClipSlug", "twitch", "FunnyClipSlug"},
		{"https://clips.twitch.tv/FunnyClipSlug", "twitch", "FunnyClipSlug"},
		{"https://example.com/watch?v=abc", "", ""},
		{"not a url at all", "", ""},
		{"", "", ""},
	}
	for _, c := range cases {
		platform, id := parseVideoURL(c.url)
		if platform != c.platform || id != c.id {
			t.Errorf("parseVideoURL(%q) = (%q, %q), want (%q, %q)",
				c.url, platform, id, c.platform, c.id)
		}
	}
}

func TestNormalizeVideoURL(t *testing.T) {
	// The same posting under different dressings must normalize identically.
	// Instagram in particular serves one posting under several paths.
	same := []string{
		"https://www.instagram.com/reel/Cxyz123/",
		"http://instagram.com/reel/Cxyz123",
		"https://m.instagram.com/reel/Cxyz123/?utm_source=share#comments",
		"https://www.instagram.com/p/Cxyz123/",
		"https://www.instagram.com/reels/Cxyz123/",
		"https://www.instagram.com/tv/Cxyz123/",
		"https://www.instagram.com/someuser/reel/Cxyz123/?igsh=token",
	}
	want := normalizeVideoURL(same[0])
	if want == "" {
		t.Fatal("normalized to empty")
	}
	for _, u := range same[1:] {
		if got := normalizeVideoURL(u); got != want {
			t.Errorf("normalizeVideoURL(%q) = %q, want %q", u, got, want)
		}
	}
	// The v param is the video's identity on watch URLs and must survive.
	if got := normalizeVideoURL("https://www.youtube.com/watch?v=abc&si=x"); got != "youtube.com/watch?v=abc" {
		t.Errorf("watch URL normalized to %q", got)
	}
	// An Instagram share-redirect link carries an opaque token, not the
	// shortcode; it must not impersonate a /reel/ permalink.
	if got := normalizeVideoURL("https://www.instagram.com/share/reel/Cxyz123/"); got == want {
		t.Errorf("share-redirect link normalized to the permalink form %q", got)
	}
	if got := normalizeVideoURL("nonsense"); got != "" {
		t.Errorf("junk normalized to %q, want empty", got)
	}
}

// seedVideoCache pre-fills the videos cache so allVideos(false) serves the
// given list without any platform connections.
func seedVideoCache(t *testing.T, a *App, videos []Video) {
	t.Helper()
	raw, err := json.Marshal(videos)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.store.setCacheEntry(a.connsCacheKey("videos_v7"), string(raw)); err != nil {
		t.Fatal(err)
	}
}

func completedPlan(t *testing.T, a *App, title string) VideoPlan {
	t.Helper()
	plan, err := a.SaveVideoPlan(VideoPlan{Title: title, Format: "short"})
	if err != nil {
		t.Fatal(err)
	}
	if plan, err = a.CompleteVideoPlan(plan.ID); err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestSetVideoPlanShares(t *testing.T) {
	a := newTestApp(t)
	plan := completedPlan(t, a, "My short")

	if _, err := a.SetVideoPlanShares(plan.ID, []string{"not a url"}); err == nil {
		t.Fatal("want error for a junk share URL")
	}
	if _, err := a.SetVideoPlanShares("vplan_missing", nil); err == nil {
		t.Fatal("want error for an unknown plan")
	}

	// Aliases of one posting collapse to the first spelling.
	tracked, err := a.SetVideoPlanShares(plan.ID, []string{
		"https://www.instagram.com/reel/Cxyz123/",
		"http://instagram.com/reel/Cxyz123",
		"https://www.tiktok.com/@creator/video/7300000001",
	})
	if err != nil {
		t.Fatalf("set shares: %v", err)
	}
	if got := tracked.Plan.ShareURLs; len(got) != 2 {
		t.Fatalf("stored share urls = %v, want the IG alias deduped", got)
	}
	if len(tracked.Shares) != 2 {
		t.Fatalf("shares = %+v, want 2", tracked.Shares)
	}

	// A plan edit from the form (which never carries shares) must not wipe them.
	edited := tracked.Plan
	edited.ShareURLs = nil
	edited.Tags = []string{"gaming"}
	if _, err := a.SaveVideoPlan(edited); err != nil {
		t.Fatalf("edit: %v", err)
	}
	for _, p := range a.GetVideoPlans() {
		if p.ID == plan.ID && len(p.ShareURLs) != 2 {
			t.Fatalf("plan edit wiped shares: %v", p.ShareURLs)
		}
	}
}

func TestTrackedVideoAggregatesShares(t *testing.T) {
	a := newTestApp(t)
	plan := completedPlan(t, a, "Boss fight")

	seedVideoCache(t, a, []Video{
		{Platform: "youtube", ID: "ytid1", URL: "https://youtube.com/watch?v=ytid1", ViewCount: 1000, IsShort: true},
		{Platform: "tiktok", ID: "7300000001", URL: "https://www.tiktok.com/@creator/video/7300000001", ViewCount: 5000, IsShort: true},
		{Platform: "instagram", ID: "1789", URL: "https://www.instagram.com/reel/Cxyz123/", ViewCount: 250, IsShort: true},
	})
	// The plan's YouTube publish record.
	if err := a.store.setJSON(keyVideoPublish, map[string]VideoPublishRecord{
		plan.ID: {VideoID: "ytid1", URL: "https://www.youtube.com/watch?v=ytid1"},
	}); err != nil {
		t.Fatal(err)
	}

	tracked, err := a.SetVideoPlanShares(plan.ID, []string{
		"https://youtu.be/ytid1",                           // alias of the publish record — must not double count
		"https://www.tiktok.com/@creator/video/7300000001", // matched by parsed id
		"https://www.instagram.com/p/Cxyz123/",             // matched by shortcode (IG ids aren't in permalinks)
		"https://someother.site/video/42",                  // unmatched — listed, contributes 0
	})
	if err != nil {
		t.Fatalf("set shares: %v", err)
	}

	if tracked.TotalViews != 6250 {
		t.Errorf("totalViews = %d, want 6250 (1000+5000+250, record alias counted once)", tracked.TotalViews)
	}
	if tracked.Live == nil || tracked.Live.ID != "ytid1" {
		t.Errorf("live = %+v, want the youtube record's video", tracked.Live)
	}
	// Publish share first, then the manual ones; the youtu.be alias vanished.
	if len(tracked.Shares) != 4 {
		t.Fatalf("shares = %d entries, want 4 (record + tiktok + ig + unmatched): %+v",
			len(tracked.Shares), tracked.Shares)
	}
	if tracked.Shares[0].Source != shareSourcePublish || tracked.Shares[0].Platform != "youtube" {
		t.Errorf("first share should be the publish record, got %+v", tracked.Shares[0])
	}
	for i, wantPlatform := range []string{"youtube", "tiktok", "instagram", ""} {
		if tracked.Shares[i].Platform != wantPlatform {
			t.Errorf("share[%d].platform = %q, want %q", i, tracked.Shares[i].Platform, wantPlatform)
		}
	}
	if tracked.Shares[3].Video != nil {
		t.Errorf("unmatched share resolved unexpectedly: %+v", tracked.Shares[3].Video)
	}

	// GetTrackedVideos reports the same aggregation.
	list := a.GetTrackedVideos()
	if len(list) != 1 || list[0].TotalViews != 6250 || len(list[0].Shares) != 4 {
		t.Fatalf("GetTrackedVideos = %+v", list)
	}
}

func TestTrackedVideoTikTokOnlyPublish(t *testing.T) {
	a := newTestApp(t)
	plan := completedPlan(t, a, "TikTok only")

	seedVideoCache(t, a, []Video{
		{Platform: "tiktok", ID: "7300000002", URL: "https://www.tiktok.com/@creator/video/7300000002", ViewCount: 900},
	})
	if err := a.store.setJSON(keyTikTokPublish, map[string]TikTokPublishRecord{
		plan.ID: {PublishID: "pub1", URL: "https://www.tiktok.com/@creator/video/7300000002"},
	}); err != nil {
		t.Fatal(err)
	}

	list := a.GetTrackedVideos()
	if len(list) != 1 {
		t.Fatalf("tracked = %+v", list)
	}
	tv := list[0]
	if tv.Record != nil {
		t.Errorf("record should be nil for a TikTok-only publish, got %+v", tv.Record)
	}
	if len(tv.Shares) != 1 || tv.Shares[0].Source != shareSourcePublish ||
		tv.Shares[0].Platform != "tiktok" || tv.Shares[0].Video == nil {
		t.Fatalf("shares = %+v, want one resolved implicit tiktok share", tv.Shares)
	}
	if tv.TotalViews != 900 {
		t.Errorf("totalViews = %d, want 900", tv.TotalViews)
	}

	// An audit-pending publish has no share link and must simply not appear.
	if err := a.store.setJSON(keyTikTokPublish, map[string]TikTokPublishRecord{
		plan.ID: {PublishID: "pub1", URL: ""},
	}); err != nil {
		t.Fatal(err)
	}
	tv = a.GetTrackedVideos()[0]
	if len(tv.Shares) != 0 || tv.TotalViews != 0 {
		t.Fatalf("URL-less tiktok record leaked into shares: %+v", tv.Shares)
	}
}

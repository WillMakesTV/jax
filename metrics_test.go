package main

import (
	"testing"
	"time"
)

func TestSumMetricsMergesAcrossPlatforms(t *testing.T) {
	// The whole point of the hero: one number for the brand, not seven.
	got := sumMetrics([]ChannelMetrics{
		{Platform: "twitch", Audience: 1200, Supporters: 35},
		{Platform: "youtube", Audience: 8400, Content: 92, Views: 1_250_000},
		{Platform: "tiktok", Audience: 15_000, Likes: 240_000, Content: 60},
		{Platform: "facebook", Audience: 300, Likes: 450},
	})

	if got.Audience != 24_900 {
		t.Errorf("audience = %d, want 24900 (1200+8400+15000+300)", got.Audience)
	}
	if got.Supporters != 35 {
		t.Errorf("supporters = %d, want 35 — only Twitch has paid subs", got.Supporters)
	}
	if got.Likes != 240_450 {
		t.Errorf("likes = %d, want 240450", got.Likes)
	}
	if got.Content != 152 {
		t.Errorf("content = %d, want 152", got.Content)
	}
	if got.Views != 1_250_000 {
		t.Errorf("views = %d, want 1250000", got.Views)
	}
}

// A day is recorded once, however many times it is read. Otherwise opening the
// Dashboard ten times would put ten points on the chart for one day.
func TestRecordingADayTwiceOverwritesRatherThanDuplicates(t *testing.T) {
	a := newTestApp(t)
	day := today()

	first := ChannelMetrics{Platform: "youtube", Audience: 100, Content: 5}
	if err := a.store.recordChannelMetrics(day, first); err != nil {
		t.Fatal(err)
	}
	// The same day, read again later — a few more subscribers.
	second := ChannelMetrics{Platform: "youtube", Audience: 137, Content: 5}
	if err := a.store.recordChannelMetrics(day, second); err != nil {
		t.Fatal(err)
	}

	byDay, err := a.store.channelMetricsSince(day)
	if err != nil {
		t.Fatal(err)
	}
	rows := byDay[day]
	if len(rows) != 1 {
		t.Fatalf("the day was recorded %d times, want once", len(rows))
	}
	if rows[0].Audience != 137 {
		t.Errorf("audience = %d, want the day's latest reading (137)", rows[0].Audience)
	}
}

func TestMetricsHistorySumsEachDayAcrossPlatforms(t *testing.T) {
	a := newTestApp(t)

	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	day := today()

	for _, r := range []struct {
		day string
		m   ChannelMetrics
	}{
		{yesterday, ChannelMetrics{Platform: "youtube", Audience: 100}},
		{yesterday, ChannelMetrics{Platform: "twitch", Audience: 50}},
		{day, ChannelMetrics{Platform: "youtube", Audience: 120}},
		{day, ChannelMetrics{Platform: "twitch", Audience: 55}},
	} {
		if err := a.store.recordChannelMetrics(r.day, r.m); err != nil {
			t.Fatal(err)
		}
	}

	history, err := a.GetMetricsHistory(7)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 {
		t.Fatalf("want two days of history, got %d: %+v", len(history), history)
	}
	// Oldest first — a chart drawn backwards is worse than no chart.
	if history[0].Day != yesterday || history[1].Day != day {
		t.Fatalf("history is not oldest-first: %+v", history)
	}
	if history[0].Audience != 150 {
		t.Errorf("yesterday's audience = %d, want 150 (100+50)", history[0].Audience)
	}
	if history[1].Audience != 175 {
		t.Errorf("today's audience = %d, want 175 (120+55)", history[1].Audience)
	}
}

func TestPlatformHistoryFollowsOneChannel(t *testing.T) {
	a := newTestApp(t)
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	day := today()

	for _, r := range []struct {
		day string
		m   ChannelMetrics
	}{
		{yesterday, ChannelMetrics{Platform: "youtube", Audience: 100}},
		{yesterday, ChannelMetrics{Platform: "twitch", Audience: 50}},
		{day, ChannelMetrics{Platform: "youtube", Audience: 120}},
	} {
		if err := a.store.recordChannelMetrics(r.day, r.m); err != nil {
			t.Fatal(err)
		}
	}

	got, err := a.GetPlatformHistory("youtube", 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want two YouTube points, got %d: %+v", len(got), got)
	}
	if got[0].Audience != 100 || got[1].Audience != 120 {
		t.Errorf("YouTube's line is %d → %d, want 100 → 120", got[0].Audience, got[1].Audience)
	}
	// Twitch's numbers must not have leaked into YouTube's line.
	if got[0].Audience+got[1].Audience != 220 {
		t.Errorf("another platform's numbers leaked in: %+v", got)
	}
}

// Growth is only claimable for days that were actually recorded. With a single
// day on file, comparing today against itself would show a confident "0" — and
// "no growth" is a very different claim from "no data yet".
func TestGrowthIsNotClaimedWithoutHistory(t *testing.T) {
	a := newTestApp(t)
	if err := a.store.recordChannelMetrics(today(),
		ChannelMetrics{Platform: "youtube", Audience: 100}); err != nil {
		t.Fatal(err)
	}

	snap := a.GetMetricsSnapshot(30)
	if snap.HasHistory {
		t.Error("growth was claimed from a single day of history")
	}
	if snap.Growth != (MetricTotals{}) {
		t.Errorf("a growth figure was invented: %+v", snap.Growth)
	}
}

func TestGrowthIsMeasuredFromTheOldestDayInTheWindow(t *testing.T) {
	a := newTestApp(t)
	a.setService("youtube", serviceConn{token: "t", account: "chan"})

	// A week ago the channel had 1,000 subscribers; today it has 1,250.
	weekAgo := time.Now().AddDate(0, 0, -6).Format("2006-01-02")
	if err := a.store.recordChannelMetrics(weekAgo,
		ChannelMetrics{Platform: "youtube", Audience: 1000}); err != nil {
		t.Fatal(err)
	}
	// Today's reading comes from the channel cache the Dashboard fills.
	if err := a.store.setCacheEntry(keyYTChannelInfo,
		`{"subscribersN":1250,"videosN":40,"viewsN":90000}`); err != nil {
		t.Fatal(err)
	}

	snap := a.GetMetricsSnapshot(7)
	if !snap.HasHistory {
		t.Fatal("history exists but was not used")
	}
	if snap.Totals.Audience != 1250 {
		t.Errorf("today's audience = %d, want 1250", snap.Totals.Audience)
	}
	if snap.Previous.Audience != 1000 {
		t.Errorf("the comparison point = %d, want the oldest day in the window (1000)",
			snap.Previous.Audience)
	}
	if snap.Growth.Audience != 250 {
		t.Errorf("growth = %d, want +250", snap.Growth.Audience)
	}
	// Reading the snapshot files today's numbers, so the series keeps itself
	// alive just by the Dashboard being opened.
	history, err := a.GetMetricsHistory(7)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 {
		t.Errorf("opening the Dashboard did not record today: %+v", history)
	}
}

// A connected platform whose card hasn't loaded yet has no numbers — and must
// not be recorded as a channel with an audience of zero, which would put a
// cliff in the growth chart.
func TestAnUnreadPlatformIsNotRecordedAsZero(t *testing.T) {
	a := newTestApp(t)
	a.setService("twitch", serviceConn{token: "t", account: "chan"})
	// No cache entry for Twitch: its card has never loaded.

	for _, m := range a.GetChannelMetrics() {
		if m.Platform == "twitch" {
			t.Fatalf("an unread platform was reported as real data: %+v", m)
		}
	}
}

func TestTikTokHandleFromProfileLink(t *testing.T) {
	cases := map[string]string{
		"https://www.tiktok.com/@willmakestv":         "willmakestv",
		"https://www.tiktok.com/@willmakestv?lang=en": "willmakestv",
		"https://www.tiktok.com/@willmakestv/":        "willmakestv",
		"":                                            "",
		"https://www.tiktok.com/":                     "",
	}
	for link, want := range cases {
		if got := tiktokHandleFrom(link); got != want {
			t.Errorf("tiktokHandleFrom(%q) = %q, want %q", link, got, want)
		}
	}
}

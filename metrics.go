package main

import (
	"encoding/json"
	"log"
	"sort"
	"time"
)

// ---------------------------------------------------------------------------
// Channel metrics
//
// Every platform reports its audience differently — Twitch counts followers and
// paid subs, YouTube counts subscribers and lifetime views, Instagram counts
// posts, TikTok counts likes across every video. Each one is stored formatted
// for display ("12.3K"), which is fine for a card and useless for a total:
// "12.3K" + "1.2M" is not arithmetic. So the raw numbers are carried alongside
// (the *N fields on each platform's cached channel info), and this file is
// where they are read back, added up, and remembered.
//
// The vocabulary the Dashboard aggregates on, chosen so the same tile means the
// same thing everywhere:
//
//   - Audience: the people who chose to follow. Followers on Twitch, Kick,
//     Facebook, Instagram, TikTok and X; subscribers on YouTube (the same act,
//     under YouTube's name for it).
//   - Supporters: paid/committed subscribers. Twitch subs today; nowhere else
//     exposes an equivalent, so this stays small and honest rather than being
//     padded with followers.
//   - Likes: Facebook page likes and TikTok's lifetime like count.
//   - Content: things published. YouTube videos, Instagram posts, TikTok
//     videos, X posts.
//   - Views: lifetime views where a platform gives them (YouTube).
//
// A platform that doesn't report a metric contributes zero to it rather than
// guessing, and the UI says which platforms actually fed a tile — a total is
// only honest if you can see what went into it.
//
// Every day's numbers are snapshotted into the channel_metrics table, so growth
// can be shown over time. The snapshot is taken from the same 1-hour cache the
// Dashboard reads: recording is free, and never costs an extra API call.
// ---------------------------------------------------------------------------

// ChannelMetrics is one platform's audience numbers, as numbers.
type ChannelMetrics struct {
	Platform string `json:"platform"`
	// Audience is followers (or, on YouTube, subscribers — the same act).
	Audience int64 `json:"audience"`
	// Supporters are paid subscribers (Twitch); 0 where the platform has no
	// equivalent.
	Supporters int64 `json:"supporters"`
	Likes      int64 `json:"likes"`
	Content    int64 `json:"content"`
	Views      int64 `json:"views"`
}

// total sums the metrics that make up a channel's reach.
func (m ChannelMetrics) empty() bool {
	return m.Audience == 0 && m.Supporters == 0 && m.Likes == 0 &&
		m.Content == 0 && m.Views == 0
}

// MetricTotals is the aggregate across every connected platform, plus which
// platforms actually contributed to each figure — a total nobody can trace is
// a number to be distrusted.
type MetricTotals struct {
	Audience   int64 `json:"audience"`
	Supporters int64 `json:"supporters"`
	Likes      int64 `json:"likes"`
	Content    int64 `json:"content"`
	Views      int64 `json:"views"`
}

// MetricsSnapshot is the Dashboard hero's data: the totals now, the same totals
// as of the comparison day, and the per-platform breakdown behind them.
type MetricsSnapshot struct {
	Day        string           `json:"day"` // YYYY-MM-DD
	Totals     MetricTotals     `json:"totals"`
	Platforms  []ChannelMetrics `json:"platforms"`
	// Previous is the earliest snapshot inside the requested window, and
	// Growth the change from it. Both are zero until there is history to
	// compare against — the app cannot invent a past it never recorded.
	Previous MetricTotals `json:"previous"`
	Growth   MetricTotals `json:"growth"`
	// HasHistory reports whether Previous/Growth mean anything yet.
	HasHistory bool `json:"hasHistory"`
	// PlatformGrowth is each platform's own movement over the window,
	// measured from the earliest day that recorded that platform. Platforms
	// first seen today are absent — they have no past to grow from.
	PlatformGrowth []ChannelMetrics `json:"platformGrowth"`
}

// MetricsDay is one recorded day, for the growth chart.
type MetricsDay struct {
	Day string `json:"day"` // YYYY-MM-DD
	MetricTotals
}

// today is the day a snapshot is filed under, in the user's own timezone —
// "today" is a local idea, and a UTC day boundary would file an evening's
// numbers under tomorrow for anyone west of Greenwich.
func today() string {
	return time.Now().Format("2006-01-02")
}

// GetChannelMetrics reads each connected platform's numbers out of the channel
// caches the Dashboard already fills. It never fetches: a platform that has not
// been read yet simply reports nothing, and appears once its card loads.
func (a *App) GetChannelMetrics() []ChannelMetrics {
	out := []ChannelMetrics{}

	if _, ok := a.getConn("twitch"); ok {
		var info twitchChannelInfo
		if a.readCache(keyTwitchChannelInfo, &info) {
			out = append(out, ChannelMetrics{
				Platform:   "twitch",
				Audience:   info.FollowersN,
				Supporters: info.SubscribersN,
			})
		}
	}
	if _, ok := a.getConn("youtube"); ok {
		var info ytChannelInfo
		if a.readCache(keyYTChannelInfo, &info) {
			out = append(out, ChannelMetrics{
				Platform: "youtube",
				// YouTube calls following "subscribing"; it is the same act,
				// and folding it into Audience is what makes the total mean
				// anything.
				Audience: info.SubscribersN,
				Content:  info.VideosN,
				Views:    info.ViewsN,
			})
		}
	}
	if _, ok := a.getConn("kick"); ok {
		var info kickChannelBranding
		if a.readCache(keyKickChannelInfo, &info) {
			out = append(out, ChannelMetrics{Platform: "kick", Audience: info.FollowersN})
		}
	}
	if _, ok := a.getConn("facebook"); ok {
		var info fbChannelInfo
		if a.readCache(keyFBChannelInfo, &info) {
			out = append(out, ChannelMetrics{
				Platform: "facebook",
				Audience: info.FollowersN,
				Likes:    info.LikesN,
			})
		}
	}
	if _, ok := a.getConn("instagram"); ok {
		var info igChannelInfo
		if a.readCache(keyIGChannelInfo, &info) {
			out = append(out, ChannelMetrics{
				Platform: "instagram",
				Audience: info.FollowersN,
				Content:  info.PostsN,
				Views:    info.ViewsN,
			})
		}
	}
	if _, ok := a.getConn("tiktok"); ok {
		var info tiktokChannelInfo
		if a.readCache(keyTikTokChannelInfo, &info) {
			out = append(out, ChannelMetrics{
				Platform: "tiktok",
				Audience: info.FollowersN,
				Likes:    info.LikesN,
				Content:  info.VideosN,
				// TikTok publishes no lifetime view count; this is summed from
				// the video list (see fetchTikTokViews).
				Views: info.ViewsN,
			})
		}
	}
	if _, ok := a.getConn("x"); ok {
		var info xChannelInfo
		if a.readCache(keyXChannelInfo, &info) {
			out = append(out, ChannelMetrics{
				Platform: "x",
				Audience: info.FollowersN,
				Content:  info.PostsN,
			})
		}
	}

	// A platform whose card hasn't loaded yet reports nothing; keeping an
	// all-zero row would make a connected-but-unread channel look like a
	// channel with no audience.
	kept := out[:0]
	for _, m := range out {
		if !m.empty() {
			kept = append(kept, m)
		}
	}
	return kept
}

// readCache decodes a cached channel-info payload without ever fetching. It
// tolerates a stale entry: an hour-old follower count is a fine input to a
// daily snapshot, and far better than an API call on every dashboard render.
func (a *App) readCache(key string, out any) bool {
	if a.store == nil {
		return false
	}
	raw, _, ok, err := a.store.getCacheEntry(key)
	if err != nil || !ok {
		return false
	}
	return json.Unmarshal([]byte(raw), out) == nil
}

// sumMetrics adds the platforms up.
func sumMetrics(platforms []ChannelMetrics) MetricTotals {
	var t MetricTotals
	for _, m := range platforms {
		t.Audience += m.Audience
		t.Supporters += m.Supporters
		t.Likes += m.Likes
		t.Content += m.Content
		t.Views += m.Views
	}
	return t
}

// GetMetricsSnapshot is the Dashboard hero: what the brand is now, and how far
// it has moved over the given window (7, 30, 90 days…). Recording today's
// numbers happens here too, so simply opening the Dashboard keeps the history
// alive.
func (a *App) GetMetricsSnapshot(days int) MetricsSnapshot {
	if days <= 0 {
		days = 30
	}
	platforms := a.GetChannelMetrics()
	snap := MetricsSnapshot{
		Day:       today(),
		Platforms: platforms,
		Totals:    sumMetrics(platforms),
	}

	// Today's numbers are worth keeping the moment they are read.
	a.recordMetrics(platforms)

	history, err := a.GetMetricsHistory(days)
	if err != nil {
		log.Printf("jax: metrics history: %v", err)
		return snap
	}
	// The oldest day in the window is what "growth" is measured from. A single
	// day of history is just today, and comparing today with itself would show
	// a confident zero — which reads as "no growth" rather than "no data yet".
	if len(history) < 2 {
		return snap
	}
	snap.Previous = history[0].MetricTotals
	snap.Growth = MetricTotals{
		Audience:   snap.Totals.Audience - snap.Previous.Audience,
		Supporters: snap.Totals.Supporters - snap.Previous.Supporters,
		Likes:      snap.Totals.Likes - snap.Previous.Likes,
		Content:    snap.Totals.Content - snap.Previous.Content,
		Views:      snap.Totals.Views - snap.Previous.Views,
	}
	snap.HasHistory = true

	// Each platform against its own recorded past, over the same window.
	if a.store != nil {
		from := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")
		if byDay, err := a.store.channelMetricsSince(from); err == nil {
			snap.PlatformGrowth = platformGrowth(platforms, byDay, snap.Day)
		}
	}
	return snap
}

// platformGrowth measures each current platform against its earliest recorded
// day in the window. Today's own reading never counts as the past — a channel
// first seen today would otherwise report a confident zero, which reads as
// "no growth" rather than "no data yet".
func platformGrowth(current []ChannelMetrics, byDay map[string][]ChannelMetrics, today string) []ChannelMetrics {
	days := make([]string, 0, len(byDay))
	for d := range byDay {
		days = append(days, d)
	}
	sort.Strings(days)
	earliest := map[string]ChannelMetrics{}
	for _, d := range days {
		if d == today {
			continue
		}
		for _, m := range byDay[d] {
			if _, ok := earliest[m.Platform]; !ok {
				earliest[m.Platform] = m
			}
		}
	}

	out := []ChannelMetrics{}
	for _, cur := range current {
		prev, ok := earliest[cur.Platform]
		if !ok {
			continue
		}
		out = append(out, ChannelMetrics{
			Platform:   cur.Platform,
			Audience:   cur.Audience - prev.Audience,
			Supporters: cur.Supporters - prev.Supporters,
			Likes:      cur.Likes - prev.Likes,
			Content:    cur.Content - prev.Content,
			Views:      cur.Views - prev.Views,
		})
	}
	return out
}

// recordMetrics files today's numbers, replacing any earlier reading from the
// same day — the last read of a day is the one that stands, so the series is
// one point per day however often the Dashboard is opened.
func (a *App) recordMetrics(platforms []ChannelMetrics) {
	if a.store == nil || len(platforms) == 0 {
		return
	}
	day := today()
	for _, m := range platforms {
		if err := a.store.recordChannelMetrics(day, m); err != nil {
			log.Printf("jax: record %s metrics: %v", m.Platform, err)
		}
	}
}

// GetMetricsHistory returns the daily totals for the last n days, oldest first
// — the growth chart's series. Days with no reading are simply absent; the
// chart joins what is there rather than inventing points that were never taken.
func (a *App) GetMetricsHistory(days int) ([]MetricsDay, error) {
	if a.store == nil {
		return []MetricsDay{}, nil
	}
	if days <= 0 {
		days = 30
	}
	from := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	byDay, err := a.store.channelMetricsSince(from)
	if err != nil {
		return nil, err
	}
	out := make([]MetricsDay, 0, len(byDay))
	for day, platforms := range byDay {
		out = append(out, MetricsDay{Day: day, MetricTotals: sumMetrics(platforms)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out, nil
}

// GetPlatformHistory returns one platform's daily audience — the per-channel
// growth line. Oldest first.
func (a *App) GetPlatformHistory(platform string, days int) ([]MetricsDay, error) {
	if a.store == nil {
		return []MetricsDay{}, nil
	}
	if days <= 0 {
		days = 30
	}
	from := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")

	byDay, err := a.store.channelMetricsSince(from)
	if err != nil {
		return nil, err
	}
	out := []MetricsDay{}
	for day, platforms := range byDay {
		for _, m := range platforms {
			if m.Platform != platform {
				continue
			}
			out = append(out, MetricsDay{Day: day, MetricTotals: MetricTotals{
				Audience:   m.Audience,
				Supporters: m.Supporters,
				Likes:      m.Likes,
				Content:    m.Content,
				Views:      m.Views,
			}})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out, nil
}

// snapshotMetricsDaily keeps the history honest for someone who leaves the app
// running for days: without it, a week-long session would record nothing after
// the first read. It ticks every six hours — the day's last reading is the one
// that stands, so ticking more often than daily costs nothing and guards
// against the app being closed before the day's first Dashboard visit.
func (a *App) snapshotMetricsDaily() {
	tick := func() {
		if metrics := a.GetChannelMetrics(); len(metrics) > 0 {
			a.recordMetrics(metrics)
		}
	}
	// The channel caches are usually cold at launch; give the Dashboard's own
	// fetches a moment to land rather than recording an empty day.
	time.Sleep(2 * time.Minute)
	tick()

	for range time.Tick(6 * time.Hour) {
		tick()
	}
}


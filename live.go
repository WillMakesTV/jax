package main

import (
	"bp-temp/internal/platforms/twitch"
	"bp-temp/internal/httpx"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Live stream metrics
//
// GetLiveStreams aggregates the state of the user's live broadcast on every
// connected OAuth platform (Twitch, YouTube). OBS encoder metrics are gathered
// in the frontend over its already-open WebSocket (see lib/obs.ts).
// ---------------------------------------------------------------------------

// DetailItem is a generic label/value pair. Platform-specific extras are
// surfaced this way so the frontend can render a "more details" view without
// knowing every platform's schema.
type DetailItem struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// LiveStream describes the current broadcast state on one platform.
type LiveStream struct {
	Platform     string       `json:"platform"` // "twitch" | "youtube"
	Live         bool         `json:"live"`
	Error        string       `json:"error"` // human-readable fetch failure, if any
	ChannelName  string       `json:"channelName"`
	ChannelLogin string       `json:"channelLogin"` // Twitch login slug (chat join); empty elsewhere
	ChannelURL   string       `json:"channelUrl"`
	StreamURL    string       `json:"streamUrl"` // direct link to the live broadcast
	Title        string       `json:"title"`
	Category     string       `json:"category"` // Twitch game / YouTube category
	ViewerCount  int          `json:"viewerCount"`
	StartedAt    string       `json:"startedAt"` // RFC3339; empty when offline
	ThumbnailURL string       `json:"thumbnailUrl"`
	AvatarURL    string       `json:"avatarUrl"` // channel profile image
	BannerURL    string       `json:"bannerUrl"` // channel banner / offline image
	Details      []DetailItem `json:"details"`
}

// GetLiveStreams returns live-broadcast info for every connected platform, in
// a stable order. Platforms that are connected but offline still appear (with
// Live=false) so the UI can show channel-level data. Never returns nil.
func (a *App) GetLiveStreams() []LiveStream {
	type job struct {
		name  string
		fetch func(serviceConn) LiveStream
	}
	jobs := []job{
		{"twitch", a.fetchTwitchLive},
		{"youtube", a.fetchYouTubeLiveThrottled},
		{"kick", a.fetchKickLive},
		{"facebook", a.fetchFacebookLive},
		{"instagram", a.fetchInstagramLive},
		{"x", a.fetchXLive},
		{"tiktok", a.fetchTikTokLive},
	}

	results := make([]*LiveStream, len(jobs))
	var wg sync.WaitGroup
	for i, j := range jobs {
		// freshConn transparently refreshes an expired access token first.
		conn, ok := a.freshConn(j.name)
		if !ok {
			continue
		}
		wg.Add(1)
		go func(i int, fetch func(serviceConn) LiveStream, conn serviceConn) {
			defer wg.Done()
			ls := fetch(conn)
			results[i] = &ls
		}(i, j.fetch, conn)
	}
	wg.Wait()

	out := []LiveStream{}
	for _, r := range results {
		if r != nil {
			out = append(out, *r)
		}
	}
	return out
}

// liveSnapshotTTL is how long a live snapshot serves the Browser Sources. A
// page polling every couple of seconds must not turn into a platform API call
// every couple of seconds; viewer counts move slowly enough that this is
// invisible on stream.
const liveSnapshotTTL = 20 * time.Second

// liveSnapshot returns GetLiveStreams' answer, memoised for liveSnapshotTTL.
// Never returns nil.
func (a *App) liveSnapshot() []LiveStream {
	a.mu.Lock()
	if a.liveSnap != nil && time.Since(a.liveSnapAt) < liveSnapshotTTL {
		snap := a.liveSnap
		a.mu.Unlock()
		return snap
	}
	a.mu.Unlock()

	fresh := a.GetLiveStreams()

	a.mu.Lock()
	a.liveSnap = fresh
	a.liveSnapAt = time.Now()
	a.mu.Unlock()
	return fresh
}

// ---------------------------------------------------------------------------
// Shared HTTP helper
// ---------------------------------------------------------------------------

// errReauth signals an expired/revoked token in a user-actionable way.
const errReauth = "Authentication expired. Reconnect in Settings → Services."

// fmtCount renders integers with thousands separators for the details list.
func fmtCount(n int64) string {
	s := strconv.FormatInt(n, 10)
	if len(s) <= 3 {
		return s
	}
	var b strings.Builder
	pre := len(s) % 3
	if pre > 0 {
		b.WriteString(s[:pre])
	}
	for i := pre; i < len(s); i += 3 {
		if b.Len() > 0 {
			b.WriteByte(',')
		}
		b.WriteString(s[i : i+3])
	}
	return b.String()
}

func atoi64(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// ---------------------------------------------------------------------------
// Twitch
// ---------------------------------------------------------------------------

const (
)

func twitchHeaders(conn serviceConn) map[string]string {
	return twitchClient(conn).Headers()
}

// twitchClient adapts a stored connection into the Helix caller (see
// internal/platforms/twitch), which owns the endpoints and request shapes.
func twitchClient(conn serviceConn) twitch.Client {
	return twitch.Client{
		Token:    conn.token,
		ClientID: conn.clientID,
		UserID:   conn.userID,
	}
}

// keyTwitchChannelInfo persistently caches slow-moving Twitch channel data
// (title/category, followers, subscribers, language, delay, labels, …) so the
// live poll only spends its per-tick calls on the actual live check. The _v2
// suffix invalidates caches written before the analytics fields were added.
const keyTwitchChannelInfo = "twitch_channel_info_v4"

// twitchChannelInfo is the cached channel-level metadata and analytics.
type twitchChannelInfo struct {
	Title       string `json:"title"`
	Category    string `json:"category"`
	Language    string `json:"language"` // broadcaster language
	Delay       int    `json:"delay"`    // stream delay, seconds
	Tags        string `json:"tags"`
	Labels      string `json:"labels"` // content classification labels
	Branded     bool   `json:"branded"`
	Followers   string `json:"followers"`   // formatted count; "" when unavailable
	Subscribers string `json:"subscribers"` // formatted; needs channel:read:subscriptions
	SubPoints   string `json:"subPoints"`
	// The same counts as numbers. The formatted strings above are for display
	// and cannot be added up ("12.3K" + "1.2M" is not arithmetic), so the raw
	// values are kept alongside them for the aggregate hero and the daily
	// history (see metrics.go).
	FollowersN   int64 `json:"followersN"`
	SubscribersN int64 `json:"subscribersN"`
	Avatar      string `json:"avatar"` // profile_image_url
	Banner      string `json:"banner"` // offline_image_url
}

// RefreshChannelInfo drops the cached channel-level analytics for both
// platforms (and the YouTube live memo) so the next poll refetches fresh
// numbers from the APIs. Wired to the Dashboard's analytics refresh CTA.
func (a *App) RefreshChannelInfo() {
	if a.store != nil {
		_ = a.store.deleteCacheEntry(keyYTChannelInfo)
		_ = a.store.deleteCacheEntry(keyTwitchChannelInfo)
		_ = a.store.deleteCacheEntry(keyKickChannelInfo)
	}
	a.mu.Lock()
	a.ytLiveResult = nil
	a.ytLiveResultAt = time.Time{}
	a.mu.Unlock()
}

// fetchTwitchLive gathers the broadcaster's current stream (if live), channel
// metadata, and follower count from the Helix API.
func (a *App) fetchTwitchLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:     "twitch",
		ChannelName:  conn.account,
		ChannelLogin: conn.login,
		ChannelURL:   "https://twitch.tv/" + conn.login,
		StreamURL:    "https://twitch.tv/" + conn.login,
	}
	if conn.userID == "" {
		ls.Error = "Twitch account details unavailable — try reconnecting."
		return ls
	}
	client := twitchClient(conn)

	// Current stream (no data = offline).
	s, live, status, err := client.CurrentStream()
	if err != nil {
		log.Printf("jax: twitch streams: %v", err)
		if status == http.StatusUnauthorized {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the Twitch API."
		}
		return ls
	}

	if live {
		ls.Live = true
		ls.Title = s.Title
		ls.Category = s.GameName
		ls.ViewerCount = s.ViewerCount
		ls.StartedAt = s.StartedAt
		// The thumbnail URL is a template; request a concrete size.
		ls.ThumbnailURL = strings.NewReplacer(
			"{width}", "640", "{height}", "360",
		).Replace(s.ThumbnailURL)

		ls.Details = append(ls.Details,
			DetailItem{"Stream ID", s.ID},
			DetailItem{"Language", s.Language},
		)
		if len(s.Tags) > 0 {
			ls.Details = append(ls.Details, DetailItem{"Tags", strings.Join(s.Tags, ", ")})
		}
		if s.IsMature {
			ls.Details = append(ls.Details, DetailItem{"Mature content", "Yes"})
		}
	}

	// Channel-level metadata (configured title/category, follower count) is
	// slow-moving, so it is served from the 1-hour cache instead of being
	// refetched on every poll tick.
	info, _, _, err := cachedJSON(a, keyTwitchChannelInfo, apiCacheTTL, false, func() (twitchChannelInfo, error) {
		out := twitchChannelInfo{}
		channel, err := client.ChannelInfo()
		if err != nil {
			return out, err
		}
		out.Title = channel.Title
		out.Category = channel.GameName
		out.Language = channel.BroadcasterLanguage
		out.Delay = channel.Delay
		out.Tags = strings.Join(channel.Tags, ", ")
		out.Labels = strings.Join(channel.ContentClassificationLabels, ", ")
		out.Branded = channel.IsBrandedContent

		// Follower count needs moderator:read:followers for full data, but
		// `total` is returned for the broadcaster's own token; tolerate failure.
		if followers, err := client.FollowerCount(); err == nil {
			out.Followers = fmtCount(followers)
			out.FollowersN = followers
		}
		// Subscriber count + points (needs channel:read:subscriptions).
		if total, points, err := client.SubscriberCount(); err == nil {
			out.Subscribers = fmtCount(total)
			out.SubPoints = fmtCount(points)
			out.SubscribersN = total
		}
		// Channel branding (profile image + offline/banner image).
		if avatar, banner, err := client.Branding(); err == nil && avatar != "" {
			out.Avatar = avatar
			out.Banner = banner
		}
		return out, nil
	})
	if err == nil {
		if !ls.Live {
			// Offline: the configured (next-stream) title and category.
			ls.Title = info.Title
			ls.Category = info.Category
		}
		ls.AvatarURL = info.Avatar
		ls.BannerURL = info.Banner
		add := func(label, value string) {
			if value != "" {
				ls.Details = append(ls.Details, DetailItem{label, value})
			}
		}
		add("Followers", info.Followers)
		add("Subscribers", info.Subscribers)
		add("Sub points", info.SubPoints)
		add("Broadcaster language", info.Language)
		if info.Delay > 0 {
			add("Stream delay", fmt.Sprintf("%ds", info.Delay))
		}
		add("Content labels", info.Labels)
		if info.Branded {
			add("Branded content", "Yes")
		}
	}

	return ls
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const (
	youtubeChannelsURL = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&mine=true"
	// liveBroadcasts.list: broadcastStatus is a filter and must NOT be combined
	// with mine= (the API rejects two filters with incompatibleParameters); it
	// already scopes to the authenticated user. broadcastType=all is required to
	// include *persistent* broadcasts — streams started with the channel's
	// default stream key (e.g. from OBS) — which the default (event) excludes.
	youtubeBroadcastsURL = "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status&broadcastStatus=active&broadcastType=all"
	youtubeVideosURL     = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,status,liveStreamingDetails&id="
)

// YouTube's default quota is only 10,000 units/day, so the live poll is
// throttled here in the backend regardless of how fast the UI polls: while
// offline the "are we live?" probe runs at most every ytOfflineProbeMin;
// while live the metrics refresh at most every ytLiveMetricsMin. Twitch, with
// its far higher rate limits, stays realtime on the UI's cadence.
const (
	ytOfflineProbeMin = 30 * time.Second
	ytLiveMetricsMin  = 15 * time.Second
	// keyYTChannelInfo persistently caches channel-level stats (subscriber /
	// view counts), which change too slowly to justify a call per poll.
	keyYTChannelInfo = "yt_channel_info_v3"
)

// ytChannelInfo is the slow-moving channel metadata cached for apiCacheTTL.
type ytChannelInfo struct {
	Name    string       `json:"name"`
	URL     string       `json:"url"`
	Avatar  string       `json:"avatar"` // channel profile image
	Banner  string       `json:"banner"` // channel banner (brandingSettings)
	Details []DetailItem `json:"details"`
	// The raw counts behind Details, for the aggregate hero and the daily
	// history (see metrics.go) — Details carries them formatted for display.
	SubscribersN int64 `json:"subscribersN"`
	ViewsN       int64 `json:"viewsN"`
	VideosN      int64 `json:"videosN"`
}

// fetchYouTubeLiveThrottled serves the memoised result between refreshes and
// delegates to fetchYouTubeLive when the memo has aged out.
func (a *App) fetchYouTubeLiveThrottled(conn serviceConn) LiveStream {
	a.mu.Lock()
	if a.ytLiveResult != nil {
		ttl := ytOfflineProbeMin
		if a.ytLiveResult.Live {
			ttl = ytLiveMetricsMin
		}
		if time.Since(a.ytLiveResultAt) < ttl {
			ls := *a.ytLiveResult
			a.mu.Unlock()
			return ls
		}
	}
	a.mu.Unlock()

	ls := a.fetchYouTubeLive(conn)

	// Memoise failures too: hammering an unreachable API helps nobody.
	a.mu.Lock()
	a.ytLiveResult = &ls
	a.ytLiveResultAt = time.Now()
	a.mu.Unlock()
	return ls
}

// cachedYTVideoID returns the memoised active broadcast's video id, or ""
// when the channel is not known to be live.
func (a *App) cachedYTVideoID() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.ytVideoID
}

func (a *App) setYTVideoID(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ytVideoID = id
}

// fetchYouTubeLive gathers channel statistics (via the persistent cache) and,
// when a broadcast is active, the live video's real-time metrics. Once live,
// the video id is memoised so each refresh costs a single videos.list call —
// which also detects the stream ending (actualEndTime) without touching the
// more expensive broadcast-list probe.
func (a *App) fetchYouTubeLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:    "youtube",
		ChannelName: conn.account,
	}
	if conn.userID != "" {
		ls.ChannelURL = "https://youtube.com/channel/" + conn.userID
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	// Channel-level statistics: slow-moving, so served from the 1-hour cache.
	// A cold fetch doubles as the reachability/auth probe.
	var channelStatus int
	info, _, _, err := cachedJSON(a, keyYTChannelInfo, apiCacheTTL, false, func() (ytChannelInfo, error) {
		var channels struct {
			Items []struct {
				ID      string `json:"id"`
				Snippet struct {
					Title      string `json:"title"`
					CustomURL  string `json:"customUrl"`
					Thumbnails struct {
						High   struct{ URL string } `json:"high"`
						Medium struct{ URL string } `json:"medium"`
						Default struct{ URL string } `json:"default"`
					} `json:"thumbnails"`
				} `json:"snippet"`
				Statistics struct {
					SubscriberCount string `json:"subscriberCount"`
					ViewCount       string `json:"viewCount"`
					VideoCount      string `json:"videoCount"`
				} `json:"statistics"`
				BrandingSettings struct {
					Image struct {
						BannerExternalURL string `json:"bannerExternalUrl"`
					} `json:"image"`
				} `json:"brandingSettings"`
			} `json:"items"`
		}
		status, err := httpx.GetJSON(youtubeChannelsURL, headers, &channels)
		channelStatus = status
		if err != nil {
			return ytChannelInfo{}, err
		}
		out := ytChannelInfo{}
		if len(channels.Items) > 0 {
			ch := channels.Items[0]
			out.Name = ch.Snippet.Title
			out.Avatar = firstNonEmpty(
				ch.Snippet.Thumbnails.High.URL,
				ch.Snippet.Thumbnails.Medium.URL,
				ch.Snippet.Thumbnails.Default.URL,
			)
			out.Banner = ch.BrandingSettings.Image.BannerExternalURL
			if ch.Snippet.CustomURL != "" {
				out.URL = "https://youtube.com/" + ch.Snippet.CustomURL
			} else if ch.ID != "" {
				out.URL = "https://youtube.com/channel/" + ch.ID
			}
			out.SubscribersN = atoi64(ch.Statistics.SubscriberCount)
			out.ViewsN = atoi64(ch.Statistics.ViewCount)
			out.VideosN = atoi64(ch.Statistics.VideoCount)
			out.Details = []DetailItem{
				{"Subscribers", fmtCount(out.SubscribersN)},
				{"Total channel views", fmtCount(out.ViewsN)},
				{"Videos", fmtCount(out.VideosN)},
			}
		}
		return out, nil
	})
	if err != nil {
		log.Printf("jax: youtube channels: %v", err)
		if channelStatus == http.StatusUnauthorized {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the YouTube API."
		}
		return ls
	}
	ls.ChannelName = firstNonEmpty(info.Name, ls.ChannelName)
	ls.ChannelURL = firstNonEmpty(info.URL, ls.ChannelURL)
	ls.AvatarURL = info.Avatar
	ls.BannerURL = info.Banner
	ls.Details = append(ls.Details, info.Details...)

	// Live status. Only probe the broadcast list while we believe we are
	// offline; once live, the videos.list refresh below detects the end.
	videoID := a.cachedYTVideoID()
	if videoID == "" {
		var broadcasts struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		}
		if _, err := httpx.GetJSON(youtubeBroadcastsURL, headers, &broadcasts); err != nil {
			log.Printf("jax: youtube liveBroadcasts: %v", err)
			ls.Error = "Could not check for an active YouTube broadcast."
			return ls
		}
		if len(broadcasts.Items) == 0 {
			return ls // connected, not live
		}
		videoID = broadcasts.Items[0].ID
		a.setYTVideoID(videoID)
	}

	// Real-time metrics for the live broadcast.
	var videos struct {
		Items []struct {
			Snippet struct {
				Title      string `json:"title"`
				Thumbnails struct {
					Medium struct {
						URL string `json:"url"`
					} `json:"medium"`
					High struct {
						URL string `json:"url"`
					} `json:"high"`
				} `json:"thumbnails"`
			} `json:"snippet"`
			Statistics struct {
				ViewCount string `json:"viewCount"`
				LikeCount string `json:"likeCount"`
			} `json:"statistics"`
			Status struct {
				PrivacyStatus string `json:"privacyStatus"`
			} `json:"status"`
			LiveStreamingDetails struct {
				ActualStartTime   string `json:"actualStartTime"`
				ActualEndTime     string `json:"actualEndTime"`
				ConcurrentViewers string `json:"concurrentViewers"`
			} `json:"liveStreamingDetails"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(youtubeVideosURL+videoID, headers, &videos); err != nil {
		log.Printf("jax: youtube live video: %v", err)
		a.setYTVideoID("") // re-probe on the next refresh
		return ls
	}
	if len(videos.Items) == 0 ||
		videos.Items[0].LiveStreamingDetails.ActualEndTime != "" {
		a.setYTVideoID("") // the broadcast ended
		return ls
	}

	v := videos.Items[0]
	ls.Live = true
	ls.StreamURL = "https://youtube.com/watch?v=" + videoID
	ls.Title = v.Snippet.Title
	ls.ViewerCount = int(atoi64(v.LiveStreamingDetails.ConcurrentViewers))
	ls.StartedAt = v.LiveStreamingDetails.ActualStartTime
	ls.ThumbnailURL = firstNonEmpty(
		v.Snippet.Thumbnails.High.URL,
		v.Snippet.Thumbnails.Medium.URL,
	)
	ls.Details = append(ls.Details,
		DetailItem{"Video ID", videoID},
		DetailItem{"Privacy", v.Status.PrivacyStatus},
		DetailItem{"Stream views so far", fmtCount(atoi64(v.Statistics.ViewCount))},
		DetailItem{"Likes", fmtCount(atoi64(v.Statistics.LikeCount))},
	)
	return ls
}

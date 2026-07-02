package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
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
	ChannelURL   string       `json:"channelUrl"`
	StreamURL    string       `json:"streamUrl"` // direct link to the live broadcast
	Title        string       `json:"title"`
	Category     string       `json:"category"` // Twitch game / YouTube category
	ViewerCount  int          `json:"viewerCount"`
	StartedAt    string       `json:"startedAt"` // RFC3339; empty when offline
	ThumbnailURL string       `json:"thumbnailUrl"`
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
		{"youtube", a.fetchYouTubeLive},
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

// ---------------------------------------------------------------------------
// Shared HTTP helper
// ---------------------------------------------------------------------------

// errReauth signals an expired/revoked token in a user-actionable way.
const errReauth = "Authentication expired. Reconnect in Settings → Services."

// getJSON performs an authenticated GET and decodes the JSON response into out.
func getJSON(endpoint string, headers map[string]string, out any) (int, error) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, err
	}
	if resp.StatusCode != http.StatusOK {
		msg := string(body)
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return resp.StatusCode, fmt.Errorf("request failed (%d): %s", resp.StatusCode, msg)
	}
	return resp.StatusCode, json.Unmarshal(body, out)
}

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
	twitchStreamsURL   = "https://api.twitch.tv/helix/streams"
	twitchChannelsURL  = "https://api.twitch.tv/helix/channels"
	twitchFollowersURL = "https://api.twitch.tv/helix/channels/followers"
)

func twitchHeaders(conn serviceConn) map[string]string {
	return map[string]string{
		"Authorization": "Bearer " + conn.token,
		"Client-Id":     conn.clientID,
	}
}

// fetchTwitchLive gathers the broadcaster's current stream (if live), channel
// metadata, and follower count from the Helix API.
func (a *App) fetchTwitchLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:    "twitch",
		ChannelName: conn.account,
		ChannelURL:  "https://twitch.tv/" + conn.login,
		StreamURL:   "https://twitch.tv/" + conn.login,
	}
	if conn.userID == "" {
		ls.Error = "Twitch account details unavailable — try reconnecting."
		return ls
	}
	headers := twitchHeaders(conn)

	// Current stream (empty data array = offline).
	var streams struct {
		Data []struct {
			ID           string   `json:"id"`
			GameName     string   `json:"game_name"`
			Title        string   `json:"title"`
			ViewerCount  int      `json:"viewer_count"`
			StartedAt    string   `json:"started_at"`
			Language     string   `json:"language"`
			ThumbnailURL string   `json:"thumbnail_url"`
			IsMature     bool     `json:"is_mature"`
			Tags         []string `json:"tags"`
		} `json:"data"`
	}
	status, err := getJSON(twitchStreamsURL+"?user_id="+conn.userID, headers, &streams)
	if err != nil {
		log.Printf("jax: twitch streams: %v", err)
		if status == http.StatusUnauthorized {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the Twitch API."
		}
		return ls
	}

	if len(streams.Data) > 0 {
		s := streams.Data[0]
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
	} else {
		// Offline: the channel endpoint still gives the configured title/category.
		var channels struct {
			Data []struct {
				Title    string `json:"title"`
				GameName string `json:"game_name"`
			} `json:"data"`
		}
		if _, err := getJSON(twitchChannelsURL+"?broadcaster_id="+conn.userID, headers, &channels); err == nil && len(channels.Data) > 0 {
			ls.Title = channels.Data[0].Title
			ls.Category = channels.Data[0].GameName
		}
	}

	// Follower count. Needs the moderator:read:followers scope for full data,
	// but `total` is returned for the broadcaster's own token; tolerate failure.
	var followers struct {
		Total int64 `json:"total"`
	}
	if _, err := getJSON(twitchFollowersURL+"?broadcaster_id="+conn.userID+"&first=1", headers, &followers); err == nil {
		ls.Details = append(ls.Details, DetailItem{"Followers", fmtCount(followers.Total)})
	}

	return ls
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const (
	youtubeChannelsURL = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true"
	// liveBroadcasts.list: broadcastStatus is a filter and must NOT be combined
	// with mine= (the API rejects two filters with incompatibleParameters); it
	// already scopes to the authenticated user. broadcastType=all is required to
	// include *persistent* broadcasts — streams started with the channel's
	// default stream key (e.g. from OBS) — which the default (event) excludes.
	youtubeBroadcastsURL = "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status&broadcastStatus=active&broadcastType=all"
	youtubeVideosURL     = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,liveStreamingDetails&id="
)

// fetchYouTubeLive gathers channel statistics and, when a broadcast is active,
// the live video's real-time metrics from the YouTube Data API.
func (a *App) fetchYouTubeLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:    "youtube",
		ChannelName: conn.account,
	}
	if conn.userID != "" {
		ls.ChannelURL = "https://youtube.com/channel/" + conn.userID
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	// Channel-level statistics (also our reachability/auth probe).
	var channels struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title     string `json:"title"`
				CustomURL string `json:"customUrl"`
			} `json:"snippet"`
			Statistics struct {
				SubscriberCount string `json:"subscriberCount"`
				ViewCount       string `json:"viewCount"`
				VideoCount      string `json:"videoCount"`
			} `json:"statistics"`
		} `json:"items"`
	}
	status, err := getJSON(youtubeChannelsURL, headers, &channels)
	if err != nil {
		log.Printf("jax: youtube channels: %v", err)
		if status == http.StatusUnauthorized {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the YouTube API."
		}
		return ls
	}
	if len(channels.Items) > 0 {
		ch := channels.Items[0]
		ls.ChannelName = firstNonEmpty(ch.Snippet.Title, ls.ChannelName)
		if ch.Snippet.CustomURL != "" {
			ls.ChannelURL = "https://youtube.com/" + ch.Snippet.CustomURL
		} else if ch.ID != "" {
			ls.ChannelURL = "https://youtube.com/channel/" + ch.ID
		}
		ls.Details = append(ls.Details,
			DetailItem{"Subscribers", fmtCount(atoi64(ch.Statistics.SubscriberCount))},
			DetailItem{"Total channel views", fmtCount(atoi64(ch.Statistics.ViewCount))},
			DetailItem{"Videos", fmtCount(atoi64(ch.Statistics.VideoCount))},
		)
	}

	// Active broadcast, if any.
	var broadcasts struct {
		Items []struct {
			ID     string `json:"id"`
			Status struct {
				PrivacyStatus string `json:"privacyStatus"`
			} `json:"status"`
		} `json:"items"`
	}
	if _, err := getJSON(youtubeBroadcastsURL, headers, &broadcasts); err != nil {
		log.Printf("jax: youtube liveBroadcasts: %v", err)
		ls.Error = "Could not check for an active YouTube broadcast."
		return ls
	}
	if len(broadcasts.Items) == 0 {
		return ls // connected, not live
	}

	b := broadcasts.Items[0]
	videoID := b.ID
	ls.Live = true
	ls.StreamURL = "https://youtube.com/watch?v=" + videoID
	ls.Details = append(ls.Details,
		DetailItem{"Video ID", videoID},
		DetailItem{"Privacy", b.Status.PrivacyStatus},
	)

	// Real-time video metrics for the live broadcast.
	var videos struct {
		Items []struct {
			Snippet struct {
				Title      string `json:"title"`
				CategoryID string `json:"categoryId"`
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
			LiveStreamingDetails struct {
				ActualStartTime   string `json:"actualStartTime"`
				ConcurrentViewers string `json:"concurrentViewers"`
			} `json:"liveStreamingDetails"`
		} `json:"items"`
	}
	if _, err := getJSON(youtubeVideosURL+videoID, headers, &videos); err == nil && len(videos.Items) > 0 {
		v := videos.Items[0]
		ls.Title = v.Snippet.Title
		ls.ViewerCount = int(atoi64(v.LiveStreamingDetails.ConcurrentViewers))
		ls.StartedAt = v.LiveStreamingDetails.ActualStartTime
		ls.ThumbnailURL = firstNonEmpty(
			v.Snippet.Thumbnails.High.URL,
			v.Snippet.Thumbnails.Medium.URL,
		)
		ls.Details = append(ls.Details,
			DetailItem{"Stream views so far", fmtCount(atoi64(v.Statistics.ViewCount))},
			DetailItem{"Likes", fmtCount(atoi64(v.Statistics.LikeCount))},
		)
	}

	return ls
}

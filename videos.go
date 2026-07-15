package main

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Videos
//
// The Videos page aggregates every video/VOD from the connected channels:
// Twitch archives/highlights/uploads and the YouTube channel's uploads
// playlist (which includes completed live streams). None of this is
// real-time, so lists and per-video details are cached for apiCacheTTL
// (see cache.go) with a force-refresh escape hatch.
// ---------------------------------------------------------------------------

// Video is one hosted video/VOD on a connected channel.
type Video struct {
	Platform     string `json:"platform"` // "twitch" | "youtube"
	ID           string `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl"`
	PublishedAt  string `json:"publishedAt"` // RFC3339
	Duration     string `json:"duration"`    // compact, e.g. "3h8m33s"
	DurationSecs int    `json:"durationSecs"`
	ViewCount    int64  `json:"viewCount"`
	Kind         string `json:"kind"`   // "VOD" | "Highlight" | "Upload" | "Live VOD" | "Short" | "Reel"
	Status       string `json:"status"` // "public" | "unlisted" | "private"
	ChannelName  string `json:"channelName"`
	// IsShort marks short-form video — a YouTube Short, a Facebook Reel, an
	// Instagram Reel. See shorts.go for how each platform is asked.
	IsShort bool `json:"isShort"`
}

// normalizeVideoStatus maps platform visibility values (YouTube privacyStatus,
// Twitch viewable) onto one vocabulary. Empty reads as public so entries from
// before the field existed stay visible.
func normalizeVideoStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "private":
		return "private"
	case "unlisted":
		return "unlisted"
	default:
		return "public"
	}
}

// VideoList is the aggregated video set plus cache provenance for the UI's
// "updated N minutes ago" hint.
type VideoList struct {
	Videos    []Video `json:"videos"`
	FetchedAt string  `json:"fetchedAt"` // RFC3339; when the data left the APIs
	FromCache bool    `json:"fromCache"`
}

// VideoComment is one viewer comment on a video.
type VideoComment struct {
	Author      string `json:"author"`
	AvatarURL   string `json:"avatarUrl"`
	Text        string `json:"text"`
	LikeCount   int64  `json:"likeCount"`
	ReplyCount  int64  `json:"replyCount"`
	PublishedAt string `json:"publishedAt"`
}

// VideoDetails carries everything the video detail view shows: the video
// itself, analytics as label/value stats, and viewer comments.
type VideoDetails struct {
	Video Video `json:"video"`
	// Stats are platform analytics (views, likes, comments, privacy, ...).
	Stats    []DetailItem   `json:"stats"`
	Comments []VideoComment `json:"comments"`
	// CommentsNote explains an empty comment list (e.g. Twitch's API does not
	// expose VOD comments); empty when comments simply loaded.
	CommentsNote string `json:"commentsNote"`
	FetchedAt    string `json:"fetchedAt"`
	FromCache    bool   `json:"fromCache"`
}

// maxVideosPerPlatform bounds how much history each platform contributes.
const maxVideosPerPlatform = 200

// allVideos fetches every video across the connected platforms (Twitch
// VODs/highlights/uploads + clips, YouTube uploads excluding live-originated),
// newest first, cached for apiCacheTTL. No past-stream de-duplication — that is
// applied by GetVideos for the global Videos page.
func (a *App) allVideos(forceRefresh bool) ([]Video, time.Time, bool, error) {
	fetch := func() ([]Video, error) {
		type job struct {
			name string
			f    func(serviceConn) ([]Video, error)
		}
		jobs := []job{
			{"twitch", fetchTwitchVideos},
			{"youtube", fetchYouTubeVideos},
			{"kick", fetchKickVideos},
			{"facebook", a.fetchFacebookVideos},
			// Short-form lives apart from the long: Facebook Reels have their
			// own edge, Instagram is only reachable at all through its media
			// edge (see shorts.go), and TikTok is short-form by definition.
			{"facebook", a.fetchFacebookReels},
			{"instagram", a.fetchInstagramReels},
			{"tiktok", a.fetchTikTokVideos},
		}

		var (
			wg        sync.WaitGroup
			mu        sync.Mutex
			all       []Video
			attempted int
			failures  int
		)
		for _, j := range jobs {
			conn, ok := a.freshConn(j.name)
			if !ok {
				continue
			}
			attempted++
			wg.Add(1)
			go func(name string, f func(serviceConn) ([]Video, error), conn serviceConn) {
				defer wg.Done()
				items, err := f(conn)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					log.Printf("jax: %s videos: %v", name, err)
					failures++
					return
				}
				all = append(all, items...)
			}(j.name, j.f, conn)
		}
		wg.Wait()

		if attempted == 0 {
			return nil, fmt.Errorf("no services connected")
		}
		if failures == attempted {
			return nil, fmt.Errorf("every connected platform failed")
		}
		// Reels arrive knowing what they are; YouTube uploads have to be asked
		// (see shorts.go). Done here, inside the fetch, so the verdicts are
		// cached with the videos rather than re-derived on every read.
		a.markShorts(all)
		sortVideosNewestFirst(all)
		return all, nil
	}

	// v7: adds short-form — YouTube Shorts, Facebook and Instagram Reels.
	// (v6: Twitch VODs/highlights/uploads + clips; YouTube live-originated
	// videos excluded via liveBroadcastContent + scheduled/actual start.)
	return cachedJSON(a, a.connsCacheKey("videos_v7"), apiCacheTTL, forceRefresh, fetch)
}

// GetChannelVideos returns one platform's videos (VODs, highlights, uploads,
// clips) newest-first, without the past-stream de-duplication — a channel's own
// page shows its full catalogue. Never returns nil.
func (a *App) GetChannelVideos(platform string) []Video {
	videos, _, _, err := a.allVideos(false)
	if err != nil {
		return []Video{}
	}
	out := []Video{}
	for _, v := range videos {
		if v.Platform == platform {
			out = append(out, v)
		}
	}
	return out
}

// GetVideos returns every video on the connected channels, newest first, with
// past-stream broadcasts removed (they have their own section). Results are
// cached for apiCacheTTL; forceRefresh bypasses the cache. Never returns a nil
// Videos slice.
func (a *App) GetVideos(forceRefresh bool) VideoList {
	videos, at, cached, err := a.allVideos(forceRefresh)
	if err != nil {
		log.Printf("jax: GetVideos: %v", err)
		return VideoList{Videos: []Video{}}
	}

	// Belt and suspenders: drop anything that also surfaces as a past stream
	// (its own section). The per-platform fetches already exclude live VODs,
	// but this guarantees no overlap even if a broadcast slips the heuristic.
	pastURLs := a.pastBroadcastURLs()
	filtered := make([]Video, 0, len(videos))
	for _, v := range videos {
		if pastURLs[v.URL] {
			continue
		}
		filtered = append(filtered, v)
	}
	videos = filtered

	return VideoList{
		Videos:    videos,
		FetchedAt: at.Format(time.RFC3339),
		FromCache: cached,
	}
}

// GetVideoDetails returns analytics and comments for one video. Cached for
// apiCacheTTL per video; forceRefresh bypasses the cache.
func (a *App) GetVideoDetails(platform, id string, forceRefresh bool) (VideoDetails, error) {
	switch platform {
	case "twitch", "youtube", "kick", "facebook":
	default:
		return VideoDetails{}, fmt.Errorf("unknown platform %q", platform)
	}
	conn, ok := a.freshConn(platform)
	if !ok {
		return VideoDetails{}, fmt.Errorf("%s is not connected", platformLabel(platform))
	}

	// Optional Google API key enables reading public YouTube comments (the
	// device-flow OAuth token lacks the youtube.force-ssl scope those need).
	apiKey := ""
	if a.store != nil {
		apiKey, _ = a.store.getSetting("youtube_api_key")
	}

	fetch := func() (VideoDetails, error) {
		switch platform {
		case "twitch":
			return fetchTwitchVideoDetails(conn, id)
		case "kick":
			return fetchKickVideoDetails(conn, id)
		case "facebook":
			return a.fetchFacebookVideoDetails(conn, id)
		}
		return fetchYouTubeVideoDetails(conn, id, apiKey)
	}

	key := "video|" + platform + "|" + id
	details, at, cached, err := cachedJSON(a, key, apiCacheTTL, forceRefresh, fetch)
	if err != nil {
		return VideoDetails{}, err
	}
	if details.Comments == nil {
		details.Comments = []VideoComment{}
	}
	if details.Stats == nil {
		details.Stats = []DetailItem{}
	}
	details.FetchedAt = at.Format(time.RFC3339)
	details.FromCache = cached
	return details, nil
}

// pastBroadcastURLs returns the set of broadcast URLs currently represented
// on the Streams page, so Videos can exclude them. Uses the cached past
// streams; never returns nil.
func (a *App) pastBroadcastURLs() map[string]bool {
	set := map[string]bool{}
	for _, s := range a.GetPastStreams(false) {
		for _, b := range s.Broadcasts {
			if b.URL != "" {
				set[b.URL] = true
			}
		}
	}
	return set
}

func sortVideosNewestFirst(videos []Video) {
	sort.Slice(videos, func(i, j int) bool {
		return videos[i].PublishedAt > videos[j].PublishedAt
	})
}

func platformLabel(platform string) string {
	switch platform {
	case "twitch":
		return "Twitch"
	case "youtube":
		return "YouTube"
	case "kick":
		return "Kick"
	case "facebook":
		return "Facebook"
	case "instagram":
		return "Instagram"
	case "x":
		return "X"
	case "tiktok":
		return "TikTok"
	}
	return platform
}

// ---------------------------------------------------------------------------
// Twitch
// ---------------------------------------------------------------------------

// twitchKind maps Helix video types to display labels.
func twitchKind(t string) string {
	switch t {
	case "archive":
		return "VOD"
	case "highlight":
		return "Highlight"
	case "upload":
		return "Upload"
	}
	return "VOD"
}

// twitchVideoItem is the Helix videos payload shared by list and detail calls.
type twitchVideoItem struct {
	ID           string `json:"id"`
	StreamID     string `json:"stream_id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnail_url"`
	CreatedAt    string `json:"created_at"`
	PublishedAt  string `json:"published_at"`
	Duration     string `json:"duration"`
	ViewCount    int64  `json:"view_count"`
	Language     string `json:"language"`
	Type         string `json:"type"`
	Viewable     string `json:"viewable"` // "public" | "private"
	UserName     string `json:"user_name"`
}

func (v twitchVideoItem) toVideo() Video {
	thumb := ""
	if v.ThumbnailURL != "" {
		thumb = strings.NewReplacer(
			"%{width}", "640", "%{height}", "360",
		).Replace(v.ThumbnailURL)
	}
	return Video{
		Platform:     "twitch",
		ID:           v.ID,
		Title:        v.Title,
		Description:  v.Description,
		URL:          v.URL,
		ThumbnailURL: thumb,
		PublishedAt:  firstNonEmpty(v.PublishedAt, v.CreatedAt),
		Duration:     v.Duration,
		DurationSecs: parseCompactDuration(v.Duration),
		ViewCount:    v.ViewCount,
		Kind:         twitchKind(v.Type),
		Status:       normalizeVideoStatus(v.Viewable),
		ChannelName:  v.UserName,
	}
}

// fetchTwitchVideos pages through the channel's videos — archive VODs,
// highlights, and uploads — up to maxVideosPerPlatform, then appends the
// channel's clips. Broadcast VODs that also surface on the Streams page are
// de-duplicated later by GetVideos (see pastBroadcastURLs).
func fetchTwitchVideos(conn serviceConn) ([]Video, error) {
	if conn.userID == "" {
		return nil, fmt.Errorf("missing broadcaster id")
	}
	headers := twitchHeaders(conn)

	// Twitch creates the archive VOD while the stream is still running, with
	// no usable thumbnail yet (a broken processing placeholder) — same case
	// past.go excludes from the Streams page since it belongs on the live
	// card instead. Find the current live stream id (if any) so its
	// in-progress VOD can be excluded here too.
	liveStreamID := ""
	var liveResp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if _, err := getJSON(twitchStreamsURL+"?user_id="+conn.userID, headers, &liveResp); err == nil && len(liveResp.Data) > 0 {
		liveStreamID = liveResp.Data[0].ID
	}

	var out []Video
	cursor := ""
	for len(out) < maxVideosPerPlatform {
		endpoint := twitchVideosURL + "?user_id=" + conn.userID + "&first=100"
		if cursor != "" {
			endpoint += "&after=" + url.QueryEscape(cursor)
		}
		var resp struct {
			Data       []twitchVideoItem `json:"data"`
			Pagination struct {
				Cursor string `json:"cursor"`
			} `json:"pagination"`
		}
		if _, err := getJSON(endpoint, headers, &resp); err != nil {
			// Keep earlier pages rather than failing the whole platform.
			if len(out) > 0 {
				break
			}
			return nil, err
		}
		if len(resp.Data) == 0 {
			break
		}
		for _, v := range resp.Data {
			if liveStreamID != "" && v.StreamID == liveStreamID {
				continue // the broadcast is still live; it belongs on the live card
			}
			out = append(out, v.toVideo())
		}
		cursor = resp.Pagination.Cursor
		if cursor == "" {
			break
		}
	}
	// Clips live on a separate endpoint; tolerate their failure so the VODs
	// and highlights still surface.
	if clips, err := fetchTwitchClips(conn); err == nil {
		out = append(out, clips...)
	} else {
		log.Printf("jax: twitch clips: %v", err)
	}
	return out, nil
}

// twitchClipItem is one entry from the Helix clips endpoint.
type twitchClipItem struct {
	ID              string  `json:"id"`
	URL             string  `json:"url"`
	Title           string  `json:"title"`
	ThumbnailURL    string  `json:"thumbnail_url"`
	CreatedAt       string  `json:"created_at"`
	Duration        float64 `json:"duration"` // seconds
	ViewCount       int64   `json:"view_count"`
	BroadcasterName string  `json:"broadcaster_name"`
}

func (c twitchClipItem) toVideo() Video {
	secs := int(c.Duration + 0.5)
	return Video{
		Platform:     "twitch",
		ID:           c.ID,
		Title:        c.Title,
		URL:          c.URL,
		ThumbnailURL: c.ThumbnailURL,
		PublishedAt:  c.CreatedAt,
		Duration:     compactDurationFromSecs(secs),
		DurationSecs: secs,
		ViewCount:    c.ViewCount,
		Kind:         "Clip",
		Status:       "public",
		ChannelName:  c.BroadcasterName,
	}
}

// fetchTwitchClips pages through the channel's clips up to maxVideosPerPlatform.
func fetchTwitchClips(conn serviceConn) ([]Video, error) {
	if conn.userID == "" {
		return nil, fmt.Errorf("missing broadcaster id")
	}
	headers := twitchHeaders(conn)

	var out []Video
	cursor := ""
	for len(out) < maxVideosPerPlatform {
		endpoint := twitchClipsURL + "?broadcaster_id=" + conn.userID + "&first=100"
		if cursor != "" {
			endpoint += "&after=" + url.QueryEscape(cursor)
		}
		var resp struct {
			Data       []twitchClipItem `json:"data"`
			Pagination struct {
				Cursor string `json:"cursor"`
			} `json:"pagination"`
		}
		if _, err := getJSON(endpoint, headers, &resp); err != nil {
			if len(out) > 0 {
				break
			}
			return nil, err
		}
		if len(resp.Data) == 0 {
			break
		}
		for _, c := range resp.Data {
			out = append(out, c.toVideo())
		}
		cursor = resp.Pagination.Cursor
		if cursor == "" {
			break
		}
	}
	return out, nil
}

// compactDurationFromSecs formats seconds as e.g. "3h8m33s" to match the
// Twitch VOD duration style.
func compactDurationFromSecs(secs int) string {
	if secs <= 0 {
		return ""
	}
	h, m, s := secs/3600, (secs%3600)/60, secs%60
	switch {
	case h > 0:
		return fmt.Sprintf("%dh%dm%ds", h, m, s)
	case m > 0:
		return fmt.Sprintf("%dm%ds", m, s)
	default:
		return fmt.Sprintf("%ds", s)
	}
}

func fetchTwitchVideoDetails(conn serviceConn, id string) (VideoDetails, error) {
	var resp struct {
		Data []twitchVideoItem `json:"data"`
	}
	if _, err := getJSON(twitchVideosURL+"?id="+url.QueryEscape(id), twitchHeaders(conn), &resp); err != nil {
		return VideoDetails{}, err
	}
	if len(resp.Data) == 0 {
		return VideoDetails{}, fmt.Errorf("video %s not found", id)
	}
	v := resp.Data[0]

	d := VideoDetails{Video: v.toVideo()}
	d.Stats = append(d.Stats,
		DetailItem{"Views", fmtCount(v.ViewCount)},
		DetailItem{"Type", twitchKind(v.Type)},
	)
	if v.Duration != "" {
		d.Stats = append(d.Stats, DetailItem{"Duration", v.Duration})
	}
	if v.Language != "" {
		d.Stats = append(d.Stats, DetailItem{"Language", v.Language})
	}
	if v.Viewable != "" {
		d.Stats = append(d.Stats, DetailItem{"Visibility", v.Viewable})
	}
	d.CommentsNote = "Twitch does not expose VOD comments or likes through its public API."
	return d, nil
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const (
	youtubeUploadsPlaylistURL = "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true"
	youtubePlaylistItemsURL   = "https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50"
	youtubeVideoListURL       = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status,liveStreamingDetails&id="
	youtubeVideoDetailURL     = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status,liveStreamingDetails&id="
	youtubeCommentThreadsURL  = "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&order=relevance&textFormat=plainText&maxResults=25&videoId="
)

// youtubeVideoItem is the videos.list payload shared by list and detail calls.
type youtubeVideoItem struct {
	ID      string `json:"id"`
	Snippet struct {
		Title        string `json:"title"`
		Description  string `json:"description"`
		PublishedAt  string `json:"publishedAt"`
		ChannelTitle string `json:"channelTitle"`
		// "live" | "upcoming" | "none" — the definitive live-broadcast flag.
		LiveBroadcastContent string `json:"liveBroadcastContent"`
		Thumbnails           struct {
			Medium struct {
				URL string `json:"url"`
			} `json:"medium"`
			High struct {
				URL string `json:"url"`
			} `json:"high"`
		} `json:"thumbnails"`
	} `json:"snippet"`
	Statistics struct {
		ViewCount     string `json:"viewCount"`
		LikeCount     string `json:"likeCount"`
		CommentCount  string `json:"commentCount"`
		FavoriteCount string `json:"favoriteCount"`
	} `json:"statistics"`
	ContentDetails struct {
		Duration   string `json:"duration"`
		Definition string `json:"definition"`
		Caption    string `json:"caption"`
	} `json:"contentDetails"`
	Status struct {
		PrivacyStatus string `json:"privacyStatus"`
	} `json:"status"`
	LiveStreamingDetails struct {
		ScheduledStartTime string `json:"scheduledStartTime"`
		ActualStartTime    string `json:"actualStartTime"`
		ActualEndTime      string `json:"actualEndTime"`
	} `json:"liveStreamingDetails"`
}

// wasEverLive reports whether the video is, was, or will be a live broadcast
// (live, upcoming/premiere, scheduled, or a finished live VOD). Such videos
// belong to the Streams page, not Videos. Checking liveBroadcastContent and
// scheduledStartTime — not just actualStartTime — catches broadcasts that are
// currently live (actualStartTime can lag) or not yet started.
func (v youtubeVideoItem) wasEverLive() bool {
	if lbc := v.Snippet.LiveBroadcastContent; lbc == "live" || lbc == "upcoming" {
		return true
	}
	return v.LiveStreamingDetails.ActualStartTime != "" ||
		v.LiveStreamingDetails.ScheduledStartTime != ""
}

func (v youtubeVideoItem) toVideo() Video {
	compact := formatISODuration(v.ContentDetails.Duration)
	return Video{
		Platform:    "youtube",
		ID:          v.ID,
		Title:       v.Snippet.Title,
		Description: v.Snippet.Description,
		URL:         "https://youtube.com/watch?v=" + v.ID,
		ThumbnailURL: firstNonEmpty(
			v.Snippet.Thumbnails.High.URL,
			v.Snippet.Thumbnails.Medium.URL,
		),
		PublishedAt:  v.Snippet.PublishedAt,
		Duration:     compact,
		DurationSecs: parseCompactDuration(compact),
		ViewCount:    atoi64(v.Statistics.ViewCount),
		Kind:         "Upload",
		Status:       normalizeVideoStatus(v.Status.PrivacyStatus),
		ChannelName:  v.Snippet.ChannelTitle,
	}
}

// fetchYouTubeVideos walks the channel's uploads playlist and enriches each
// page with stats and durations. Videos that originated as live broadcasts
// are dropped — they belong to the Streams page.
func fetchYouTubeVideos(conn serviceConn) ([]Video, error) {
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	// The uploads playlist id is the canonical "all videos on this channel".
	var channels struct {
		Items []struct {
			ContentDetails struct {
				RelatedPlaylists struct {
					Uploads string `json:"uploads"`
				} `json:"relatedPlaylists"`
			} `json:"contentDetails"`
		} `json:"items"`
	}
	if _, err := getJSON(youtubeUploadsPlaylistURL, headers, &channels); err != nil {
		return nil, err
	}
	if len(channels.Items) == 0 || channels.Items[0].ContentDetails.RelatedPlaylists.Uploads == "" {
		return nil, nil
	}
	playlist := channels.Items[0].ContentDetails.RelatedPlaylists.Uploads

	var ids []string
	pageToken := ""
	for len(ids) < maxVideosPerPlatform {
		endpoint := youtubePlaylistItemsURL + "&playlistId=" + url.QueryEscape(playlist)
		if pageToken != "" {
			endpoint += "&pageToken=" + url.QueryEscape(pageToken)
		}
		var page struct {
			Items []struct {
				ContentDetails struct {
					VideoID string `json:"videoId"`
				} `json:"contentDetails"`
			} `json:"items"`
			NextPageToken string `json:"nextPageToken"`
		}
		if _, err := getJSON(endpoint, headers, &page); err != nil {
			if len(ids) > 0 {
				break
			}
			return nil, err
		}
		for _, item := range page.Items {
			if item.ContentDetails.VideoID != "" {
				ids = append(ids, item.ContentDetails.VideoID)
			}
		}
		pageToken = page.NextPageToken
		if pageToken == "" || len(page.Items) == 0 {
			break
		}
	}
	if len(ids) > maxVideosPerPlatform {
		ids = ids[:maxVideosPerPlatform]
	}

	// videos.list accepts up to 50 ids per call.
	var out []Video
	for start := 0; start < len(ids); start += 50 {
		end := start + 50
		if end > len(ids) {
			end = len(ids)
		}
		var videos struct {
			Items []youtubeVideoItem `json:"items"`
		}
		if _, err := getJSON(youtubeVideoListURL+strings.Join(ids[start:end], ","), headers, &videos); err != nil {
			if len(out) > 0 {
				break
			}
			return nil, err
		}
		for _, v := range videos.Items {
			if v.wasEverLive() {
				continue // live broadcasts (and their VODs) belong to Streams
			}
			video := v.toVideo()
			if video.ChannelName == "" {
				video.ChannelName = conn.account
			}
			out = append(out, video)
		}
	}
	return out, nil
}

func fetchYouTubeVideoDetails(conn serviceConn, id, apiKey string) (VideoDetails, error) {
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	var videos struct {
		Items []youtubeVideoItem `json:"items"`
	}
	if _, err := getJSON(youtubeVideoDetailURL+url.QueryEscape(id), headers, &videos); err != nil {
		return VideoDetails{}, err
	}
	if len(videos.Items) == 0 {
		return VideoDetails{}, fmt.Errorf("video %s not found", id)
	}
	v := videos.Items[0]

	d := VideoDetails{Video: v.toVideo()}
	d.Stats = append(d.Stats,
		DetailItem{"Views", fmtCount(atoi64(v.Statistics.ViewCount))},
		DetailItem{"Likes", fmtCount(atoi64(v.Statistics.LikeCount))},
		DetailItem{"Comments", fmtCount(atoi64(v.Statistics.CommentCount))},
	)
	if d.Video.Duration != "" {
		d.Stats = append(d.Stats, DetailItem{"Duration", d.Video.Duration})
	}
	if v.Status.PrivacyStatus != "" {
		d.Stats = append(d.Stats, DetailItem{"Privacy", v.Status.PrivacyStatus})
	}
	if v.ContentDetails.Definition != "" {
		d.Stats = append(d.Stats, DetailItem{"Definition", strings.ToUpper(v.ContentDetails.Definition)})
	}
	if v.ContentDetails.Caption == "true" {
		d.Stats = append(d.Stats, DetailItem{"Captions", "Yes"})
	}

	// Top comments by relevance. Comments may be disabled for the video, in
	// which case the API rejects the call — degrade to a note instead.
	var threads struct {
		Items []struct {
			Snippet struct {
				TotalReplyCount int64 `json:"totalReplyCount"`
				TopLevelComment struct {
					Snippet struct {
						AuthorDisplayName     string `json:"authorDisplayName"`
						AuthorProfileImageURL string `json:"authorProfileImageUrl"`
						TextDisplay           string `json:"textDisplay"`
						LikeCount             int64  `json:"likeCount"`
						PublishedAt           string `json:"publishedAt"`
					} `json:"snippet"`
				} `json:"topLevelComment"`
			} `json:"snippet"`
		} `json:"items"`
	}
	// With a Google API key we can read public comments directly (no OAuth
	// token — it lacks the youtube.force-ssl scope those need). Otherwise the
	// OAuth call 403s and we explain how to enable them.
	commentsURL := youtubeCommentThreadsURL + url.QueryEscape(id)
	commentHeaders := headers
	if apiKey != "" {
		commentsURL += "&key=" + url.QueryEscape(apiKey)
		commentHeaders = nil
	}
	if status, err := getJSON(commentsURL, commentHeaders, &threads); err != nil {
		if apiKey == "" && status == http.StatusForbidden {
			// commentThreads.list needs the youtube.force-ssl scope, which the
			// device-authorization flow this app uses cannot request, so a 403
			// here is expected — not a failure worth logging loudly.
			d.CommentsNote = "YouTube comments need a Google API key — add one in Settings → Services to load them."
		} else {
			log.Printf("jax: youtube comments for %s: %v", id, err)
			d.CommentsNote = "Comments could not be loaded — they may be disabled for this video."
		}
	} else {
		for _, t := range threads.Items {
			c := t.Snippet.TopLevelComment.Snippet
			d.Comments = append(d.Comments, VideoComment{
				Author:      c.AuthorDisplayName,
				AvatarURL:   c.AuthorProfileImageURL,
				Text:        c.TextDisplay,
				LikeCount:   c.LikeCount,
				ReplyCount:  t.Snippet.TotalReplyCount,
				PublishedAt: c.PublishedAt,
			})
		}
	}
	return d, nil
}

package main

import (
	"fmt"
	"log"
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
	Kind         string `json:"kind"`   // "VOD" | "Highlight" | "Upload" | "Live VOD"
	Status       string `json:"status"` // "public" | "unlisted" | "private"
	ChannelName  string `json:"channelName"`
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

// GetVideos returns every video on the connected channels, newest first.
// Results are cached for apiCacheTTL; forceRefresh bypasses the cache.
// Never returns a nil Videos slice.
func (a *App) GetVideos(forceRefresh bool) VideoList {
	fetch := func() ([]Video, error) {
		type job struct {
			name string
			f    func(serviceConn) ([]Video, error)
		}
		jobs := []job{
			{"twitch", fetchTwitchVideos},
			{"youtube", fetchYouTubeVideos},
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
		sortVideosNewestFirst(all)
		return all, nil
	}

	// v2: cache entries carry the videos' visibility status.
	videos, at, cached, err := cachedJSON(a, a.connsCacheKey("videos_v2"), apiCacheTTL, forceRefresh, fetch)
	if err != nil {
		log.Printf("jax: GetVideos: %v", err)
		return VideoList{Videos: []Video{}}
	}
	if videos == nil {
		videos = []Video{}
	}
	return VideoList{
		Videos:    videos,
		FetchedAt: at.Format(time.RFC3339),
		FromCache: cached,
	}
}

// GetVideoDetails returns analytics and comments for one video. Cached for
// apiCacheTTL per video; forceRefresh bypasses the cache.
func (a *App) GetVideoDetails(platform, id string, forceRefresh bool) (VideoDetails, error) {
	if platform != "twitch" && platform != "youtube" {
		return VideoDetails{}, fmt.Errorf("unknown platform %q", platform)
	}
	conn, ok := a.freshConn(platform)
	if !ok {
		return VideoDetails{}, fmt.Errorf("%s is not connected", platformLabel(platform))
	}

	fetch := func() (VideoDetails, error) {
		if platform == "twitch" {
			return fetchTwitchVideoDetails(conn, id)
		}
		return fetchYouTubeVideoDetails(conn, id)
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

// fetchTwitchVideos pages through the channel's videos (archives, highlights,
// and uploads) up to maxVideosPerPlatform.
func fetchTwitchVideos(conn serviceConn) ([]Video, error) {
	if conn.userID == "" {
		return nil, fmt.Errorf("missing broadcaster id")
	}
	headers := twitchHeaders(conn)

	// While a stream is running, its in-progress archive VOD has no usable
	// thumbnail (Twitch serves a broken processing placeholder). Grab the live
	// stream's id and preview image so that VOD can borrow them.
	liveStreamID, liveThumb := "", ""
	var liveResp struct {
		Data []struct {
			ID           string `json:"id"`
			ThumbnailURL string `json:"thumbnail_url"`
		} `json:"data"`
	}
	if _, err := getJSON(twitchStreamsURL+"?user_id="+conn.userID, headers, &liveResp); err == nil && len(liveResp.Data) > 0 {
		liveStreamID = liveResp.Data[0].ID
		liveThumb = strings.NewReplacer(
			"{width}", "640", "{height}", "360",
		).Replace(liveResp.Data[0].ThumbnailURL)
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
			video := v.toVideo()
			// The in-progress VOD of the current live stream: borrow the live
			// preview image and flag it.
			if liveStreamID != "" && v.StreamID == liveStreamID {
				if liveThumb != "" {
					video.ThumbnailURL = liveThumb
				}
				video.Kind = "Live now"
			}
			out = append(out, video)
		}
		cursor = resp.Pagination.Cursor
		if cursor == "" {
			break
		}
	}
	return out, nil
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
		Thumbnails   struct {
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
		ActualStartTime string `json:"actualStartTime"`
	} `json:"liveStreamingDetails"`
}

func (v youtubeVideoItem) toVideo() Video {
	kind := "Upload"
	if v.LiveStreamingDetails.ActualStartTime != "" {
		kind = "Live VOD"
	}
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
		Kind:         kind,
		Status:       normalizeVideoStatus(v.Status.PrivacyStatus),
		ChannelName:  v.Snippet.ChannelTitle,
	}
}

// fetchYouTubeVideos walks the channel's uploads playlist (which includes
// completed live streams) and enriches each page with stats and durations.
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
			video := v.toVideo()
			if video.ChannelName == "" {
				video.ChannelName = conn.account
			}
			out = append(out, video)
		}
	}
	return out, nil
}

func fetchYouTubeVideoDetails(conn serviceConn, id string) (VideoDetails, error) {
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
	if _, err := getJSON(youtubeCommentThreadsURL+url.QueryEscape(id), headers, &threads); err != nil {
		log.Printf("jax: youtube comments for %s: %v", id, err)
		d.CommentsNote = "Comments could not be loaded — they may be disabled for this video."
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

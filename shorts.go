package main

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// Short-form video
//
// Shorts, Reels — the same thing under three names, and the Videos page shows
// them together. Each platform reports them differently, or not at all:
//
//   - YouTube's API has no "is this a Short" field. Duration alone is not
//     enough (a 90-second landscape upload is not a Short), so short-enough
//     candidates are confirmed against youtube.com/shorts/<id>, which serves a
//     Short and redirects anything else. The verdicts are cached, so a channel
//     is probed once per video, not once per page view.
//   - Facebook Reels live on their own graph edge (video_reels), separate from
//     the page's videos.
//   - Instagram media carries media_product_type, which names Reels outright.
//     Read with instagram_basic, which the app already asks for; view counts
//     would need the insights permission, which it does not, so Reels come
//     back with engagement counts rather than views.
// ---------------------------------------------------------------------------

// shortMaxSecs is the longest a YouTube Short can be (3 minutes since 2024).
// Anything longer is not worth probing.
const shortMaxSecs = 180

// keyYouTubeShorts caches the videoID → is-a-Short verdicts, so the probe below
// runs once per video ever rather than on every refresh.
const keyYouTubeShorts = "youtube_shorts_v1"

// shortsProbeHTTP never follows redirects: the redirect *is* the answer.
var shortsProbeHTTP = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// isYouTubeShort asks YouTube whether a video is a Short. The Shorts player
// serves a Short at /shorts/<id> and redirects everything else to /watch, so
// the status code is the verdict.
func isYouTubeShort(id string) (bool, error) {
	req, err := http.NewRequest(http.MethodHead,
		"https://www.youtube.com/shorts/"+url.PathEscape(id), nil)
	if err != nil {
		return false, err
	}
	// Without a browser-ish agent YouTube can answer with a consent page.
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Jax/1.0)")
	resp, err := shortsProbeHTTP.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		return true, nil
	case resp.StatusCode >= 300 && resp.StatusCode < 400:
		return false, nil // redirected to the normal watch page: not a Short
	default:
		// 4xx/5xx tells us nothing about the video; don't cache a guess.
		return false, fmt.Errorf("youtube answered %d", resp.StatusCode)
	}
}

// youtubeShortVerdicts loads the cached videoID → is-a-Short map. Never nil.
func (a *App) youtubeShortVerdicts() map[string]bool {
	m := map[string]bool{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyYouTubeShorts, &m); err != nil {
			log.Printf("jax: load shorts verdicts: %v", err)
		}
	}
	if m == nil {
		return map[string]bool{}
	}
	return m
}

// markShorts flags the short-form videos in place.
//
// Reels already know what they are (their fetches say so). YouTube uploads do
// not, so every candidate short enough to be a Short is confirmed against the
// Shorts player — cached verdicts first, then the ones never seen before, a few
// at a time. A probe that fails leaves the video unflagged rather than guessing:
// a long-form video mislabelled as a Short would land in the wrong tab, and
// silently wrong is worse than missing.
func (a *App) markShorts(videos []Video) {
	known := a.youtubeShortVerdicts()

	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		fresh   = map[string]bool{}
		limiter = make(chan struct{}, 6) // be gentle: this is a scrape, not an API
	)

	for i := range videos {
		v := &videos[i]
		if v.Platform != "youtube" || v.IsShort {
			continue
		}
		// Kind is set by the fetch; only plain uploads can be Shorts.
		if v.Kind != "Upload" || v.DurationSecs <= 0 || v.DurationSecs > shortMaxSecs {
			continue
		}
		if verdict, seen := known[v.ID]; seen {
			v.IsShort = verdict
			continue
		}
		wg.Add(1)
		go func(v *Video) {
			defer wg.Done()
			limiter <- struct{}{}
			defer func() { <-limiter }()

			short, err := isYouTubeShort(v.ID)
			if err != nil {
				log.Printf("jax: shorts probe %s: %v", v.ID, err)
				return // unknown: leave it long-form and try again next refresh
			}
			mu.Lock()
			fresh[v.ID] = short
			v.IsShort = short
			mu.Unlock()
		}(v)
	}
	wg.Wait()

	// A video's shape never changes, so the verdicts are worth keeping forever.
	if len(fresh) > 0 && a.store != nil {
		for id, short := range fresh {
			known[id] = short
		}
		if err := a.store.setJSON(keyYouTubeShorts, known); err != nil {
			log.Printf("jax: save shorts verdicts: %v", err)
		}
	}

	// Everything short-form reads as one thing on the page, whatever the
	// platform calls it.
	for i := range videos {
		if videos[i].IsShort && videos[i].Kind == "Upload" {
			videos[i].Kind = "Short"
		}
	}
}

// fetchFacebookReels reads the page's Reels, which sit on their own graph edge
// rather than among its videos.
func (a *App) fetchFacebookReels(conn serviceConn) ([]Video, error) {
	var r struct {
		Data []struct {
			ID           string  `json:"id"`
			Title        string  `json:"title"`
			Description  string  `json:"description"`
			PermalinkURL string  `json:"permalink_url"`
			CreatedTime  string  `json:"created_time"`
			Length       float64 `json:"length"`
			Picture      string  `json:"picture"`
			Views        int64   `json:"post_views"`
		} `json:"data"`
	}
	endpoint := "/" + url.PathEscape(conn.userID) +
		"/video_reels?limit=50&fields=id,title,description,permalink_url,created_time,length,picture,post_views"
	if _, err := metaClient(conn.token).Get(endpoint, &r); err != nil {
		return nil, err
	}

	out := make([]Video, 0, len(r.Data))
	for _, v := range r.Data {
		secs := int(v.Length)
		out = append(out, Video{
			Platform:     "facebook",
			ID:           v.ID,
			Title:        firstNonEmpty(v.Title, firstLine(v.Description)),
			Description:  v.Description,
			URL:          v.PermalinkURL,
			ThumbnailURL: v.Picture,
			PublishedAt:  v.CreatedTime,
			Duration:     formatSecsCompact(secs),
			DurationSecs: secs,
			ViewCount:    v.Views,
			Kind:         "Reel",
			Status:       "public",
			ChannelName:  conn.login,
			IsShort:      true,
		})
	}
	return out, nil
}

// fetchInstagramReelViews reads one Reel's view count (instagram_manage_insights).
//
// Views are the one number Instagram keeps behind the insights permission —
// the media edge itself gives likes and comments and nothing else. The metric
// was called "plays" before Instagram renamed it to "views", and which name an
// account answers to depends on when it was migrated, so both are tried rather
// than guessing.
func fetchInstagramReelViews(conn serviceConn, mediaID string) (int64, error) {
	try := func(metric string) (int64, error) {
		var r struct {
			Data []struct {
				Name   string `json:"name"`
				Values []struct {
					Value int64 `json:"value"`
				} `json:"values"`
			} `json:"data"`
		}
		endpoint := "/" + url.PathEscape(mediaID) +
			"/insights?metric=" + metric
		if _, err := metaClient(conn.token).Get(endpoint, &r); err != nil {
			return 0, err
		}
		for _, m := range r.Data {
			if len(m.Values) > 0 {
				return m.Values[0].Value, nil
			}
		}
		return 0, fmt.Errorf("instagram returned no %s for %s", metric, mediaID)
	}

	views, err := try("views")
	if err == nil {
		return views, nil
	}
	// Older accounts still report the metric under its previous name.
	return try("plays")
}

// fetchInstagramReels reads the account's Reels. media_product_type names them
// outright, so nothing has to be inferred.
//
// Views come from a per-Reel insights call (instagram_manage_insights) — the
// media edge itself carries no view count at all. Without that permission the
// views come back unknown rather than being quietly replaced by the like count:
// a like count wearing a view count's label is worse than an honest blank.
func (a *App) fetchInstagramReels(conn serviceConn) ([]Video, error) {
	var r struct {
		Data []struct {
			ID               string `json:"id"`
			Caption          string `json:"caption"`
			MediaType        string `json:"media_type"`
			MediaProductType string `json:"media_product_type"`
			Permalink        string `json:"permalink"`
			ThumbnailURL     string `json:"thumbnail_url"`
			MediaURL         string `json:"media_url"`
			Timestamp        string `json:"timestamp"`
			LikeCount        int64  `json:"like_count"`
		} `json:"data"`
	}
	endpoint := "/" + url.PathEscape(conn.userID) +
		"/media?limit=50&fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count"
	if _, err := metaClient(conn.token).Get(endpoint, &r); err != nil {
		return nil, err
	}

	out := make([]Video, 0, len(r.Data))
	for _, m := range r.Data {
		if !strings.EqualFold(m.MediaProductType, "REELS") {
			continue
		}
		out = append(out, Video{
			Platform:     "instagram",
			ID:           m.ID,
			Title:        firstLine(m.Caption),
			Description:  m.Caption,
			URL:          m.Permalink,
			ThumbnailURL: firstNonEmpty(m.ThumbnailURL, m.MediaURL),
			PublishedAt:  m.Timestamp,
			Kind:         "Reel",
			Status:       "public",
			ChannelName:  conn.account,
			IsShort:      true,
		})
	}

	// Views are one call per Reel — Instagram has no batch view count — so they
	// are fetched in parallel, gently. A Reel whose insights call fails keeps a
	// view count of zero, which the UI shows as unknown rather than as "no
	// views": the two are not the same claim.
	var (
		wg      sync.WaitGroup
		limiter = make(chan struct{}, 6)
		failed  atomic.Int64
	)
	for i := range out {
		wg.Add(1)
		go func(v *Video) {
			defer wg.Done()
			limiter <- struct{}{}
			defer func() { <-limiter }()

			views, err := fetchInstagramReelViews(conn, v.ID)
			if err != nil {
				failed.Add(1)
				return
			}
			v.ViewCount = views
		}(&out[i])
	}
	wg.Wait()

	if n := failed.Load(); n > 0 {
		log.Printf("jax: instagram views unavailable for %d of %d reels (instagram_manage_insights not granted? reconnect Facebook)",
			n, len(out))
	}
	return out, nil
}

// firstLine reduces a caption to something that reads as a title.
func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = s[:i]
	}
	if len([]rune(s)) > 100 {
		s = string([]rune(s)[:100]) + "…"
	}
	return s
}

// formatSecsCompact renders a duration the way the platform fetches do.
func formatSecsCompact(secs int) string {
	if secs <= 0 {
		return ""
	}
	if secs < 60 {
		return fmt.Sprintf("%ds", secs)
	}
	return fmt.Sprintf("%dm%ds", secs/60, secs%60)
}

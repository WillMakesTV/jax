package main

import (
	"fmt"
	"log"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Past streams
//
// A "stream" is broadcast to several platforms at once under the same title,
// so past broadcasts fetched from Twitch (archive VODs) and YouTube (completed
// live broadcasts) are aggregated by title into one PastStream that references
// each channel's copy.
// ---------------------------------------------------------------------------

// PastBroadcast is one platform's copy of a finished stream.
type PastBroadcast struct {
	Platform     string `json:"platform"` // "twitch" | "youtube"
	Title        string `json:"title"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl"`
	StartedAt    string `json:"startedAt"` // RFC3339
	Duration     string `json:"duration"`  // human-readable, e.g. "3h8m33s"
	DurationSecs int    `json:"durationSecs"`
	ViewCount    int    `json:"viewCount"`
}

// PastStream is a finished stream aggregated across platforms.
type PastStream struct {
	Title        string `json:"title"`
	ThumbnailURL string `json:"thumbnailUrl"`
	StartedAt    string `json:"startedAt"` // most recent broadcast start
	TotalViews   int    `json:"totalViews"`
	// GroupID is set when the stream was grouped manually (Settings-proof
	// escape hatch for when timing-based matching misses); empty otherwise.
	GroupID    string          `json:"groupId"`
	Broadcasts []PastBroadcast `json:"broadcasts"`
}

// broadcastKey is the stable identity of one platform's broadcast, used to
// persist manual group assignments across refetches.
func broadcastKey(b PastBroadcast) string {
	return b.Platform + "|" + b.URL
}

// GetPastStreams returns recent past broadcasts from every connected platform,
// aggregated by timing. The platform fetches are not real-time data, so they
// are cached for apiCacheTTL (see cache.go); forceRefresh bypasses the cache.
// Manual grouping is applied fresh on every call, so group/ungroup operations
// stay instant. Never returns nil; platform failures degrade to the platforms
// that did respond.
func (a *App) GetPastStreams(forceRefresh bool) []PastStream {
	fetchAll := func() ([]PastBroadcast, error) {
		var (
			wg        sync.WaitGroup
			mu        sync.Mutex
			all       []PastBroadcast
			attempted int
		)
		fetch := func(name string, f func(serviceConn) ([]PastBroadcast, error)) {
			conn, ok := a.freshConn(name)
			if !ok {
				return
			}
			attempted++
			wg.Add(1)
			go func() {
				defer wg.Done()
				items, err := f(conn)
				if err != nil {
					log.Printf("jax: %s past broadcasts: %v", name, err)
					return
				}
				mu.Lock()
				all = append(all, items...)
				mu.Unlock()
			}()
		}
		fetch("twitch", fetchTwitchArchives)
		fetch("youtube", fetchYouTubeCompleted)
		wg.Wait()

		if attempted == 0 {
			return nil, fmt.Errorf("no services connected")
		}
		return all, nil
	}

	all, _, _, err := cachedJSON(a, a.connsCacheKey("past_broadcasts"), apiCacheTTL, forceRefresh, fetchAll)
	if err != nil {
		log.Printf("jax: GetPastStreams: %v", err)
		return []PastStream{}
	}

	// Manual group assignments take precedence; the rest cluster by timing.
	groups := map[string]int64{}
	if a.store != nil {
		g, err := a.store.getStreamGroups()
		if err != nil {
			log.Printf("jax: load stream groups: %v", err)
		} else {
			groups = g
		}
	}
	manual := map[int64][]PastBroadcast{}
	rest := []PastBroadcast{}
	for _, b := range all {
		if gid, ok := groups[broadcastKey(b)]; ok {
			manual[gid] = append(manual[gid], b)
		} else {
			rest = append(rest, b)
		}
	}

	out := aggregatePastStreams(rest, a.pastMatchMargin())
	for gid, items := range manual {
		ps := buildPastStream(items)
		ps.GroupID = strconv.FormatInt(gid, 10)
		out = append(out, ps)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// GroupPastStreams manually groups the given broadcasts (broadcastKey format,
// "platform|url") into one stream, merging any groups they already belong to.
func (a *App) GroupPastStreams(keys []string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	return a.store.groupBroadcasts(keys)
}

// UngroupPastStreams dissolves a manual group; its broadcasts fall back to
// time-based aggregation.
func (a *App) UngroupPastStreams(groupID string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	gid, err := strconv.ParseInt(groupID, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid group id %q", groupID)
	}
	return a.store.ungroupBroadcasts(gid)
}

// keyStreamMatchMargin is the settings key holding the cross-platform stream
// matching margin, in minutes. Managed from Settings → Streams.
const keyStreamMatchMargin = "stream_match_margin_min"

// defaultMatchMargin is used when the margin has never been configured.
const defaultMatchMargin = 5 * time.Minute

// pastMatchMargin returns the configured margin of error for deciding whether
// two broadcasts belong to the same stream.
func (a *App) pastMatchMargin() time.Duration {
	if a.store == nil {
		return defaultMatchMargin
	}
	v, err := a.store.getSetting(keyStreamMatchMargin)
	if err != nil || v == "" {
		return defaultMatchMargin
	}
	mins, err := strconv.ParseFloat(v, 64)
	if err != nil || mins <= 0 {
		return defaultMatchMargin
	}
	return time.Duration(mins * float64(time.Minute))
}

// aggregatePastStreams groups broadcasts that were part of the same simulcast.
// Titles differ across platforms (e.g. a "🔴 LIVE:" prefix on YouTube), so
// matching is by timing instead: two broadcasts belong to the same stream when
// their go-live times are within the margin and, when both are known, their
// durations agree within the same margin.
func aggregatePastStreams(items []PastBroadcast, margin time.Duration) []PastStream {
	// Cluster in chronological order so each broadcast joins the earliest
	// compatible group deterministically.
	sort.Slice(items, func(i, j int) bool { return items[i].StartedAt < items[j].StartedAt })

	type group struct {
		start time.Time // anchor go-live time (first broadcast in the group)
		dur   int       // anchor duration in seconds; 0 when unknown
		items []PastBroadcast
	}
	var groups []*group

	for _, b := range items {
		start, timeErr := time.Parse(time.RFC3339, b.StartedAt)

		var g *group
		if timeErr == nil {
			for _, cand := range groups {
				if cand.start.IsZero() {
					continue
				}
				dt := start.Sub(cand.start)
				if dt < 0 {
					dt = -dt
				}
				if dt > margin {
					continue
				}
				// Durations are approximate (platforms trim differently), so
				// they only need to agree within the same margin.
				if b.DurationSecs > 0 && cand.dur > 0 {
					dd := b.DurationSecs - cand.dur
					if dd < 0 {
						dd = -dd
					}
					if time.Duration(dd)*time.Second > margin {
						continue
					}
				}
				g = cand
				break
			}
		}
		if g == nil {
			g = &group{}
			if timeErr == nil {
				g.start = start
			}
			groups = append(groups, g)
		}
		if g.dur == 0 {
			g.dur = b.DurationSecs
		}
		g.items = append(g.items, b)
	}

	out := make([]PastStream, 0, len(groups))
	for _, g := range groups {
		out = append(out, buildPastStream(g.items))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// buildPastStream finalises one aggregated stream from its broadcasts.
func buildPastStream(items []PastBroadcast) PastStream {
	ps := PastStream{}
	for _, b := range items {
		ps.Broadcasts = append(ps.Broadcasts, b)
		ps.TotalViews += b.ViewCount
		if b.StartedAt > ps.StartedAt {
			ps.StartedAt = b.StartedAt
		}
		if ps.ThumbnailURL == "" && b.ThumbnailURL != "" {
			ps.ThumbnailURL = b.ThumbnailURL
		}
	}
	ps.Title = pickStreamTitle(ps.Broadcasts)
	sort.Slice(ps.Broadcasts, func(i, j int) bool {
		return ps.Broadcasts[i].Platform < ps.Broadcasts[j].Platform
	})
	return ps
}

// pickStreamTitle chooses the display title for an aggregated stream. Twitch
// titles are preferred — YouTube live titles tend to carry decorations like a
// "🔴 LIVE:" prefix — falling back to the first non-empty title.
func pickStreamTitle(broadcasts []PastBroadcast) string {
	for _, b := range broadcasts {
		if b.Platform == "twitch" && strings.TrimSpace(b.Title) != "" {
			return strings.TrimSpace(b.Title)
		}
	}
	for _, b := range broadcasts {
		if strings.TrimSpace(b.Title) != "" {
			return strings.TrimSpace(b.Title)
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Twitch — archive VODs
// ---------------------------------------------------------------------------

const twitchVideosURL = "https://api.twitch.tv/helix/videos"

func fetchTwitchArchives(conn serviceConn) ([]PastBroadcast, error) {
	if conn.userID == "" {
		return nil, fmt.Errorf("missing broadcaster id")
	}
	headers := twitchHeaders(conn)

	// Twitch creates the archive VOD while the stream is still running, which
	// would duplicate the live card as a "past" stream. Find the current live
	// stream id (if any) so its in-progress VOD can be excluded.
	liveStreamID := ""
	var liveResp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if _, err := getJSON(twitchStreamsURL+"?user_id="+conn.userID, headers, &liveResp); err == nil && len(liveResp.Data) > 0 {
		liveStreamID = liveResp.Data[0].ID
	}

	var resp struct {
		Data []struct {
			Title        string `json:"title"`
			URL          string `json:"url"`
			StreamID     string `json:"stream_id"`
			ThumbnailURL string `json:"thumbnail_url"`
			CreatedAt    string `json:"created_at"`
			Duration     string `json:"duration"`
			ViewCount    int    `json:"view_count"`
		} `json:"data"`
	}
	endpoint := twitchVideosURL + "?user_id=" + conn.userID + "&type=archive&first=20"
	if _, err := getJSON(endpoint, headers, &resp); err != nil {
		return nil, err
	}

	out := make([]PastBroadcast, 0, len(resp.Data))
	for _, v := range resp.Data {
		if liveStreamID != "" && v.StreamID == liveStreamID {
			continue // the broadcast is still live; it belongs on the live card
		}
		// Thumbnails are size templates; freshly finished VODs may have none.
		thumb := ""
		if v.ThumbnailURL != "" {
			thumb = strings.NewReplacer(
				"%{width}", "640", "%{height}", "360",
			).Replace(v.ThumbnailURL)
		}
		out = append(out, PastBroadcast{
			Platform:     "twitch",
			Title:        v.Title,
			URL:          v.URL,
			ThumbnailURL: thumb,
			StartedAt:    v.CreatedAt,
			Duration:     v.Duration, // already "3h8m33s" style
			DurationSecs: parseCompactDuration(v.Duration),
			ViewCount:    v.ViewCount,
		})
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// YouTube — completed live broadcasts
// ---------------------------------------------------------------------------

const (
	// broadcastStatus is a filter and must not be combined with mine=; it
	// already scopes to the authenticated user. broadcastType=all includes
	// default-stream-key (persistent) broadcasts.
	youtubeCompletedURL = "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet&broadcastStatus=completed&broadcastType=all&maxResults=20"
	youtubeVideoMetaURL = "https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id="
)

func fetchYouTubeCompleted(conn serviceConn) ([]PastBroadcast, error) {
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	var broadcasts struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title           string `json:"title"`
				ActualStartTime string `json:"actualStartTime"`
				Thumbnails      struct {
					Medium struct {
						URL string `json:"url"`
					} `json:"medium"`
					High struct {
						URL string `json:"url"`
					} `json:"high"`
				} `json:"thumbnails"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if _, err := getJSON(youtubeCompletedURL, headers, &broadcasts); err != nil {
		return nil, err
	}
	if len(broadcasts.Items) == 0 {
		return nil, nil
	}

	// Enrich with view counts and durations in one videos.list call.
	ids := make([]string, 0, len(broadcasts.Items))
	for _, b := range broadcasts.Items {
		ids = append(ids, b.ID)
	}
	type videoMeta struct {
		views    int
		duration string
		secs     int
	}
	meta := map[string]videoMeta{}
	var videos struct {
		Items []struct {
			ID         string `json:"id"`
			Statistics struct {
				ViewCount string `json:"viewCount"`
			} `json:"statistics"`
			ContentDetails struct {
				Duration string `json:"duration"` // ISO 8601, e.g. "PT3H8M33S"
			} `json:"contentDetails"`
		} `json:"items"`
	}
	if _, err := getJSON(youtubeVideoMetaURL+strings.Join(ids, ","), headers, &videos); err == nil {
		for _, v := range videos.Items {
			compact := formatISODuration(v.ContentDetails.Duration)
			meta[v.ID] = videoMeta{
				views:    int(atoi64(v.Statistics.ViewCount)),
				duration: compact,
				secs:     parseCompactDuration(compact),
			}
		}
	}

	out := make([]PastBroadcast, 0, len(broadcasts.Items))
	for _, b := range broadcasts.Items {
		m := meta[b.ID]
		out = append(out, PastBroadcast{
			Platform: "youtube",
			Title:    b.Snippet.Title,
			URL:      "https://youtube.com/watch?v=" + b.ID,
			ThumbnailURL: firstNonEmpty(
				b.Snippet.Thumbnails.High.URL,
				b.Snippet.Thumbnails.Medium.URL,
			),
			StartedAt:    b.Snippet.ActualStartTime,
			Duration:     m.duration,
			DurationSecs: m.secs,
			ViewCount:    m.views,
		})
	}
	return out, nil
}

var (
	isoDurationRe     = regexp.MustCompile(`^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$`)
	compactDurationRe = regexp.MustCompile(`^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$`)
)

// parseCompactDuration converts a "3h8m33s" style duration to seconds,
// returning 0 when the string is empty or unrecognised.
func parseCompactDuration(s string) int {
	m := compactDurationRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0
	}
	part := func(v string) int {
		n, _ := strconv.Atoi(v)
		return n
	}
	return part(m[1])*3600 + part(m[2])*60 + part(m[3])
}

// formatISODuration converts an ISO 8601 duration ("PT3H8M33S") to the compact
// "3h8m33s" style Twitch uses, so both platforms read the same in the UI.
func formatISODuration(iso string) string {
	m := isoDurationRe.FindStringSubmatch(iso)
	if m == nil {
		return ""
	}
	var b strings.Builder
	if m[1] != "" {
		b.WriteString(m[1] + "h")
	}
	if m[2] != "" {
		b.WriteString(m[2] + "m")
	}
	if m[3] != "" {
		b.WriteString(m[3] + "s")
	}
	return b.String()
}

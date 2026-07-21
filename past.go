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
	// Local marks a broadcast the platform no longer lists but whose
	// downloaded copy keeps it alive (see local.go).
	Local bool `json:"local"`
}

// PastStream is a finished stream aggregated across platforms.
type PastStream struct {
	Title string `json:"title"`
	// CustomTitle is the user's rename ("" when the platform title is used);
	// when set it is also what Title carries (see stream_title.go).
	CustomTitle  string `json:"customTitle"`
	ThumbnailURL string `json:"thumbnailUrl"`
	StartedAt    string `json:"startedAt"` // most recent broadcast start
	TotalViews   int    `json:"totalViews"`
	// GroupID is set when the stream was grouped manually (Settings-proof
	// escape hatch for when timing-based matching misses); empty otherwise.
	GroupID string `json:"groupId"`
	// SeriesID links this past stream to a ContentSeries (assigned by the user).
	SeriesID string `json:"seriesId"`
	// Episode data, set when the stream's series is episodic (see episodes.go;
	// number 0 = the stream is not part of an episodic series).
	EpisodeNumber      int             `json:"episodeNumber"`
	EpisodeDescription string          `json:"episodeDescription"`
	// Description is the stream's effective description: the user's custom
	// text when set, otherwise the concluded plan's (see stream_desc.go).
	Description string `json:"description"`
	// DescriptionPushed is the description last written onto the stream's
	// YouTube VOD ("" when never pushed; see youtube_desc.go). When it
	// differs from Description, YouTube is showing older text.
	DescriptionPushed string `json:"descriptionPushed"`
	// Local is true when every broadcast of the stream is local-only: the
	// downloaded copy is the last one and the stream can be deleted for good.
	Local      bool            `json:"local"`
	Broadcasts []PastBroadcast `json:"broadcasts"`
	// Plan is the concluded plan's snapshot (description, tags, channels)
	// when this stream was broadcast from a plan (see conclude.go).
	Plan *StreamPlanInfo `json:"plan"`
	// CustomThumb is the stream's generated/uploaded thumbnail, when one has
	// been assigned; it overrides ThumbnailURL (see stream_thumbs.go).
	CustomThumb *StreamThumbInfo `json:"customThumb"`
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
		fetch("kick", fetchKickVODs)
		fetch("facebook", a.fetchFacebookPastLives)
		wg.Wait()

		if attempted == 0 {
			return nil, fmt.Errorf("no services connected")
		}
		return all, nil
	}

	all, _, _, err := cachedJSON(a, a.connsCacheKey("past_broadcasts"), apiCacheTTL, forceRefresh, fetchAll)
	if err != nil {
		// Platform fetches failing (or no services connected) still leaves the
		// locally retained broadcasts to show.
		log.Printf("jax: GetPastStreams: %v", err)
		all = nil
	}

	// Downloaded broadcasts outlive the platforms: snapshot the ones still
	// listed, resurrect the ones that are gone (see local.go).
	all = a.mergeLocalBroadcasts(all)

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

	// Apply user-assigned content series (keyed by any of the stream's
	// broadcasts).
	seriesByKey := a.pastStreamSeries()
	if len(seriesByKey) > 0 {
		for i := range out {
			for _, b := range out[i].Broadcasts {
				if sid := seriesByKey[broadcastKey(b)]; sid != "" {
					out[i].SeriesID = sid
					break
				}
			}
		}
	}

	// Concluded plan snapshots attach the same way series do (keyed by any of
	// the stream's broadcasts).
	plansByKey := a.streamPlans()
	if len(plansByKey) > 0 {
		for i := range out {
			for _, b := range out[i].Broadcasts {
				if p, ok := plansByKey[broadcastKey(b)]; ok {
					p := p
					out[i].Plan = &p
					break
				}
			}
		}
	}

	// Assignments made while the stream was live migrate onto its finished
	// broadcasts once the VODs appear.
	a.adoptLiveAssignments(out)

	// Episode numbers ride in from the planned broadcast (adopted above) or
	// the user's edit on the stream's page (see episodes.go).
	a.applyStreamEpisodes(out)

	// The plan snapshot's thumbnail resolves to its served address, so the
	// stream's page can show and revise the plan's own image (see
	// stream_thumbs.go).
	a.fillPlanThumbURLs(out)

	// A concluded plan's thumbnail becomes the stream's custom thumbnail
	// when it has none of its own (see stream_thumbs.go).
	a.adoptPlanThumbs(out)

	// Custom (generated or uploaded) thumbnails override the platform ones
	// (see stream_thumbs.go).
	a.applyStreamThumbs(out)

	// Effective descriptions: custom text, else the concluded plan's (see
	// stream_desc.go).
	a.applyStreamDescriptions(out)

	// Renamed streams show their custom title instead of the platform one
	// (see stream_title.go).
	a.applyStreamTitles(out)

	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// keyPastStreamSeries stores the broadcastKey -> content series id assignments.
const keyPastStreamSeries = "past_stream_series"

// liveKeyPrefix marks series/episode assignments made while the stream was
// still on the air, keyed by its go-live time ("live|<RFC3339>") — the VOD
// urls that normally identify a stream don't exist yet. Once the finished
// stream shows up, adoptLiveAssignments copies them onto its broadcast keys.
const liveKeyPrefix = "live|"

// liveMetaKey builds the assignment key for a running broadcast.
func liveMetaKey(startedAt string) string {
	return liveKeyPrefix + startedAt
}

// parseLiveKey extracts the go-live time from a live assignment key.
func parseLiveKey(key string) (time.Time, bool) {
	raw, ok := strings.CutPrefix(key, liveKeyPrefix)
	if !ok {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// LiveStreamMeta is the planning metadata attached to the running broadcast:
// its content series and, for episodic series, its episode slot.
type LiveStreamMeta struct {
	SeriesID           string `json:"seriesId"`
	EpisodeNumber      int    `json:"episodeNumber"`
	EpisodeDescription string `json:"episodeDescription"`
}

// GetLiveStreamMeta returns the series/episode assigned to the broadcast that
// went live at startedAt (RFC3339), matched against each assignment's stream
// session (the platform-reported go-live can trail the plan's apply moment by
// more than the aggregation margin — see liveKeyMatcher).
func (a *App) GetLiveStreamMeta(startedAt string) LiveStreamMeta {
	var meta LiveStreamMeta
	target, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return meta
	}
	matcher := a.liveKeyMatcher()
	within := func(key string) bool {
		return matcher(key, target)
	}

	for key, sid := range a.pastStreamSeries() {
		if within(key) {
			meta.SeriesID = sid
			break
		}
	}
	for key, e := range a.streamEpisodes() {
		if within(key) {
			meta.EpisodeNumber = e.Number
			meta.EpisodeDescription = e.Description
			break
		}
	}
	return meta
}

// liveAssignmentMaxAge is how long unmatched live assignments are kept; past
// it they are considered orphaned (the VOD never appeared) and pruned.
const liveAssignmentMaxAge = 48 * time.Hour

// liveKeyMatcher returns a predicate deciding whether a broadcast that went
// on the air at `at` belongs to the given live assignment key. A live key is
// stamped the moment its plan is applied, but the broadcast itself may start
// minutes later — countdown scenes and delays in the Start routine run in
// between — which used to push the platform-reported go-live time outside
// the instant-plus-margin match and leave the past stream with a series and
// episode separate from its plan's. The match therefore covers the whole
// stream session the key opened: whatever went live while that session was
// open belongs to that plan.
func (a *App) liveKeyMatcher() func(key string, at time.Time) bool {
	margin := a.pastMatchMargin()

	// Each session's end, keyed by its start (the same RFC3339 string the
	// live key carries). An open session's window reaches "now", capped at
	// sessionMaxLength like the rest of the session machinery.
	ends := map[string]time.Time{}
	if a.store != nil {
		windows, err := a.store.streamSessionWindows()
		if err != nil {
			log.Printf("jax: session windows: %v", err)
		}
		for _, w := range windows {
			start, err := time.Parse(time.RFC3339, w[0])
			if err != nil {
				continue
			}
			end := start.Add(sessionMaxLength)
			if w[1] != "" {
				if t, err := time.Parse(time.RFC3339, w[1]); err == nil && t.Before(end) {
					end = t
				}
			} else if now := time.Now(); now.Before(end) {
				end = now
			}
			ends[w[0]] = end
		}
	}

	return func(key string, at time.Time) bool {
		t, ok := parseLiveKey(key)
		if !ok {
			return false
		}
		hi := t.Add(margin)
		if end, ok := ends[strings.TrimPrefix(key, liveKeyPrefix)]; ok {
			if h := end.Add(margin); h.After(hi) {
				hi = h
			}
		}
		return !at.Before(t.Add(-margin)) && !at.After(hi)
	}
}

// adoptLiveAssignments copies series/episode assignments made during a live
// broadcast onto the finished stream's broadcast keys, matched by the
// session window the assignment's go-live opened. Live keys stay until they
// age out — the stream may still be running (Twitch exposes in-progress
// archives) and the live page reads them.
func (a *App) adoptLiveAssignments(out []PastStream) {
	if a.store == nil {
		return
	}
	matcher := a.liveKeyMatcher()
	match := func(key string, s *PastStream) bool {
		for _, b := range s.Broadcasts {
			if t, err := time.Parse(time.RFC3339, b.StartedAt); err == nil && matcher(key, t) {
				return true
			}
		}
		return false
	}
	prune := func(key string) bool {
		t, ok := parseLiveKey(key)
		return ok && time.Since(t) > liveAssignmentMaxAge
	}

	series := a.pastStreamSeries()
	changed := false
	for key, sid := range series {
		if _, ok := parseLiveKey(key); !ok {
			continue
		}
		for i := range out {
			if out[i].SeriesID == "" && match(key, &out[i]) {
				out[i].SeriesID = sid
				for _, b := range out[i].Broadcasts {
					series[broadcastKey(b)] = sid
				}
				changed = true
				break
			}
		}
		if prune(key) {
			delete(series, key)
			changed = true
		}
	}
	if changed {
		if err := a.store.setJSON(keyPastStreamSeries, series); err != nil {
			log.Printf("jax: adopt live series: %v", err)
		}
	}

	// Concluded plan snapshots migrate onto the finished broadcasts the same
	// way, so the plan's description and custom data stay on the stream.
	plans := a.streamPlans()
	changed = false
	for key, p := range plans {
		if _, ok := parseLiveKey(key); !ok {
			continue
		}
		for i := range out {
			if out[i].Plan == nil && match(key, &out[i]) {
				p := p
				out[i].Plan = &p
				for _, b := range out[i].Broadcasts {
					plans[broadcastKey(b)] = p
				}
				changed = true
				break
			}
		}
		if prune(key) {
			delete(plans, key)
			changed = true
		}
	}
	if changed {
		if err := a.store.setJSON(keyStreamPlans, plans); err != nil {
			log.Printf("jax: adopt live plans: %v", err)
		}
	}

	episodes := a.streamEpisodes()
	changed = false
	for key, e := range episodes {
		if _, ok := parseLiveKey(key); !ok {
			continue
		}
		for i := range out {
			if !match(key, &out[i]) {
				continue
			}
			has := false
			for _, b := range out[i].Broadcasts {
				if _, ok := episodes[broadcastKey(b)]; ok {
					has = true
					break
				}
			}
			if !has {
				for _, b := range out[i].Broadcasts {
					episodes[broadcastKey(b)] = e
				}
				changed = true
			}
			break
		}
		if prune(key) {
			delete(episodes, key)
			changed = true
		}
	}
	if changed {
		if err := a.store.setJSON(keyStreamEpisodes, episodes); err != nil {
			log.Printf("jax: adopt live episodes: %v", err)
		}
	}
}

// pastStreamSeries loads the saved broadcastKey -> seriesID map. Never nil.
func (a *App) pastStreamSeries() map[string]string {
	m := map[string]string{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyPastStreamSeries, &m); err != nil {
			log.Printf("jax: load past stream series: %v", err)
		}
	}
	if m == nil {
		return map[string]string{}
	}
	return m
}

// SetPastStreamSeries assigns a content series to the past stream identified by
// its broadcast keys ("platform|url"), or clears it when seriesID is empty.
func (a *App) SetPastStreamSeries(keys []string, seriesID string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	m := a.pastStreamSeries()
	for _, k := range keys {
		if seriesID == "" {
			delete(m, k)
		} else {
			m[k] = seriesID
		}
	}
	if err := a.store.setJSON(keyPastStreamSeries, m); err != nil {
		return err
	}
	// A stream's series carries the season a video plan cut from it is filed
	// under, so re-file any workspace this moves (see relocateEditWorkspaces).
	go a.relocateEditWorkspaces()
	return nil
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
	ps := PastStream{Local: len(items) > 0}
	for _, b := range items {
		if !b.Local {
			ps.Local = false
		}
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

func fetchTwitchArchives(conn serviceConn) ([]PastBroadcast, error) {
	if conn.userID == "" {
		return nil, fmt.Errorf("missing broadcaster id")
	}
	client := twitchClient(conn)

	// Twitch creates the archive VOD while the stream is still running, which
	// would duplicate the live card as a "past" stream. Find the current live
	// stream id (if any) so its in-progress VOD can be excluded.
	liveStreamID, _ := client.LiveStreamID()

	archives, err := client.Archives(20)
	if err != nil {
		return nil, err
	}

	out := make([]PastBroadcast, 0, len(archives))
	for _, v := range archives {
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

func fetchYouTubeCompleted(conn serviceConn) ([]PastBroadcast, error) {
	client := youtubeClient(conn)

	items, err := client.CompletedBroadcasts()
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}

	// Enrich with view counts and durations in one videos.list call.
	ids := make([]string, 0, len(items))
	for _, b := range items {
		ids = append(ids, b.ID)
	}
	type videoMeta struct {
		views    int
		duration string
		secs     int
	}
	meta := map[string]videoMeta{}
	if found, err := client.VideoMetaByIDs(ids); err == nil {
		for _, v := range found {
			compact := formatISODuration(v.ContentDetails.Duration)
			meta[v.ID] = videoMeta{
				views:    int(atoi64(v.Statistics.ViewCount)),
				duration: compact,
				secs:     parseCompactDuration(compact),
			}
		}
	}

	out := make([]PastBroadcast, 0, len(items))
	for _, b := range items {
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

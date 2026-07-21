package main

import (
	"bp-temp/internal/httpx"
	"bp-temp/internal/platforms/youtube"
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Stream planning
//
// A PlannedStream is a lightweight outline of an upcoming broadcast: a title,
// a description, and the connected channels it should go out to. Plans are
// stored as a single JSON blob in the settings table.
// ---------------------------------------------------------------------------

// PlannedStream is one planned/upcoming broadcast.
type PlannedStream struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Channels are platform ids the stream should broadcast to ("twitch",
	// "youtube").
	Channels []string `json:"channels"`
	// SeriesID optionally links the plan to a ContentSeries for shared
	// context; the series' type (episodic or not) is inferred from it.
	SeriesID string `json:"seriesId"`
	// EpisodeNumber slots the plan into an episodic series' sequence; plans
	// for such a series prefill the next number (see episodes.go). 0 = none.
	EpisodeNumber int `json:"episodeNumber"`
	// Tags for this stream; when empty the linked series' tags apply instead.
	Tags []string `json:"tags"`
	// ThumbnailFile names the plan's thumbnail image in ~/.jax/plan_thumbs
	// ("" = none); see plan_thumbs.go. ThumbnailURL is the served address,
	// recomputed on every read (the media server's port changes per launch).
	ThumbnailFile string `json:"thumbnailFile"`
	ThumbnailURL  string `json:"thumbnailUrl"`
	// ThumbnailHistory lists the plan's previous thumbnails (newest first,
	// capped) so an earlier version can be restored; maintained server-side
	// on save, with URLs recomputed on read like ThumbnailURL.
	ThumbnailHistory     []string `json:"thumbnailHistory"`
	ThumbnailHistoryURLs []string `json:"thumbnailHistoryUrls"`
	CreatedAt            string   `json:"createdAt"` // RFC3339
}

// GetPlannedStreams returns the saved stream plans, newest first. Never nil.
func (a *App) GetPlannedStreams() []PlannedStream {
	if a.store == nil {
		return []PlannedStream{}
	}
	var plans []PlannedStream
	if _, err := a.store.getJSON(keyPlannedStreams, &plans); err != nil {
		log.Printf("jax: GetPlannedStreams: %v", err)
	}
	if plans == nil {
		return []PlannedStream{}
	}
	for i := range plans {
		plans[i].ThumbnailURL = a.planThumbURL(plans[i].ThumbnailFile)
		plans[i].ThumbnailHistoryURLs = a.planThumbHistoryURLs(plans[i].ThumbnailHistory)
	}
	return plans
}

// SavePlannedStream upserts a plan (matched by ID), assigning an ID and
// creation time on first save, and returns the stored value.
func (a *App) SavePlannedStream(plan PlannedStream) (PlannedStream, error) {
	if a.store == nil {
		return plan, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(plan.Title) == "" {
		return plan, fmt.Errorf("a title is required")
	}
	if plan.Channels == nil {
		plan.Channels = []string{}
	}
	if plan.Tags == nil {
		plan.Tags = []string{}
	}
	// The thumbnail is stored as a bare file name in the plan-thumbs folder;
	// the URL is derived per launch, never persisted. The history is
	// authoritative server-side: it is recomputed from the stored plan on
	// every save (callers cannot inject entries), folding a replaced
	// thumbnail in as the newest entry.
	plan.ThumbnailFile = sanitizeThumbFile(plan.ThumbnailFile)
	plan.ThumbnailURL = ""
	plan.ThumbnailHistory = []string{}
	plan.ThumbnailHistoryURLs = nil

	plans := a.GetPlannedStreams()
	if plan.ID == "" {
		plan.ID = fmt.Sprintf("plan_%d", time.Now().UnixNano())
	}
	if plan.CreatedAt == "" {
		plan.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, p := range plans {
		if p.ID == plan.ID {
			plan.ThumbnailHistory = updateThumbHistory(
				p.ThumbnailHistory, p.ThumbnailFile, plan.ThumbnailFile,
			)
			plans[i] = plan
			replaced = true
			break
		}
	}
	if !replaced {
		// Newest first.
		plans = append([]PlannedStream{plan}, plans...)
	}

	if err := a.store.setJSON(keyPlannedStreams, plans); err != nil {
		return plan, err
	}
	plan.ThumbnailURL = a.planThumbURL(plan.ThumbnailFile)
	plan.ThumbnailHistoryURLs = a.planThumbHistoryURLs(plan.ThumbnailHistory)
	return plan, nil
}

// sanitizeThumbFile reduces a thumbnail reference to a bare file name so a
// stored plan (also writable over MCP) can never point outside the
// plan-thumbs folder.
func sanitizeThumbFile(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	base := filepath.Base(filepath.FromSlash(name))
	if base == "." || base == string(filepath.Separator) {
		return ""
	}
	return base
}

// ApplyPlannedStream pushes a plan's stream information to the channels it
// targets — the plan's title plus the linked series' category and tags —
// returning human-readable warnings for anything that could not be applied.
// Wired to "Go Live with Planned Stream" on the Broadcast page: the info is
// applied first, then the frontend runs the start-stream routine. Never nil
// on success so the binding marshals an empty array rather than null.
func (a *App) ApplyPlannedStream(id string) ([]string, error) {
	plan := a.findPlannedStream(id)
	if plan == nil {
		return nil, fmt.Errorf("that plan no longer exists")
	}

	// Going live with a plan opens its stream session: the durable record the
	// stream's chat, transcript, and series/episode hang off (see
	// stream_session.go).
	a.beginPlannedSession(*plan)

	// Twitch updates its channel info directly; YouTube writes onto the
	// upcoming (default or scheduled) broadcast, so the metadata is already
	// in place when the stream starts.
	return a.applyPlanInfo(plan), nil
}

// findPlannedStream returns the saved plan with the given id, or nil.
func (a *App) findPlannedStream(id string) *PlannedStream {
	for _, p := range a.GetPlannedStreams() {
		if p.ID == id {
			p := p
			return &p
		}
	}
	return nil
}

// seriesForPlan returns the plan's linked content series, or nil.
func (a *App) seriesForPlan(plan *PlannedStream) *ContentSeries {
	if plan == nil || plan.SeriesID == "" {
		return nil
	}
	for _, s := range a.GetContentSeries() {
		if s.ID == plan.SeriesID {
			s := s
			return &s
		}
	}
	return nil
}

// defaultYouTubeLivePrefix marks YouTube broadcasts as live in their title —
// the convention past streams follow ("🔴 LIVE: Episode 6 | ..."). YouTube
// keeps the VOD's title as-is, so the marker distinguishes the live airing;
// Twitch resets titles per stream and needs no marker. Configurable via the
// youtube_live_prefix setting (see Settings → Streams).
const defaultYouTubeLivePrefix = "🔴 LIVE: "

// youtubeLivePrefix returns the configured YouTube title prefix, falling back
// to the default when unset. Mirrors loadYouTubeLivePrefix in the frontend.
func (a *App) youtubeLivePrefix() string {
	if a.store != nil {
		if v, err := a.store.getSetting(keyYouTubeLivePrefix); err == nil && strings.TrimSpace(v) != "" {
			return v
		}
	}
	return defaultYouTubeLivePrefix
}

// broadcastBaseTitle is the title a plan's broadcasts go out under: episodic
// plans are prefixed with their episode number, matching the convention of
// past streams ("Episode 6 | Building the planner"). Mirrors
// broadcastBaseTitle in the frontend.
func broadcastBaseTitle(plan PlannedStream) string {
	if plan.EpisodeNumber > 0 {
		return fmt.Sprintf("Episode %d | %s", plan.EpisodeNumber, plan.Title)
	}
	return plan.Title
}

// twitchContentLabelIDs are the user-settable Twitch Content Classification
// Labels ("MatureGame" is auto-applied by Twitch from the category's rating
// and cannot be set). Every ID is sent on update — enabled or not — so labels
// removed from the series are also cleared on the channel. The display
// catalogue lives in frontend lib/contentLabels.ts.
var twitchContentLabelIDs = []string{
	"DebatedSocialIssuesAndPolitics",
	"DrugsIntoxication",
	"Gambling",
	"ProfanityVulgarity",
	"SexualThemes",
	"ViolentGraphic",
}

// twitchTagRe strips characters Twitch rejects in tags (max 25 chars, no
// spaces or special characters).
var twitchTagRe = regexp.MustCompile(`[^\p{L}\p{N}]`)

// applyPlanToTwitch updates the Twitch channel's title, category, and tags
// from a plan ahead of going live. Returns "" on success, else a warning.
func (a *App) applyPlanToTwitch(plan PlannedStream, series *ContentSeries) string {
	conn, ok := a.freshConn("twitch")
	if !ok {
		return "Twitch is not connected — its stream info was not updated."
	}
	payload := map[string]any{"title": broadcastBaseTitle(plan)}
	if series != nil && series.TwitchCategory.ID != "" {
		payload["game_id"] = series.TwitchCategory.ID
	}
	// The plan's own tags win; the series' tags are the fallback.
	rawTags := plan.Tags
	if len(rawTags) == 0 && series != nil {
		rawTags = series.Tags
	}
	tags := []string{}
	for _, t := range rawTags {
		t = twitchTagRe.ReplaceAllString(t, "")
		if t == "" {
			continue
		}
		if len(t) > 25 {
			t = t[:25]
		}
		tags = append(tags, t)
		if len(tags) == 10 { // Twitch allows at most 10 tags.
			break
		}
	}
	if len(tags) > 0 {
		payload["tags"] = tags
	}
	if series != nil {
		// Content classification labels: the full settable set is sent —
		// enabled or not — so labels the series dropped are cleared too.
		chosen := map[string]bool{}
		for _, id := range series.TwitchLabels {
			chosen[id] = true
		}
		labels := make([]map[string]any, 0, len(twitchContentLabelIDs))
		for _, id := range twitchContentLabelIDs {
			labels = append(labels, map[string]any{"id": id, "is_enabled": chosen[id]})
		}
		payload["content_classification_labels"] = labels
	}

	status, err := twitchClient(conn).UpdateChannel(payload)
	if err != nil {
		log.Printf("jax: apply plan to twitch: %v", err)
		if status == 401 || status == 403 {
			// Updating channel info needs channel:manage:broadcast, which
			// connections made before this feature will not carry.
			return "Twitch: reconnect in Settings → Services to grant the stream-info permission."
		}
		return "Twitch: the stream info could not be updated."
	}
	// The dashboard's cached channel info now shows stale title/category.
	if a.store != nil {
		_ = a.store.deleteCacheEntry(keyTwitchChannelInfo)
	}
	return ""
}

// ApplyStreamInfo pushes the on-air planned stream's info to its channels —
// the "apply-stream-info" routine step. Twitch gets the episode-composed
// title plus the series' category, tags, and content labels; YouTube gets the
// prefixed episode title, the plan's description, and its tags written onto
// the live broadcast's video (which only exists once the stream is on the
// air, so the step belongs after the stream starts). A silent no-op when no
// planned stream is on the air. Returns human-readable warnings; never nil.
func (a *App) ApplyStreamInfo() []string {
	session := a.GetActiveStreamSession()
	if !session.Active || session.PlanID == "" {
		return []string{}
	}
	plan := a.findPlannedStream(session.PlanID)
	if plan == nil {
		return []string{"Apply stream info: the plan behind this stream no longer exists."}
	}
	return a.applyPlanInfo(plan)
}

// ApplyStreamInfoForPlan pushes a specific plan's stream info to its channels
// without opening a stream session — the Test rehearsal of the
// "apply-stream-info" routine step. Both platforms update for real: Twitch's
// channel info and YouTube's upcoming (or live) broadcast simply apply to the
// next stream. Never nil on success.
func (a *App) ApplyStreamInfoForPlan(id string) ([]string, error) {
	plan := a.findPlannedStream(id)
	if plan == nil {
		return nil, fmt.Errorf("that plan no longer exists")
	}
	return a.applyPlanInfo(plan), nil
}

// applyPlanInfo pushes a plan's stream info to every channel it targets,
// collecting human-readable warnings. Never nil.
func (a *App) applyPlanInfo(plan *PlannedStream) []string {
	series := a.seriesForPlan(plan)
	warnings := []string{}
	for _, channel := range plan.Channels {
		switch channel {
		case "twitch":
			if w := a.applyPlanToTwitch(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		case "youtube":
			if w := a.applyPlanToYouTube(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		case "kick":
			if w := a.applyPlanToKick(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		case "facebook":
			if w := a.applyPlanToFacebook(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		case "instagram":
			// Instagram's API can neither set live info nor post text
			// announcements (publishing requires publicly hosted media);
			// note it rather than silently skipping the targeted channel.
			warnings = append(warnings,
				"Instagram: the API cannot set stream info or post announcements — share the stream from the Instagram app.")
		case "x":
			if w := a.applyPlanToX(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		case "tiktok":
			if w := a.applyPlanToTikTok(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		}
	}
	return warnings
}

// applyPlanToKick updates the Kick channel's title and category from a plan.
// Returns "" on success, else a warning.
func (a *App) applyPlanToKick(plan PlannedStream, series *ContentSeries) string {
	conn, ok := a.freshConn("kick")
	if !ok {
		return "Kick is not connected — its stream info was not updated."
	}
	categoryID := ""
	if series != nil {
		categoryID = series.KickCategory.ID
	}
	title := broadcastBaseTitle(plan)
	if err := applyKickInfo(conn, title, categoryID); err != nil {
		log.Printf("jax: apply plan to kick: %v", err)
		// Surface Kick's own explanation — a silent generic message hides
		// actionable causes (missing channel:write scope, bad category id).
		return fmt.Sprintf("Kick: the stream info could not be updated (%v).", err)
	}
	// Kick doesn't report the stored title back while offline, so remember
	// exactly what was accepted for the info-status comparison.
	a.recordKickTitlePush(title)
	return ""
}

// youtubeVideosUpdateURL is the videos.update endpoint; part=snippet,status
// scopes the write to the video's metadata plus its made-for-kids
// self-declaration.
const youtubeVideosUpdateURL = "https://www.googleapis.com/youtube/v3/videos?part=snippet,status"

// youtubeUpcomingBroadcastsURL lists the channel's upcoming broadcasts: the
// scheduled events plus the dashboard's persistent broadcast (what YouTube
// Studio's offline stream settings edit). broadcastType=all is required to
// include persistent broadcasts; broadcastStatus must not be combined with
// mine= (see youtubeBroadcastsURL in live.go).
const youtubeUpcomingBroadcastsURL = "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status,contentDetails&broadcastStatus=upcoming&broadcastType=all"

// upcomingYTBroadcastID returns the id of the upcoming broadcast the next
// stream will actually become, or "" when there is none. The upcoming list
// can hold strays (e.g. a scheduled event from months ago that never aired
// and is bound to no stream key), so preference order matters:
//
//  1. the channel's legacy default broadcast;
//  2. a "ready" broadcast bound to a stream key — what the dashboard airs
//     when the encoder starts;
//  3. the soonest broadcast scheduled in the future;
//  4. whatever is first.
func (a *App) upcomingYTBroadcastID(headers map[string]string) string {
	var broadcasts struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				IsDefaultBroadcast bool   `json:"isDefaultBroadcast"`
				ScheduledStartTime string `json:"scheduledStartTime"`
			} `json:"snippet"`
			Status struct {
				LifeCycleStatus string `json:"lifeCycleStatus"`
			} `json:"status"`
			ContentDetails struct {
				BoundStreamID string `json:"boundStreamId"`
			} `json:"contentDetails"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(youtubeUpcomingBroadcastsURL, headers, &broadcasts); err != nil {
		log.Printf("jax: youtube upcoming broadcasts: %v", err)
		return ""
	}
	// RFC3339 UTC timestamps compare lexicographically.
	now := time.Now().UTC().Format(time.RFC3339)
	bound, future, futureTime, first := "", "", "", ""
	for _, b := range broadcasts.Items {
		if b.Snippet.IsDefaultBroadcast {
			return b.ID
		}
		if first == "" {
			first = b.ID
		}
		if bound == "" && b.Status.LifeCycleStatus == "ready" && b.ContentDetails.BoundStreamID != "" {
			bound = b.ID
		}
		if t := b.Snippet.ScheduledStartTime; t > now && (future == "" || t < futureTime) {
			future, futureTime = b.ID, t
		}
	}
	if bound != "" {
		return bound
	}
	if future != "" {
		return future
	}
	return first
}

// currentYTBroadcastID returns the video id carrying the channel's stream
// info right now: the live broadcast when on the air (memoised, else probed
// like fetchYouTubeLive), otherwise the upcoming broadcast the next stream
// becomes (see upcomingYTBroadcastID — what YouTube Studio edits while
// offline). "" when there is neither.
func (a *App) currentYTBroadcastID(headers map[string]string) string {
	if videoID := a.cachedYTVideoID(); videoID != "" {
		return videoID
	}
	var broadcasts struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(youtube.ActiveBroadcastURL, headers, &broadcasts); err != nil {
		log.Printf("jax: youtube active broadcasts: %v", err)
	} else if len(broadcasts.Items) > 0 {
		videoID := broadcasts.Items[0].ID
		a.setYTVideoID(videoID)
		return videoID
	}
	// Not memoised: an upcoming broadcast is not "live".
	return a.upcomingYTBroadcastID(headers)
}

// applyPlanToYouTube writes the plan's prefixed title, description, and tags
// — and the series' made-for-kids self-declaration — onto the live
// broadcast's video, or, off the air, onto the upcoming (default/scheduled)
// broadcast so the info is in place before the stream starts. Returns "" on
// success, else a warning.
func (a *App) applyPlanToYouTube(plan PlannedStream, series *ContentSeries) string {
	conn, ok := a.freshConn("youtube")
	if !ok {
		return "YouTube is not connected — its stream info was not updated."
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}
	videoID := a.currentYTBroadcastID(headers)
	if videoID == "" {
		return "YouTube: no live or upcoming broadcast to update — schedule one in YouTube Studio, or run “Apply stream info” after the stream starts."
	}

	// videos.update replaces the whole snippet/status, so read the current
	// ones and change only what the plan owns — the category, tags, language,
	// and privacy set in YouTube Studio survive.
	var videos struct {
		Items []struct {
			Snippet map[string]any `json:"snippet"`
			Status  map[string]any `json:"status"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(
		"https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id="+videoID,
		headers, &videos,
	); err != nil || len(videos.Items) == 0 {
		log.Printf("jax: apply plan to youtube: read snippet: %v", err)
		return "YouTube: the live video's details could not be read."
	}
	snippet := videos.Items[0].Snippet
	snippet["title"] = a.youtubeLivePrefix() + broadcastBaseTitle(plan)
	if strings.TrimSpace(plan.Description) != "" {
		snippet["description"] = plan.Description
	}
	// The plan's own tags win; the series' tags are the fallback. YouTube
	// caps a video's combined tag length around 500 characters, so stop
	// before tripping it. No tags leaves the video's existing ones alone.
	rawTags := plan.Tags
	if len(rawTags) == 0 && series != nil {
		rawTags = series.Tags
	}
	tags := []string{}
	budget := 470
	for _, t := range rawTags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if len(t)+1 > budget {
			break
		}
		budget -= len(t) + 1
		tags = append(tags, t)
	}
	if len(tags) > 0 {
		snippet["tags"] = tags
	}
	payload := map[string]any{"id": videoID, "snippet": snippet}
	if series != nil {
		// The made-for-kids declaration is the one content classification
		// YouTube's API accepts; declaring "not made for kids" matters too.
		vidStatus := videos.Items[0].Status
		if vidStatus == nil {
			vidStatus = map[string]any{}
		}
		vidStatus["selfDeclaredMadeForKids"] = series.YouTubeMadeForKids
		payload["status"] = vidStatus
	}

	status, err := httpx.SendJSON(http.MethodPut, youtubeVideosUpdateURL, headers,
		payload, nil)
	if err != nil {
		log.Printf("jax: apply plan to youtube: update: %v", err)
		if status == 401 || status == 403 {
			return "YouTube: reconnect in Settings → Services to grant the update permission."
		}
		return "YouTube: the stream info could not be updated."
	}
	// The plan's thumbnail rides along onto the broadcast video. (Twitch has
	// no equivalent — its live thumbnails are platform-generated.)
	return a.pushYouTubeThumbnail(headers, videoID, plan.ThumbnailFile)
}

// youtubeThumbMaxBytes is YouTube's custom-thumbnail size cap.
const youtubeThumbMaxBytes = 2 << 20

// keyPlanThumbPushes stores the videoID → thumbnail-file map of what the app
// last pushed to each broadcast video. YouTube re-encodes uploads, so the
// remote image can't be byte-compared — this record is how the info check
// knows whether the plan's current thumbnail has been pushed yet.
const keyPlanThumbPushes = "plan_thumb_pushes"

// pushedThumbs loads the videoID → last-pushed-thumbnail-file map. Never nil.
func (a *App) pushedThumbs() map[string]string {
	m := map[string]string{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyPlanThumbPushes, &m); err != nil {
			log.Printf("jax: load thumb pushes: %v", err)
		}
	}
	if m == nil {
		return map[string]string{}
	}
	return m
}

// recordThumbPush remembers which thumbnail file a broadcast video carries.
func (a *App) recordThumbPush(videoID, file string) {
	if a.store == nil {
		return
	}
	m := a.pushedThumbs()
	m[videoID] = file
	if err := a.store.setJSON(keyPlanThumbPushes, m); err != nil {
		log.Printf("jax: record thumb push: %v", err)
	}
}

// Thumbnail uploads can be ~2MB; the shared 20s client is too tight on slow
// links.
var thumbUploadHTTP = &http.Client{Timeout: 2 * time.Minute}

// pushYouTubeThumbnail sets the broadcast video's thumbnail to the plan's
// image ("" file = the plan has none; nothing pushed). Oversized images are
// re-encoded as JPEG to fit YouTube's 2MB cap. Returns a warning string on
// failure, "" on success or no-op.
func (a *App) pushYouTubeThumbnail(headers map[string]string, videoID, thumbFile string) string {
	base := sanitizeThumbFile(thumbFile)
	if base == "" {
		return ""
	}
	dir, err := planThumbsDir()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(dir, base))
	if err != nil {
		return "YouTube: the plan's thumbnail file is missing — regenerate it on the plan page."
	}
	contentType := http.DetectContentType(raw)
	if len(raw) > youtubeThumbMaxBytes {
		if jpg, ok := reencodeJPEG(raw); ok && len(jpg) <= youtubeThumbMaxBytes {
			raw, contentType = jpg, "image/jpeg"
		} else {
			return "YouTube: the thumbnail exceeds YouTube's 2 MB limit and could not be shrunk — use a smaller image."
		}
	}

	req, err := http.NewRequest(http.MethodPost,
		"https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId="+url.QueryEscape(videoID),
		bytes.NewReader(raw))
	if err != nil {
		return ""
	}
	req.Header.Set("Content-Type", contentType)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := thumbUploadHTTP.Do(req)
	if err != nil {
		log.Printf("jax: youtube thumbnail: %v", err)
		return "YouTube: the thumbnail could not be uploaded."
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		log.Printf("jax: youtube thumbnail: %d %s", resp.StatusCode, body)
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			return "YouTube: reconnect in Settings → Services to grant the thumbnail permission."
		}
		return "YouTube: the thumbnail could not be updated."
	}
	a.recordThumbPush(videoID, base)
	return ""
}

// reencodeJPEG decodes a registered image format (png, jpeg, gif) and
// re-encodes it as a quality-85 JPEG, to bring oversized thumbnails under
// platform caps.
func reencodeJPEG(raw []byte) ([]byte, bool) {
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, false
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, false
	}
	return buf.Bytes(), true
}

// PlanChannelInfo is one targeted channel's current stream info compared to
// what a plan would set, so the UI can tell whether the channel is ready to
// go live under the plan.
type PlanChannelInfo struct {
	Channel   string `json:"channel"`
	Connected bool   `json:"connected"`
	// Matches: the channel's current title equals the plan's intended one.
	Matches      bool   `json:"matches"`
	CurrentTitle string `json:"currentTitle"`
	WantTitle    string `json:"wantTitle"`
	// Detail explains an unknown state (e.g. "not connected", "no upcoming
	// broadcast"); empty when the comparison was made.
	Detail string `json:"detail,omitempty"`
	// ThumbnailStale: the plan carries a thumbnail the broadcast video does
	// not (YouTube only; compared against what the app last pushed).
	ThumbnailStale bool `json:"thumbnailStale"`
}

// GetPlanInfoStatus reports, per channel the plan targets, whether the
// channel's stream info already carries the plan's title — Twitch's channel
// info, and YouTube's live (or upcoming) broadcast, where the plan's
// thumbnail is checked too. Never nil on success.
func (a *App) GetPlanInfoStatus(id string) ([]PlanChannelInfo, error) {
	plan := a.findPlannedStream(id)
	if plan == nil {
		return nil, fmt.Errorf("that plan no longer exists")
	}
	out := []PlanChannelInfo{}
	for _, channel := range plan.Channels {
		switch channel {
		case "twitch":
			out = append(out, a.twitchInfoStatus(*plan))
		case "youtube":
			out = append(out, a.youtubeInfoStatus(*plan))
		case "kick":
			out = append(out, a.kickInfoStatus(*plan))
		case "facebook":
			out = append(out, a.facebookInfoStatus(*plan))
		case "instagram":
			out = append(out, a.instagramInfoStatus(*plan))
		case "x":
			out = append(out, a.xInfoStatus(*plan))
		case "tiktok":
			out = append(out, a.tiktokInfoStatus(*plan))
		}
	}
	return out, nil
}

// kickInfoStatus compares the Kick channel's configured stream title with the
// plan's intended one.
func (a *App) kickInfoStatus(plan PlannedStream) PlanChannelInfo {
	info := PlanChannelInfo{Channel: "kick", WantTitle: broadcastBaseTitle(plan)}
	conn, ok := a.freshConn("kick")
	if !ok {
		info.Detail = "Kick is not connected."
		return info
	}
	info.Connected = true
	ch, _, err := fetchKickChannel(conn)
	if err != nil {
		log.Printf("jax: kick info status: %v", err)
		info.Detail = "Could not read the current stream info."
		return info
	}
	info.CurrentTitle = ch.StreamTitle
	// Kick only reports stream_title while live. For an offline channel fall
	// back to the title the app last successfully pushed (recorded on apply).
	// No record — or a stale one — compares as a mismatch, so the plan page
	// prompts an update rather than treating the state as unknowable.
	if info.CurrentTitle == "" && !ch.Stream.IsLive {
		info.CurrentTitle = a.pushedKickTitle()
	}
	info.Matches = info.CurrentTitle == info.WantTitle
	return info
}

func (a *App) twitchInfoStatus(plan PlannedStream) PlanChannelInfo {
	info := PlanChannelInfo{Channel: "twitch", WantTitle: broadcastBaseTitle(plan)}
	conn, ok := a.freshConn("twitch")
	if !ok {
		info.Detail = "Twitch is not connected."
		return info
	}
	info.Connected = true
	channel, err := twitchClient(conn).ChannelInfo()
	if err != nil {
		log.Printf("jax: twitch info status: %v", err)
		info.Detail = "Could not read the current stream info."
		return info
	}
	info.CurrentTitle = channel.Title
	info.Matches = info.CurrentTitle == info.WantTitle
	return info
}

func (a *App) youtubeInfoStatus(plan PlannedStream) PlanChannelInfo {
	info := PlanChannelInfo{
		Channel:   "youtube",
		WantTitle: a.youtubeLivePrefix() + broadcastBaseTitle(plan),
	}
	conn, ok := a.freshConn("youtube")
	if !ok {
		info.Detail = "YouTube is not connected."
		return info
	}
	info.Connected = true
	headers := map[string]string{"Authorization": "Bearer " + conn.token}
	videoID := a.currentYTBroadcastID(headers)
	if videoID == "" {
		info.Detail = "No live or upcoming broadcast to check."
		return info
	}
	var videos struct {
		Items []struct {
			Snippet struct {
				Title string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(
		"https://www.googleapis.com/youtube/v3/videos?part=snippet&id="+videoID,
		headers, &videos,
	); err != nil || len(videos.Items) == 0 {
		log.Printf("jax: youtube info status: %v", err)
		info.Detail = "Could not read the current stream info."
		return info
	}
	info.CurrentTitle = videos.Items[0].Snippet.Title
	info.Matches = info.CurrentTitle == info.WantTitle
	// The thumbnail is compared against what the app last pushed to this
	// broadcast (YouTube re-encodes uploads, so the remote bytes can't be
	// compared directly): a plan thumbnail that was never pushed — or a
	// different file than the pushed one — reads as stale and re-offers
	// "Update Stream Info".
	if file := sanitizeThumbFile(plan.ThumbnailFile); file != "" {
		if a.pushedThumbs()[videoID] != file {
			info.ThumbnailStale = true
			info.Matches = false
		}
	}
	return info
}

// DeletePlannedStream removes a plan by ID.
func (a *App) DeletePlannedStream(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	plans := a.GetPlannedStreams()
	out := make([]PlannedStream, 0, len(plans))
	for _, p := range plans {
		if p.ID != id {
			out = append(out, p)
		}
	}
	return a.store.setJSON(keyPlannedStreams, out)
}

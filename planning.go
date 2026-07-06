package main

import (
	"fmt"
	"log"
	"net/http"
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
	Tags      []string `json:"tags"`
	CreatedAt string   `json:"createdAt"` // RFC3339
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
	return plan, nil
}

// ApplyPlannedStream pushes a plan's stream information to the channels it
// targets — the plan's title plus the linked series' category and tags —
// returning human-readable warnings for anything that could not be applied.
// Wired to "Go Live with Planned Stream" on the Broadcast page: the info is
// applied first, then the frontend runs the start-stream routine. Never nil
// on success so the binding marshals an empty array rather than null.
func (a *App) ApplyPlannedStream(id string) ([]string, error) {
	var plan *PlannedStream
	for _, p := range a.GetPlannedStreams() {
		if p.ID == id {
			p := p
			plan = &p
			break
		}
	}
	if plan == nil {
		return nil, fmt.Errorf("that plan no longer exists")
	}

	// The linked series carries the per-platform categories and tags.
	var series *ContentSeries
	if plan.SeriesID != "" {
		for _, s := range a.GetContentSeries() {
			if s.ID == plan.SeriesID {
				s := s
				series = &s
				break
			}
		}
	}

	// Going live with a plan opens its stream session: the durable record the
	// stream's chat, transcript, and series/episode hang off (see
	// stream_session.go).
	a.beginPlannedSession(*plan)

	warnings := []string{}
	for _, channel := range plan.Channels {
		switch channel {
		case "twitch":
			if w := a.applyPlanToTwitch(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		case "youtube":
			// YouTube's broadcast metadata is bound to the (auto-created)
			// broadcast, which does not exist until the stream is live — the
			// "Apply stream info" routine step handles it once on the air.
			warnings = append(warnings, fmt.Sprintf(
				"YouTube: its info is applied once the stream is live — add the “Apply stream info” step after the stream starts in your Start Stream routine, or set the title in YouTube Studio (suggested: “%s”).",
				a.youtubeLivePrefix()+broadcastBaseTitle(*plan),
			))
		}
	}
	return warnings, nil
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

	status, err := patchJSON(
		twitchChannelsURL+"?broadcaster_id="+conn.userID,
		twitchHeaders(conn), payload,
	)
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
// title plus the series' category and tags; YouTube gets the prefixed title
// and the plan's description written onto the live broadcast's video (which
// only exists once the stream is on the air, so the step belongs after the
// stream starts). A silent no-op when no planned stream is on the air.
// Returns human-readable warnings; never nil.
func (a *App) ApplyStreamInfo() []string {
	session := a.GetActiveStreamSession()
	if !session.Active || session.PlanID == "" {
		return []string{}
	}
	var plan *PlannedStream
	for _, p := range a.GetPlannedStreams() {
		if p.ID == session.PlanID {
			p := p
			plan = &p
			break
		}
	}
	if plan == nil {
		return []string{"Apply stream info: the plan behind this stream no longer exists."}
	}

	var series *ContentSeries
	if plan.SeriesID != "" {
		for _, s := range a.GetContentSeries() {
			if s.ID == plan.SeriesID {
				s := s
				series = &s
				break
			}
		}
	}

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
		}
	}
	return warnings
}

// youtubeVideosUpdateURL is the videos.update endpoint; part=snippet,status
// scopes the write to the video's metadata plus its made-for-kids
// self-declaration.
const youtubeVideosUpdateURL = "https://www.googleapis.com/youtube/v3/videos?part=snippet,status"

// applyPlanToYouTube writes the plan's prefixed title and description — and
// the series' made-for-kids self-declaration — onto the active live
// broadcast's video. Returns "" on success, else a warning.
func (a *App) applyPlanToYouTube(plan PlannedStream, series *ContentSeries) string {
	conn, ok := a.freshConn("youtube")
	if !ok {
		return "YouTube is not connected — its stream info was not updated."
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	// The live broadcast's video id: the live poll's memo when we have it,
	// otherwise probe the broadcast list the same way fetchYouTubeLive does.
	videoID := a.cachedYTVideoID()
	if videoID == "" {
		var broadcasts struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		}
		if _, err := getJSON(youtubeBroadcastsURL, headers, &broadcasts); err != nil {
			log.Printf("jax: apply plan to youtube: broadcasts: %v", err)
			return "YouTube: could not check for an active broadcast."
		}
		if len(broadcasts.Items) == 0 {
			return "YouTube: no live broadcast yet — run “Apply stream info” after the stream starts."
		}
		videoID = broadcasts.Items[0].ID
		a.setYTVideoID(videoID)
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
	if _, err := getJSON(
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

	status, err := sendJSON(http.MethodPut, youtubeVideosUpdateURL, headers,
		payload, nil)
	if err != nil {
		log.Printf("jax: apply plan to youtube: update: %v", err)
		if status == 401 || status == 403 {
			return "YouTube: reconnect in Settings → Services to grant the update permission."
		}
		return "YouTube: the stream info could not be updated."
	}
	return ""
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

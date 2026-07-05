package main

import (
	"fmt"
	"log"
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
	EpisodeNumber int    `json:"episodeNumber"`
	CreatedAt     string `json:"createdAt"` // RFC3339
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

	warnings := []string{}
	for _, channel := range plan.Channels {
		switch channel {
		case "twitch":
			if w := a.applyPlanToTwitch(*plan, series); w != "" {
				warnings = append(warnings, w)
			}
		case "youtube":
			// YouTube's broadcast metadata is bound to the (auto-created)
			// broadcast, which does not exist until the stream is live.
			warnings = append(warnings, "YouTube: automatic stream-info updates aren't supported yet — set the title in YouTube Studio.")
		}
	}
	return warnings, nil
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
	payload := map[string]any{"title": plan.Title}
	if series != nil {
		if series.TwitchCategory.ID != "" {
			payload["game_id"] = series.TwitchCategory.ID
		}
		tags := []string{}
		for _, t := range series.Tags {
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

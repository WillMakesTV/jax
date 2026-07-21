package main

import (
	"bp-temp/internal/httpx"
	"log"
	"time"
)

// ---------------------------------------------------------------------------
// Live-events log & platform sync
//
// The frontend's EventsProvider saves every event it appends (Twitch EventSub,
// YouTube chat ride-alongs) and seeds itself from the log on launch, so the
// unified feed survives restarts. On top of the push channels, the provider
// periodically calls SyncPlatformEvents, which pulls each platform's pollable
// history — Twitch's recent followers, YouTube's recent subscribers — and
// backfills anything the push channels missed (e.g. while the app was closed).
// Events are deduplicated by (platform, id): followers use the deterministic
// id "follow:<user id>" on both the EventSub and sync paths.
// ---------------------------------------------------------------------------

// StoredLiveEvent is one persisted channel event in the unified feed.
type StoredLiveEvent struct {
	Platform string `json:"platform"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Author   string `json:"author"`
	Detail   string `json:"detail"`
	At       int64  `json:"at"` // unix millis
	Read     bool   `json:"read"`
}

// SaveLiveEvents appends new events to the local log. Events already stored
// (same platform+id) keep their original row and read state. Failures are
// logged here — the frontend treats persistence as best-effort.
func (a *App) SaveLiveEvents(items []StoredLiveEvent) error {
	if a.store == nil {
		return nil
	}
	if _, err := a.store.saveLiveEvents(items); err != nil {
		log.Printf("jax: SaveLiveEvents (%d items): %v", len(items), err)
		return err
	}
	return nil
}

// GetLiveEventHistory returns the newest limit stored events in chronological
// order. Never returns nil.
func (a *App) GetLiveEventHistory(limit int) []StoredLiveEvent {
	if a.store == nil {
		return []StoredLiveEvent{}
	}
	if limit <= 0 {
		limit = 200
	}
	events, err := a.store.getLiveEventHistory(limit)
	if err != nil {
		log.Printf("jax: GetLiveEventHistory: %v", err)
		return []StoredLiveEvent{}
	}
	return events
}

// GetLiveEventsBefore returns the newest limit stored events strictly older
// than before (unix millis), in chronological order — the feed's "Show more"
// pages through history with this. Never returns nil.
func (a *App) GetLiveEventsBefore(before int64, limit int) []StoredLiveEvent {
	if a.store == nil {
		return []StoredLiveEvent{}
	}
	if limit <= 0 {
		limit = 100
	}
	events, err := a.store.getLiveEventsBefore(before, limit)
	if err != nil {
		log.Printf("jax: GetLiveEventsBefore: %v", err)
		return []StoredLiveEvent{}
	}
	return events
}

// GetLiveEventsForStream returns stored events that fall within a broadcast's
// window — [startedAt - margin, startedAt + duration + margin] — in
// chronological order, so a past stream shows the follows, subs, cheers, and
// raids it earned. Same windowing as GetChatForStream. Never returns nil.
func (a *App) GetLiveEventsForStream(startedAt string, durationSecs int) []StoredLiveEvent {
	if a.store == nil {
		return []StoredLiveEvent{}
	}
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return []StoredLiveEvent{}
	}
	margin := a.pastMatchMargin()
	lo := start.Add(-margin).UnixMilli()
	hi := start.Add(time.Duration(durationSecs)*time.Second + margin).UnixMilli()
	out, err := a.store.getLiveEventsBetween(lo, hi)
	if err != nil {
		log.Printf("jax: GetLiveEventsForStream: %v", err)
		return []StoredLiveEvent{}
	}
	return out
}

// GetSessionLiveEvents returns the active stream session's stored events —
// the newest limit in chronological order — the event side of
// GetSessionChatHistory, for surfaces that show the broadcast on the air
// (the Unified Chat overlay runs them inline with the chat). Empty when no
// session is open. Never returns nil.
func (a *App) GetSessionLiveEvents(limit int) []StoredLiveEvent {
	if a.store == nil {
		return []StoredLiveEvent{}
	}
	if limit <= 0 {
		limit = 100
	}
	session := a.GetActiveStreamSession()
	if !session.Active {
		return []StoredLiveEvent{}
	}
	start, err := time.Parse(time.RFC3339, session.StartedAt)
	if err != nil {
		return []StoredLiveEvent{}
	}
	margin := a.pastMatchMargin()
	lo := start.Add(-margin).UnixMilli()
	hi := time.Now().Add(margin).UnixMilli()
	out, err := a.store.getLiveEventsBetween(lo, hi)
	if err != nil {
		log.Printf("jax: GetSessionLiveEvents: %v", err)
		return []StoredLiveEvent{}
	}
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

// MarkAllLiveEventsRead persists that every stored event has been seen.
func (a *App) MarkAllLiveEventsRead() error {
	if a.store == nil {
		return nil
	}
	return a.store.markAllLiveEventsRead()
}

// SyncPlatformEvents pulls each connected platform's pollable event history
// (Twitch followers, YouTube subscribers), stores whatever is new, and
// returns just those events so the frontend can append them to the feed.
// Events at or before the newest already-stored timestamp — and everything on
// the very first sync — arrive marked read, so backfilled history never
// floods the unread badge. Never returns nil.
func (a *App) SyncPlatformEvents() []StoredLiveEvent {
	out := []StoredLiveEvent{}
	if a.store == nil {
		return out
	}
	baseline, err := a.store.latestLiveEventAt()
	if err != nil {
		log.Printf("jax: SyncPlatformEvents baseline: %v", err)
		return out
	}

	candidates := append(a.fetchTwitchFollowers(), a.fetchYouTubeSubscribers()...)
	if len(candidates) == 0 {
		return out
	}
	for i := range candidates {
		candidates[i].Read = baseline == 0 || candidates[i].At <= baseline
	}

	fresh, err := a.store.saveLiveEvents(candidates)
	if err != nil {
		log.Printf("jax: SyncPlatformEvents save: %v", err)
	}
	return fresh
}

// fetchTwitchFollowers lists the channel's most recent followers as feed
// events. Requires the moderator:read:followers scope (the same one EventSub
// follow subscriptions use); on any failure it just returns nothing.
func (a *App) fetchTwitchFollowers() []StoredLiveEvent {
	events := []StoredLiveEvent{}
	conn, ok := a.freshConn("twitch")
	if !ok || conn.userID == "" {
		return events
	}

	var resp struct {
		Data []struct {
			UserID     string `json:"user_id"`
			UserName   string `json:"user_name"`
			FollowedAt string `json:"followed_at"`
		} `json:"data"`
	}
	endpoint := twitchFollowersURL + "?first=100&broadcaster_id=" + conn.userID
	if _, err := httpx.GetJSON(endpoint, twitchHeaders(conn), &resp); err != nil {
		log.Printf("jax: twitch followers sync: %v", err)
		return events
	}
	for _, f := range resp.Data {
		if f.UserID == "" {
			continue
		}
		at, err := time.Parse(time.RFC3339, f.FollowedAt)
		if err != nil {
			continue
		}
		events = append(events, StoredLiveEvent{
			Platform: "twitch",
			// Deterministic identity shared with the EventSub follow path.
			ID:     "follow:" + f.UserID,
			Type:   "follow",
			Author: f.UserName,
			Detail: "followed the channel",
			At:     at.UnixMilli(),
		})
	}
	return events
}

const youtubeSubscriptionsURL = "https://www.googleapis.com/youtube/v3/subscriptions" +
	"?part=snippet,subscriberSnippet&myRecentSubscribers=true&maxResults=50"

// fetchYouTubeSubscribers lists the channel's most recent subscribers as feed
// events — the YouTube equivalent of a Twitch follow. The API only exposes
// subscribers whose subscriptions are public, so private subscribers never
// appear by name (they still count in the dashboard's subscriber total).
func (a *App) fetchYouTubeSubscribers() []StoredLiveEvent {
	events := []StoredLiveEvent{}
	conn, ok := a.freshConn("youtube")
	if !ok {
		return events
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	var resp struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				PublishedAt string `json:"publishedAt"`
			} `json:"snippet"`
			SubscriberSnippet struct {
				Title string `json:"title"`
			} `json:"subscriberSnippet"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(youtubeSubscriptionsURL, headers, &resp); err != nil {
		log.Printf("jax: youtube subscribers sync: %v", err)
		return events
	}
	for _, item := range resp.Items {
		if item.ID == "" {
			continue
		}
		at, err := time.Parse(time.RFC3339, item.Snippet.PublishedAt)
		if err != nil {
			continue
		}
		events = append(events, StoredLiveEvent{
			Platform: "youtube",
			ID:       item.ID,
			Type:     "follow",
			Author:   item.SubscriberSnippet.Title,
			Detail:   "subscribed to the channel",
			At:       at.UnixMilli(),
		})
	}
	return events
}

package main

import (
	"fmt"
)

// ---------------------------------------------------------------------------
// YouTube subscribers
//
// YouTube has no push channel for new subscribers, so the frontend polls
// PollYouTubeSubscribers while the service is connected and feeds the results
// into the Live Events feed alongside the other platforms' events. Each poll
// reads the channel's most recent subscribers and reports the ones new since
// the previous call as "follow" events carrying the subscriber's name — the
// YouTube equivalent of a Twitch follow. The first call of a session just
// baselines the seen set so long-standing subscribers are not replayed.
//
// API caveat: YouTube only exposes subscribers whose subscriptions are
// public, so private subscribers never appear by name (they still count in
// the channel's subscriber total shown on the dashboard).
// ---------------------------------------------------------------------------

const youtubeSubscriptionsURL = "https://www.googleapis.com/youtube/v3/subscriptions" +
	"?part=snippet,subscriberSnippet&myRecentSubscribers=true&maxResults=50"

// PollYouTubeSubscribers reports the connected channel's subscribers that
// appeared since the previous poll of this app session, as feed events.
// Never returns nil on success.
func (a *App) PollYouTubeSubscribers() ([]LiveEvent, error) {
	events := []LiveEvent{}
	conn, ok := a.freshConn("youtube")
	if !ok {
		return events, fmt.Errorf("YouTube is not connected")
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
	if _, err := getJSON(youtubeSubscriptionsURL, headers, &resp); err != nil {
		return events, fmt.Errorf("could not list YouTube subscribers: %w", err)
	}

	// Diff against the session's seen set; the first poll only baselines it,
	// so restarting the app doesn't re-announce the whole first page.
	a.mu.Lock()
	baselined := a.ytSubsSeen != nil
	if !baselined {
		a.ytSubsSeen = map[string]bool{}
	}
	for _, item := range resp.Items {
		if a.ytSubsSeen[item.ID] {
			continue
		}
		a.ytSubsSeen[item.ID] = true
		if baselined {
			events = append(events, LiveEvent{
				ID:          item.ID,
				Platform:    "youtube",
				Type:        "follow",
				Author:      item.SubscriberSnippet.Title,
				Detail:      "subscribed to the channel",
				PublishedAt: item.Snippet.PublishedAt,
			})
		}
	}
	a.mu.Unlock()

	return events, nil
}

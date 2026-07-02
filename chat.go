package main

import (
	"log"
	"net/url"
)

// ---------------------------------------------------------------------------
// Live chat
//
// Twitch chat is read in the frontend over anonymous IRC (see
// lib/twitchChat.ts). YouTube live chat has no anonymous transport, so it is
// polled here through the Data API using the stored OAuth session and merged
// with Twitch messages in the frontend's ChatProvider.
// ---------------------------------------------------------------------------

// ChatMessage is one chat message from any platform.
type ChatMessage struct {
	ID          string `json:"id"`
	Platform    string `json:"platform"`
	Author      string `json:"author"`
	Text        string `json:"text"`
	PublishedAt string `json:"publishedAt"` // RFC3339
}

// LiveChatPage is one page of YouTube live-chat messages. The frontend passes
// NextPageToken back on the next poll and waits PollIntervalMs between polls.
type LiveChatPage struct {
	Live           bool          `json:"live"`
	Messages       []ChatMessage `json:"messages"`
	NextPageToken  string        `json:"nextPageToken"`
	PollIntervalMs int           `json:"pollIntervalMs"`
}

const youtubeChatMessagesURL = "https://www.googleapis.com/youtube/v3/liveChat/messages"

// cachedYouTubeChatID returns the memoised live-chat id, or "" when unset.
func (a *App) cachedYouTubeChatID() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.ytChatID
}

func (a *App) setYouTubeChatID(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ytChatID = id
}

// GetYouTubeLiveChat returns the next page of the active broadcast's live
// chat. An empty pageToken starts from the recent history the API provides.
// Live=false means there is no active chat (not live, chat ended, or the
// YouTube connection is missing).
func (a *App) GetYouTubeLiveChat(pageToken string) LiveChatPage {
	conn, ok := a.freshConn("youtube")
	if !ok {
		return LiveChatPage{}
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	// Resolve (and memoise) the active broadcast's chat id. Looking it up on
	// every poll would double the quota cost of chat polling.
	chatID := a.cachedYouTubeChatID()
	if chatID == "" {
		var broadcasts struct {
			Items []struct {
				Snippet struct {
					LiveChatID string `json:"liveChatId"`
				} `json:"snippet"`
			} `json:"items"`
		}
		if _, err := getJSON(youtubeBroadcastsURL, headers, &broadcasts); err != nil {
			log.Printf("jax: youtube chat broadcast lookup: %v", err)
			return LiveChatPage{}
		}
		if len(broadcasts.Items) == 0 || broadcasts.Items[0].Snippet.LiveChatID == "" {
			return LiveChatPage{} // not live
		}
		chatID = broadcasts.Items[0].Snippet.LiveChatID
		a.setYouTubeChatID(chatID)
	}

	endpoint := youtubeChatMessagesURL +
		"?part=snippet,authorDetails&maxResults=200&liveChatId=" + url.QueryEscape(chatID)
	if pageToken != "" {
		endpoint += "&pageToken=" + url.QueryEscape(pageToken)
	}

	var resp struct {
		NextPageToken         string `json:"nextPageToken"`
		PollingIntervalMillis int    `json:"pollingIntervalMillis"`
		OfflineAt             string `json:"offlineAt"`
		Items                 []struct {
			ID      string `json:"id"`
			Snippet struct {
				DisplayMessage string `json:"displayMessage"`
				PublishedAt    string `json:"publishedAt"`
			} `json:"snippet"`
			AuthorDetails struct {
				DisplayName string `json:"displayName"`
			} `json:"authorDetails"`
		} `json:"items"`
	}
	if _, err := getJSON(endpoint, headers, &resp); err != nil {
		// Chat gone (stream ended, id stale): drop the cache so the next poll
		// re-resolves against the current broadcast.
		log.Printf("jax: youtube chat messages: %v", err)
		a.setYouTubeChatID("")
		return LiveChatPage{}
	}
	if resp.OfflineAt != "" {
		a.setYouTubeChatID("")
		return LiveChatPage{}
	}

	messages := make([]ChatMessage, 0, len(resp.Items))
	for _, item := range resp.Items {
		if item.Snippet.DisplayMessage == "" {
			continue // system events (memberships, deletions) have no display text
		}
		messages = append(messages, ChatMessage{
			ID:          item.ID,
			Platform:    "youtube",
			Author:      item.AuthorDetails.DisplayName,
			Text:        item.Snippet.DisplayMessage,
			PublishedAt: item.Snippet.PublishedAt,
		})
	}
	return LiveChatPage{
		Live:           true,
		Messages:       messages,
		NextPageToken:  resp.NextPageToken,
		PollIntervalMs: resp.PollingIntervalMillis,
	}
}

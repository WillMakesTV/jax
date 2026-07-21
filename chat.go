package main

import (
	"bp-temp/internal/platforms/youtube"
	"bp-temp/internal/httpx"
	"fmt"
	"log"
	"net/url"
	"strings"
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
	AuthorID    string `json:"authorId"` // YouTube channel id / Twitch user id
	AvatarURL   string `json:"avatarUrl"`
	// Badges are normalised author roles ("Owner", "Moderator", "Member",
	// "Verified", "Subscriber", ...).
	Badges      []string `json:"badges"`
	Text        string   `json:"text"`
	PublishedAt string   `json:"publishedAt"` // RFC3339
}

// LiveChatPage is one page of YouTube live-chat messages. The frontend passes
// NextPageToken back on the next poll and waits PollIntervalMs between polls.
// Events carries the channel events found in the same page (new members,
// Super Chats, ...), since YouTube delivers them through the chat stream.
type LiveChatPage struct {
	Live           bool          `json:"live"`
	Messages       []ChatMessage `json:"messages"`
	Events         []LiveEvent   `json:"events"`
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

// resolveYouTubeChatID returns the active broadcast's live-chat id, memoised
// between calls (looking it up on every chat poll would double the quota cost
// of polling). Returns "" when there is no active broadcast.
func (a *App) resolveYouTubeChatID(headers map[string]string) string {
	if chatID := a.cachedYouTubeChatID(); chatID != "" {
		return chatID
	}
	var broadcasts struct {
		Items []struct {
			Snippet struct {
				LiveChatID string `json:"liveChatId"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(youtube.ActiveBroadcastURL, headers, &broadcasts); err != nil {
		log.Printf("jax: youtube chat broadcast lookup: %v", err)
		return ""
	}
	if len(broadcasts.Items) == 0 || broadcasts.Items[0].Snippet.LiveChatID == "" {
		return "" // not live
	}
	chatID := broadcasts.Items[0].Snippet.LiveChatID
	a.setYouTubeChatID(chatID)
	return chatID
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

	chatID := a.resolveYouTubeChatID(headers)
	if chatID == "" {
		return LiveChatPage{}
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
				Type             string `json:"type"`
				DisplayMessage   string `json:"displayMessage"`
				PublishedAt      string `json:"publishedAt"`
				SuperChatDetails struct {
					AmountDisplayString string `json:"amountDisplayString"`
					UserComment         string `json:"userComment"`
				} `json:"superChatDetails"`
				SuperStickerDetails struct {
					AmountDisplayString string `json:"amountDisplayString"`
				} `json:"superStickerDetails"`
				NewSponsorDetails struct {
					MemberLevelName string `json:"memberLevelName"`
					IsUpgrade       bool   `json:"isUpgrade"`
				} `json:"newSponsorDetails"`
				MemberMilestoneChatDetails struct {
					MemberLevelName string `json:"memberLevelName"`
					MemberMonth     int    `json:"memberMonth"`
					UserComment     string `json:"userComment"`
				} `json:"memberMilestoneChatDetails"`
			} `json:"snippet"`
			AuthorDetails struct {
				DisplayName     string `json:"displayName"`
				ChannelID       string `json:"channelId"`
				ProfileImageURL string `json:"profileImageUrl"`
				IsVerified      bool   `json:"isVerified"`
				IsChatOwner     bool   `json:"isChatOwner"`
				IsChatSponsor   bool   `json:"isChatSponsor"`
				IsChatModerator bool   `json:"isChatModerator"`
			} `json:"authorDetails"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(endpoint, headers, &resp); err != nil {
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
	events := []LiveEvent{}
	for _, item := range resp.Items {
		// Channel events travel through the chat stream; convert the ones we
		// support into LiveEvents for the Live Events feed.
		switch item.Snippet.Type {
		case "superChatEvent":
			detail := "sent a " + item.Snippet.SuperChatDetails.AmountDisplayString + " Super Chat"
			if c := item.Snippet.SuperChatDetails.UserComment; c != "" {
				detail += " — " + c
			}
			events = append(events, LiveEvent{
				ID: item.ID, Platform: "youtube", Type: "superchat",
				Author: item.AuthorDetails.DisplayName, Detail: detail,
				PublishedAt: item.Snippet.PublishedAt,
			})
			continue
		case "superStickerEvent":
			events = append(events, LiveEvent{
				ID: item.ID, Platform: "youtube", Type: "supersticker",
				Author: item.AuthorDetails.DisplayName,
				Detail: "sent a " + item.Snippet.SuperStickerDetails.AmountDisplayString + " Super Sticker",
				PublishedAt: item.Snippet.PublishedAt,
			})
			continue
		case "newSponsorEvent":
			detail := "became a channel member"
			if item.Snippet.NewSponsorDetails.IsUpgrade {
				detail = "upgraded their membership"
			}
			if lvl := item.Snippet.NewSponsorDetails.MemberLevelName; lvl != "" {
				detail += " (" + lvl + ")"
			}
			events = append(events, LiveEvent{
				ID: item.ID, Platform: "youtube", Type: "member",
				Author: item.AuthorDetails.DisplayName, Detail: detail,
				PublishedAt: item.Snippet.PublishedAt,
			})
			continue
		case "memberMilestoneChatEvent":
			d := item.Snippet.MemberMilestoneChatDetails
			detail := fmt.Sprintf("member for %d months", d.MemberMonth)
			if d.UserComment != "" {
				detail += " — " + d.UserComment
			}
			events = append(events, LiveEvent{
				ID: item.ID, Platform: "youtube", Type: "milestone",
				Author: item.AuthorDetails.DisplayName, Detail: detail,
				PublishedAt: item.Snippet.PublishedAt,
			})
			continue
		}
		if item.Snippet.DisplayMessage == "" {
			continue // other system events (deletions, polls) have no display text
		}
		var badges []string
		if item.AuthorDetails.IsChatOwner {
			badges = append(badges, "Owner")
		}
		if item.AuthorDetails.IsChatModerator {
			badges = append(badges, "Moderator")
		}
		if item.AuthorDetails.IsChatSponsor {
			badges = append(badges, "Member")
		}
		if item.AuthorDetails.IsVerified {
			badges = append(badges, "Verified")
		}
		messages = append(messages, ChatMessage{
			ID:          item.ID,
			Platform:    "youtube",
			Author:      item.AuthorDetails.DisplayName,
			AuthorID:    item.AuthorDetails.ChannelID,
			AvatarURL:   item.AuthorDetails.ProfileImageURL,
			Badges:      badges,
			Text:        item.Snippet.DisplayMessage,
			PublishedAt: item.Snippet.PublishedAt,
		})
	}
	return LiveChatPage{
		Live:           true,
		Messages:       messages,
		Events:         events,
		NextPageToken:  resp.NextPageToken,
		PollIntervalMs: resp.PollingIntervalMillis,
	}
}

// ---------------------------------------------------------------------------
// Broadcast messages
//
// One message sent, as the broadcaster, to every connected channel's chat.
// Twitch uses the Helix send-chat-message endpoint (user:write:chat scope);
// YouTube inserts into the active broadcast's live chat (youtube.force-ssl
// scope). Connections made before those scopes were requested surface a
// "reconnect" error for that platform.
// ---------------------------------------------------------------------------

// BroadcastSendResult is one platform's outcome for a broadcast message.
type BroadcastSendResult struct {
	Platform string `json:"platform"`
	Sent     bool   `json:"sent"`
	Error    string `json:"error"`
}

// sendErrorMessage maps an API failure to a user-actionable message.
func sendErrorMessage(platform string, status int, err error) string {
	if status == 401 || status == 403 {
		return "Missing chat permission — reconnect " + platformLabel(platform) +
			" in Settings → Services to grant it."
	}
	if err != nil {
		return "Sending failed: " + err.Error()
	}
	return "Sending failed."
}

// SendBroadcastChat sends message to every connected channel's chat as the
// broadcaster. Returns one result per connected platform (never nil).
func (a *App) SendBroadcastChat(message string) []BroadcastSendResult {
	message = strings.TrimSpace(message)
	results := []BroadcastSendResult{}
	if message == "" {
		return results
	}

	if conn, ok := a.freshConn("twitch"); ok {
		r := BroadcastSendResult{Platform: "twitch"}
		if conn.userID == "" {
			r.Error = "Twitch account details unavailable — try reconnecting."
		} else {
			sent, dropped, status, err := twitchClient(conn).SendChatMessage(message)
			switch {
			case err != nil:
				r.Error = sendErrorMessage("twitch", status, err)
			case !sent:
				r.Error = firstNonEmpty(dropped, "Twitch dropped the message.")
			default:
				r.Sent = true
			}
		}
		results = append(results, r)
	}

	if conn, ok := a.freshConn("youtube"); ok {
		r := BroadcastSendResult{Platform: "youtube"}
		headers := map[string]string{"Authorization": "Bearer " + conn.token}
		client := youtubeClient(conn)
		send := func(chatID string) (int, error) {
			return client.SendChatMessage(chatID, message)
		}

		chatID := a.resolveYouTubeChatID(headers)
		if chatID == "" {
			r.Error = "No active YouTube live chat — the channel must be live to receive chat."
		} else {
			status, err := send(chatID)
			if err != nil && status >= 400 && status < 500 {
				// The memoised chat id may belong to an earlier, ended
				// broadcast. Re-resolve against the current one and retry.
				a.setYouTubeChatID("")
				if fresh := a.resolveYouTubeChatID(headers); fresh != "" && fresh != chatID {
					status, err = send(fresh)
				}
			}
			if err != nil {
				log.Printf("jax: youtube broadcast send: %v", err)
				r.Error = youtubeSendError(status, err)
			} else {
				r.Sent = true
			}
		}
		results = append(results, r)
	}

	if conn, ok := a.freshConn("kick"); ok {
		r := BroadcastSendResult{Platform: "kick"}
		if status, err := sendKickChat(conn, message); err != nil {
			log.Printf("jax: kick broadcast send: %v", err)
			r.Error = sendErrorMessage("kick", status, err)
		} else {
			r.Sent = true
		}
		results = append(results, r)
	}

	if conn, ok := a.freshConn("facebook"); ok {
		r := BroadcastSendResult{Platform: "facebook"}
		if status, err := a.sendFacebookChat(conn, message); err != nil {
			log.Printf("jax: facebook broadcast send: %v", err)
			r.Error = sendErrorMessage("facebook", status, err)
		} else {
			r.Sent = true
		}
		results = append(results, r)
	}

	if conn, ok := a.freshConn("instagram"); ok {
		r := BroadcastSendResult{Platform: "instagram"}
		if status, err := a.sendInstagramChat(conn, message); err != nil {
			log.Printf("jax: instagram broadcast send: %v", err)
			r.Error = sendErrorMessage("instagram", status, err)
		} else {
			r.Sent = true
		}
		results = append(results, r)
	}

	return results
}

// youtubeSendError distinguishes the ways a live-chat insert fails: missing
// write scope (token predates youtube.force-ssl), an inactive chat, or a
// generic API error.
func youtubeSendError(status int, err error) string {
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	switch {
	case strings.Contains(msg, "SCOPE_INSUFFICIENT"),
		strings.Contains(msg, "insufficientPermissions"),
		strings.Contains(msg, "insufficient authentication"),
		status == 401:
		return "Missing chat permission — reconnect YouTube in Settings → Services to grant it."
	case strings.Contains(msg, "liveChatEnded"), strings.Contains(msg, "liveChatDisabled"):
		return "The YouTube live chat is not active."
	case status == 403:
		return "YouTube rejected the message — reconnect YouTube in Settings → Services if this persists. (" + msg + ")"
	}
	return "Sending failed: " + msg
}

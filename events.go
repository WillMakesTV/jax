package main

import (
	"bp-temp/internal/httpx"
	"fmt"
	"log"
)

// ---------------------------------------------------------------------------
// Live events
//
// Twitch events (follows, subs, gifts, resubs, cheers, raids) arrive over an
// EventSub WebSocket that the frontend opens; websocket-transport
// subscriptions must be created with the broadcaster's token, so the frontend
// hands the session id to SubscribeTwitchEvents below. YouTube has no
// equivalent push channel — its events (memberships, Super Chats) are parsed
// out of the live-chat poll in chat.go.
// ---------------------------------------------------------------------------

// LiveEvent is one channel event (follow, sub, Super Chat, raid, ...).
type LiveEvent struct {
	ID          string `json:"id"`
	Platform    string `json:"platform"`
	Type        string `json:"type"` // "follow" | "sub" | "gift" | "resub" | "cheer" | "raid" | "member" | "milestone" | "superchat" | "supersticker"
	Author      string `json:"author"`
	Detail      string `json:"detail"` // human-readable summary
	PublishedAt string `json:"publishedAt"`
}

const twitchEventSubURL = "https://api.twitch.tv/helix/eventsub/subscriptions"

// twitchEventSubTypes lists the subscriptions requested for the frontend's
// EventSub session. Scopes: follows need moderator:read:followers, sub events
// channel:read:subscriptions, cheers bits:read; raids need none.
var twitchEventSubTypes = []struct {
	Type    string
	Version string
}{
	{"channel.follow", "2"},
	{"channel.subscribe", "1"},
	{"channel.subscription.gift", "1"},
	{"channel.subscription.message", "1"},
	{"channel.cheer", "1"},
	{"channel.raid", "1"},
}

// SubscribeTwitchEvents creates EventSub subscriptions on the frontend's
// WebSocket session. Individual failures (typically missing scopes on an
// older connection) are skipped; the error strings are returned so the UI
// can hint at a reconnect. Returns an error only when nothing succeeded.
func (a *App) SubscribeTwitchEvents(sessionID string) ([]string, error) {
	conn, ok := a.freshConn("twitch")
	if !ok {
		return nil, fmt.Errorf("Twitch is not connected")
	}
	if conn.userID == "" {
		return nil, fmt.Errorf("Twitch account details unavailable — try reconnecting")
	}
	headers := twitchHeaders(conn)

	warnings := []string{}
	succeeded := 0
	for _, sub := range twitchEventSubTypes {
		condition := map[string]string{"broadcaster_user_id": conn.userID}
		switch sub.Type {
		case "channel.follow":
			condition["moderator_user_id"] = conn.userID
		case "channel.raid":
			condition = map[string]string{"to_broadcaster_user_id": conn.userID}
		}
		payload := map[string]any{
			"type":      sub.Type,
			"version":   sub.Version,
			"condition": condition,
			"transport": map[string]string{
				"method":     "websocket",
				"session_id": sessionID,
			},
		}
		if status, err := httpx.PostJSON(twitchEventSubURL, headers, payload, nil); err != nil {
			log.Printf("jax: eventsub %s: %v", sub.Type, err)
			msg := sub.Type + " unavailable."
			if status == 401 || status == 403 {
				msg = sub.Type + " needs new permissions — reconnect Twitch in Settings → Services."
			}
			warnings = append(warnings, msg)
		} else {
			succeeded++
		}
	}
	if succeeded == 0 {
		return warnings, fmt.Errorf("no event subscriptions could be created")
	}
	return warnings, nil
}

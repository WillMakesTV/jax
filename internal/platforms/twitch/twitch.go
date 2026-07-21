// Package twitch talks to Twitch's Helix API: the endpoints, the request
// shapes, and the responses, with no knowledge of how the app stores a
// connection or renders what comes back.
//
// A Client is one authenticated broadcaster — the token, the app's client id,
// and the broadcaster's own user id, which Helix wants on moderation calls as
// both the broadcaster and the moderator. Callers keep the auth: they build a
// Client from whatever connection they hold and hand back the result.
package twitch

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"bp-temp/internal/httpx"
)

// Helix endpoints the app uses.
const (
	SearchCategoriesURL = "https://api.twitch.tv/helix/search/categories"
	BansURL             = "https://api.twitch.tv/helix/moderation/bans"
	ModChatURL          = "https://api.twitch.tv/helix/moderation/chat"
	ChatMessagesURL     = "https://api.twitch.tv/helix/chat/messages"
	UsersURL            = "https://api.twitch.tv/helix/users"
	FollowersURL        = "https://api.twitch.tv/helix/channels/followers"
	SubscriptionsURL    = "https://api.twitch.tv/helix/subscriptions"
	EventSubURL         = "https://api.twitch.tv/helix/eventsub/subscriptions"
	StreamsURL          = "https://api.twitch.tv/helix/streams"
	VideosURL           = "https://api.twitch.tv/helix/videos"
	ClipsURL            = "https://api.twitch.tv/helix/clips"
)

// Client is an authenticated Twitch caller.
type Client struct {
	Token    string
	ClientID string
	// UserID is the broadcaster's Twitch user id. Moderation needs it; the
	// category search does not.
	UserID string
}

// Headers are the auth headers every Helix call carries.
func (c Client) Headers() map[string]string {
	return map[string]string{
		"Authorization": "Bearer " + c.Token,
		"Client-Id":     c.ClientID,
	}
}

// Category is a Twitch game/category: the id the update API accepts, and its
// display name.
type Category struct {
	ID   string
	Name string
}

// SearchCategories searches the game/category catalogue, newest-first as
// Twitch ranks it, capped at 25. Returns the HTTP status alongside the error
// so the caller can tell an expired token from a failed search.
func (c Client) SearchCategories(query string) ([]Category, int, error) {
	var r struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	endpoint := SearchCategoriesURL + "?first=25&query=" + url.QueryEscape(query)
	status, err := httpx.GetJSON(endpoint, c.Headers(), &r)
	if err != nil {
		return nil, status, err
	}
	out := make([]Category, 0, len(r.Data))
	for _, d := range r.Data {
		out = append(out, Category{ID: d.ID, Name: d.Name})
	}
	return out, status, nil
}

// Ban times a chatter out (seconds > 0) or bans them permanently
// (seconds <= 0). reason may be empty.
func (c Client) Ban(userID string, seconds int, reason string) (int, error) {
	data := map[string]any{"user_id": userID}
	if seconds > 0 {
		data["duration"] = seconds
	}
	if reason != "" {
		data["reason"] = reason
	}
	return httpx.PostJSON(BansURL+c.modQuery(), c.Headers(),
		map[string]any{"data": data}, nil)
}

// DeleteMessage removes one message from the broadcaster's chat.
func (c Client) DeleteMessage(messageID string) (int, error) {
	endpoint := ModChatURL + c.modQuery() +
		"&message_id=" + url.QueryEscape(messageID)
	return httpx.DeleteResource(endpoint, c.Headers())
}

// modQuery is the broadcaster/moderator pair Helix wants on moderation calls.
// Jax moderates the producer's own channel, so both are the same id.
func (c Client) modQuery() string {
	return "?broadcaster_id=" + url.QueryEscape(c.UserID) +
		"&moderator_id=" + url.QueryEscape(c.UserID)
}

// SendChatMessage posts a message to the broadcaster's own chat. Twitch can
// accept the request and still drop the message (AutoMod, slow mode, a
// banned word); sent is false with the reason when it does.
func (c Client) SendChatMessage(message string) (sent bool, reason string, status int, err error) {
	var resp struct {
		Data []struct {
			IsSent     bool `json:"is_sent"`
			DropReason struct {
				Message string `json:"message"`
			} `json:"drop_reason"`
		} `json:"data"`
	}
	status, err = httpx.PostJSON(ChatMessagesURL, c.Headers(), map[string]string{
		"broadcaster_id": c.UserID,
		"sender_id":      c.UserID,
		"message":        message,
	}, &resp)
	if err != nil {
		return false, "", status, err
	}
	if len(resp.Data) > 0 && !resp.Data[0].IsSent {
		return false, resp.Data[0].DropReason.Message, status, nil
	}
	return true, "", status, nil
}

// User is a Twitch account as Helix describes it.
type User struct {
	ID              string `json:"id"`
	Login           string `json:"login"`
	DisplayName     string `json:"display_name"`
	Description     string `json:"description"`
	ProfileImageURL string `json:"profile_image_url"`
	BroadcasterType string `json:"broadcaster_type"`
	CreatedAt       string `json:"created_at"`
}

// LookupUser resolves one account by id, or by login when id is empty.
func (c Client) LookupUser(id, login string) (User, error) {
	query := "?id=" + url.QueryEscape(id)
	if id == "" {
		if login == "" {
			return User{}, fmt.Errorf("no user id or login to look up")
		}
		query = "?login=" + url.QueryEscape(strings.ToLower(login))
	}
	var users struct {
		Data []User `json:"data"`
	}
	if _, err := httpx.GetJSON(UsersURL+query, c.Headers(), &users); err != nil {
		return User{}, err
	}
	if len(users.Data) == 0 {
		return User{}, fmt.Errorf("Twitch user not found")
	}
	return users.Data[0], nil
}

// FollowedAt reports when a viewer followed the broadcaster, or "" when they
// do not follow. Needs moderator:read:followers.
func (c Client) FollowedAt(userID string) (string, error) {
	var follows struct {
		Data []struct {
			FollowedAt string `json:"followed_at"`
		} `json:"data"`
	}
	_, err := httpx.GetJSON(
		FollowersURL+"?broadcaster_id="+url.QueryEscape(c.UserID)+
			"&user_id="+url.QueryEscape(userID),
		c.Headers(), &follows)
	if err != nil || len(follows.Data) == 0 {
		return "", err
	}
	return follows.Data[0].FollowedAt, nil
}

// SubscriptionTier reports a viewer's subscription tier ("1000"/"2000"/"3000")
// or "" when they are not subscribed. Needs channel:read:subscriptions; Helix
// answers 404 for "not subscribed", which the status makes visible.
func (c Client) SubscriptionTier(userID string) (string, int, error) {
	var subs struct {
		Data []struct {
			Tier string `json:"tier"`
		} `json:"data"`
	}
	status, err := httpx.GetJSON(
		SubscriptionsURL+"?broadcaster_id="+url.QueryEscape(c.UserID)+
			"&user_id="+url.QueryEscape(userID),
		c.Headers(), &subs)
	if err != nil || len(subs.Data) == 0 {
		return "", status, err
	}
	return subs.Data[0].Tier, status, nil
}

// SubscribeEvent creates one EventSub subscription on a WebSocket session.
func (c Client) SubscribeEvent(eventType, version string, condition map[string]string, sessionID string) (int, error) {
	return httpx.PostJSON(EventSubURL, c.Headers(), map[string]any{
		"type":      eventType,
		"version":   version,
		"condition": condition,
		"transport": map[string]string{
			"method":     "websocket",
			"session_id": sessionID,
		},
	}, nil)
}

// Self resolves the account the token belongs to — Helix answers /users with
// no query from the token itself, which is how a fresh connection learns its
// own broadcaster id.
func (c Client) Self() (User, error) {
	var users struct {
		Data []User `json:"data"`
	}
	if _, err := httpx.GetJSON(UsersURL, c.Headers(), &users); err != nil {
		return User{}, err
	}
	if len(users.Data) == 0 {
		return User{}, fmt.Errorf("Twitch returned no account for this token")
	}
	return users.Data[0], nil
}

// LiveStreamID returns the id of the broadcaster's stream while it is live,
// or "" when it is not.
func (c Client) LiveStreamID() (string, error) {
	var live struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_, err := httpx.GetJSON(StreamsURL+"?user_id="+url.QueryEscape(c.UserID),
		c.Headers(), &live)
	if err != nil || len(live.Data) == 0 {
		return "", err
	}
	return live.Data[0].ID, nil
}

// Archive is one past broadcast's VOD. Duration is Twitch's own compact form
// ("3h8m33s"), and ThumbnailURL is a size template until it is filled in.
type Archive struct {
	Title        string `json:"title"`
	URL          string `json:"url"`
	StreamID     string `json:"stream_id"`
	ThumbnailURL string `json:"thumbnail_url"`
	CreatedAt    string `json:"created_at"`
	Duration     string `json:"duration"`
	ViewCount    int    `json:"view_count"`
}

// Archives lists the channel's archive VODs, newest first.
func (c Client) Archives(first int) ([]Archive, error) {
	var resp struct {
		Data []Archive `json:"data"`
	}
	endpoint := VideosURL + "?user_id=" + url.QueryEscape(c.UserID) +
		"&type=archive&first=" + strconv.Itoa(first)
	if _, err := httpx.GetJSON(endpoint, c.Headers(), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// Clip is one clip of the channel. Duration is in seconds.
type Clip struct {
	ID              string  `json:"id"`
	URL             string  `json:"url"`
	Title           string  `json:"title"`
	ThumbnailURL    string  `json:"thumbnail_url"`
	CreatedAt       string  `json:"created_at"`
	Duration        float64 `json:"duration"`
	ViewCount       int64   `json:"view_count"`
	BroadcasterName string  `json:"broadcaster_name"`
}

// ClipsPage reads one page of the channel's clips and the cursor for the
// next, which is "" on the last page.
func (c Client) ClipsPage(cursor string, first int) ([]Clip, string, error) {
	endpoint := ClipsURL + "?broadcaster_id=" + url.QueryEscape(c.UserID) +
		"&first=" + strconv.Itoa(first)
	if cursor != "" {
		endpoint += "&after=" + url.QueryEscape(cursor)
	}
	var resp struct {
		Data       []Clip `json:"data"`
		Pagination struct {
			Cursor string `json:"cursor"`
		} `json:"pagination"`
	}
	if _, err := httpx.GetJSON(endpoint, c.Headers(), &resp); err != nil {
		return nil, "", err
	}
	return resp.Data, resp.Pagination.Cursor, nil
}

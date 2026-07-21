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
	"net/url"

	"bp-temp/internal/httpx"
)

// Helix endpoints the app uses.
const (
	SearchCategoriesURL = "https://api.twitch.tv/helix/search/categories"
	BansURL             = "https://api.twitch.tv/helix/moderation/bans"
	ModChatURL          = "https://api.twitch.tv/helix/moderation/chat"
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

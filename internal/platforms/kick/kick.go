// Package kick talks to Kick's two APIs.
//
// The public API (api.kick.com/public/v1) is the official, token-authenticated
// one: the account, the channel, category search, chat sending, and channel
// updates. It carries no VODs, no follower counts and no clips, so the app
// also reads kick.com's own site API (kick.com/api/v2) — unauthenticated,
// fronted by Cloudflare, and free to change without notice. Site calls send a
// browser-like User-Agent and callers must tolerate failure.
package kick

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"bp-temp/internal/httpx"
)

// API endpoints.
const (
	UsersURL       = "https://api.kick.com/public/v1/users"
	ChannelsURL    = "https://api.kick.com/public/v1/channels"
	CategoriesURL  = "https://api.kick.com/public/v1/categories"
	ChatSendURL    = "https://api.kick.com/public/v1/chat"
	UnofficialBase = "https://kick.com/api/v2"
)

// browserUA is what the site API is willing to answer: Cloudflare refuses
// obvious non-browser clients.
const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/126.0 Safari/537.36"

// Client is an authenticated Kick caller.
type Client struct {
	Token string
	// UserID is the broadcaster's Kick user id, which chat sending needs.
	UserID string
}

// Headers are the auth headers every public API call carries.
func (c Client) Headers() map[string]string {
	return map[string]string{"Authorization": "Bearer " + c.Token}
}

// User is the account a token belongs to.
type User struct {
	UserID         json.Number `json:"user_id"`
	Name           string      `json:"name"`
	ProfilePicture string      `json:"profile_picture"`
}

// Self reads the account the token belongs to.
func (c Client) Self() (User, error) {
	var r struct {
		Data []User `json:"data"`
	}
	if _, err := httpx.GetJSON(UsersURL, c.Headers(), &r); err != nil {
		return User{}, err
	}
	if len(r.Data) == 0 {
		return User{}, fmt.Errorf("kick returned no account for this token")
	}
	return r.Data[0], nil
}

// Channel is the connected account's channel, as the public API reports it.
type Channel struct {
	BroadcasterUserID json.Number `json:"broadcaster_user_id"`
	Slug              string      `json:"slug"`
	ChannelDesc       string      `json:"channel_description"`
	BannerPicture     string      `json:"banner_picture"`
	StreamTitle       string      `json:"stream_title"`
	Category          struct {
		ID   json.Number `json:"id"`
		Name string      `json:"name"`
	} `json:"category"`
	Stream struct {
		IsLive      bool   `json:"is_live"`
		IsMature    bool   `json:"is_mature"`
		Language    string `json:"language"`
		StartTime   string `json:"start_time"`
		Thumbnail   string `json:"thumbnail"`
		URL         string `json:"url"`
		ViewerCount int    `json:"viewer_count"`
	} `json:"stream"`
}

// MyChannel reads the connected account's channel. The status rides along so
// a caller can tell an expired token from an unreachable API.
func (c Client) MyChannel() (Channel, int, error) {
	var r struct {
		Data []Channel `json:"data"`
	}
	status, err := httpx.GetJSON(ChannelsURL, c.Headers(), &r)
	if err != nil {
		return Channel{}, status, err
	}
	if len(r.Data) == 0 {
		return Channel{}, status, fmt.Errorf("kick returned no channel")
	}
	return r.Data[0], status, nil
}

// Category is a Kick category: the id the update API accepts, and its name.
type Category struct {
	ID   string
	Name string
}

// SearchCategories searches the category catalogue.
func (c Client) SearchCategories(query string) ([]Category, int, error) {
	var r struct {
		Data []struct {
			ID   json.Number `json:"id"`
			Name string      `json:"name"`
		} `json:"data"`
	}
	status, err := httpx.GetJSON(CategoriesURL+"?q="+url.QueryEscape(query),
		c.Headers(), &r)
	if err != nil {
		return nil, status, err
	}
	out := make([]Category, 0, len(r.Data))
	for _, d := range r.Data {
		out = append(out, Category{ID: d.ID.String(), Name: d.Name})
	}
	return out, status, nil
}

// SendChatMessage posts a message to the broadcaster's chat. Kick can accept
// the request and still not send it, which is reported as an error. The API
// wants the broadcaster id as a number, so a non-numeric UserID is a usage
// error rather than a request.
func (c Client) SendChatMessage(message string) (int, error) {
	id, err := strconv.Atoi(c.UserID)
	if err != nil {
		return 0, fmt.Errorf("kick account details unavailable — try reconnecting")
	}
	var resp struct {
		Data struct {
			IsSent bool `json:"is_sent"`
		} `json:"data"`
	}
	status, err := httpx.PostJSON(ChatSendURL, c.Headers(), map[string]any{
		"broadcaster_user_id": id,
		"content":             message,
		"type":                "user",
	}, &resp)
	if err != nil {
		return status, err
	}
	if !resp.Data.IsSent {
		return status, fmt.Errorf("kick dropped the message")
	}
	return status, nil
}

// UpdateChannel applies stream information to the channel. Needs the
// channel:write scope, which older connections may not carry.
func (c Client) UpdateChannel(payload map[string]any) (int, error) {
	return httpx.PatchJSON(ChannelsURL, c.Headers(), payload)
}

// SiteGet fetches kick.com's site API into out. It is unauthenticated and
// Cloudflare-fronted, so it sends a browser-like User-Agent and callers must
// tolerate failure — this is the only source for VODs, clips and follower
// counts.
func SiteGet(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, UnofficialBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "application/json")
	resp, err := httpx.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("kick.com refused the request (%d)", resp.StatusCode)
	}
	return json.Unmarshal(body, out)
}

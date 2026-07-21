// Package youtube talks to the YouTube Data API v3: the endpoints, the
// request shapes, and the responses, with no knowledge of how the app stores
// a connection or renders what comes back.
//
// A Client is one authenticated channel — YouTube identifies the caller from
// the OAuth token alone, so unlike Twitch there is no id to carry. Callers
// keep the auth: they build a Client from whatever connection they hold.
package youtube

import (
	"fmt"
	"net/url"

	"bp-temp/internal/httpx"
)

// Data API endpoints the app uses.
const (
	CategoriesURL   = "https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US"
	ChannelsByIDURL = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id="
	ChatMessagesURL = "https://www.googleapis.com/youtube/v3/liveChat/messages"
	ChatBansURL     = "https://www.googleapis.com/youtube/v3/liveChat/bans"
)

// Client is an authenticated YouTube caller.
type Client struct {
	Token string
}

// Headers are the auth headers every Data API call carries.
func (c Client) Headers() map[string]string {
	return map[string]string{"Authorization": "Bearer " + c.Token}
}

// Category is a video category: the id the update API accepts, its title, and
// whether a video may actually be assigned to it.
type Category struct {
	ID         string
	Title      string
	Assignable bool
}

// Categories lists the video categories for the canonical region. The ids are
// identical across regions for the assignable ones, so one list serves all.
func (c Client) Categories() ([]Category, int, error) {
	var r struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title      string `json:"title"`
				Assignable bool   `json:"assignable"`
			} `json:"snippet"`
		} `json:"items"`
	}
	status, err := httpx.GetJSON(CategoriesURL, c.Headers(), &r)
	if err != nil {
		return nil, status, err
	}
	out := make([]Category, 0, len(r.Items))
	for _, it := range r.Items {
		out = append(out, Category{
			ID:         it.ID,
			Title:      it.Snippet.Title,
			Assignable: it.Snippet.Assignable,
		})
	}
	return out, status, nil
}

// Channel is a YouTube channel as the Data API describes it.
type Channel struct {
	ID      string `json:"id"`
	Snippet struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		CustomURL   string `json:"customUrl"`
		PublishedAt string `json:"publishedAt"`
		Thumbnails  struct {
			Default struct {
				URL string `json:"url"`
			} `json:"default"`
			Medium struct {
				URL string `json:"url"`
			} `json:"medium"`
		} `json:"thumbnails"`
	} `json:"snippet"`
	Statistics struct {
		SubscriberCount string `json:"subscriberCount"`
		VideoCount      string `json:"videoCount"`
	} `json:"statistics"`
}

// ChannelByID reads one channel's profile and public counts.
func (c Client) ChannelByID(id string) (Channel, error) {
	var channels struct {
		Items []Channel `json:"items"`
	}
	if _, err := httpx.GetJSON(ChannelsByIDURL+url.QueryEscape(id),
		c.Headers(), &channels); err != nil {
		return Channel{}, err
	}
	if len(channels.Items) == 0 {
		return Channel{}, fmt.Errorf("YouTube channel not found")
	}
	return channels.Items[0], nil
}

// SendChatMessage posts a message to a live chat. The status rides along so a
// caller can retry against a re-resolved chat id when a stale one is refused.
func (c Client) SendChatMessage(chatID, text string) (int, error) {
	return httpx.PostJSON(ChatMessagesURL+"?part=snippet", c.Headers(), map[string]any{
		"snippet": map[string]any{
			"liveChatId": chatID,
			"type":       "textMessageEvent",
			"textMessageDetails": map[string]string{
				"messageText": text,
			},
		},
	}, nil)
}

// BanUser silences a viewer in a live chat: seconds > 0 is a timeout, anything
// else a permanent ban.
func (c Client) BanUser(chatID, channelID string, seconds int) (int, error) {
	snippet := map[string]any{
		"liveChatId":        chatID,
		"type":              "permanent",
		"bannedUserDetails": map[string]string{"channelId": channelID},
	}
	if seconds > 0 {
		snippet["type"] = "temporary"
		snippet["banDurationSeconds"] = seconds
	}
	return httpx.PostJSON(ChatBansURL+"?part=snippet", c.Headers(),
		map[string]any{"snippet": snippet}, nil)
}

// DeleteChatMessage removes one message from a live chat.
func (c Client) DeleteChatMessage(messageID string) (int, error) {
	return httpx.DeleteResource(ChatMessagesURL+"?id="+url.QueryEscape(messageID),
		c.Headers())
}

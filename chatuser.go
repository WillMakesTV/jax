package main

import (
	"bp-temp/internal/httpx"
	"fmt"
	"net/url"
	"strings"
)

// ---------------------------------------------------------------------------
// Chat user lookups
//
// Clicking a chatter in the Chat view opens a profile popup. Profile data is
// not real-time, so lookups are cached for apiCacheTTL per user.
//
// Twitch follower/subscriber checks need the moderator:read:followers and
// channel:read:subscriptions scopes; connections made before those scopes
// were requested degrade to "unknown". YouTube cannot report whether a viewer
// subscribes to the broadcaster at all — membership/moderator status instead
// arrives on each chat message's authorDetails and is shown from there.
// ---------------------------------------------------------------------------

// ChatUserInfo is the profile shown in the chat user popup. Follower and
// Subscriber are "yes" | "no" | "unknown".
type ChatUserInfo struct {
	Platform    string       `json:"platform"`
	ID          string       `json:"id"`
	DisplayName string       `json:"displayName"`
	AvatarURL   string       `json:"avatarUrl"`
	Description string       `json:"description"`
	CreatedAt   string       `json:"createdAt"` // account/channel creation, RFC3339
	ChannelURL  string       `json:"channelUrl"`
	Follower    string       `json:"follower"`
	FollowedAt  string       `json:"followedAt"`
	Subscriber  string       `json:"subscriber"`
	SubTier     string       `json:"subTier"`
	Details     []DetailItem `json:"details"`
}

const (
	twitchFollowCheckURL = "https://api.twitch.tv/helix/channels/followers"
	twitchSubCheckURL    = "https://api.twitch.tv/helix/subscriptions"
	youtubeChannelByIDURL = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id="
)

// GetChatUserInfo returns profile info for one chatter. id is the platform
// user/channel id from the chat message; login is the Twitch login fallback
// used when the id is unavailable.
func (a *App) GetChatUserInfo(platform, id, login string) (ChatUserInfo, error) {
	conn, ok := a.freshConn(platform)
	if !ok {
		return ChatUserInfo{}, fmt.Errorf("%s is not connected", platformLabel(platform))
	}

	fetch := func() (ChatUserInfo, error) {
		if platform == "twitch" {
			return fetchTwitchChatUser(conn, id, login)
		}
		if platform == "youtube" {
			return fetchYouTubeChatUser(conn, id)
		}
		if platform == "kick" {
			return fetchKickChatUser(login)
		}
		if platform == "facebook" {
			return fetchFacebookChatUser(conn, id)
		}
		if platform == "instagram" {
			return fetchInstagramChatUser(conn, login)
		}
		return ChatUserInfo{}, fmt.Errorf("unknown platform %q", platform)
	}

	key := "chatuser|" + platform + "|" + firstNonEmpty(id, strings.ToLower(login))
	info, _, _, err := cachedJSON(a, key, apiCacheTTL, false, fetch)
	if err != nil {
		return ChatUserInfo{}, err
	}
	if info.Details == nil {
		info.Details = []DetailItem{}
	}
	return info, nil
}

func fetchTwitchChatUser(conn serviceConn, id, login string) (ChatUserInfo, error) {
	headers := twitchHeaders(conn)

	query := "?id=" + url.QueryEscape(id)
	if id == "" {
		if login == "" {
			return ChatUserInfo{}, fmt.Errorf("no user id or login to look up")
		}
		query = "?login=" + url.QueryEscape(strings.ToLower(login))
	}
	var users struct {
		Data []struct {
			ID              string `json:"id"`
			Login           string `json:"login"`
			DisplayName     string `json:"display_name"`
			Description     string `json:"description"`
			ProfileImageURL string `json:"profile_image_url"`
			BroadcasterType string `json:"broadcaster_type"`
			CreatedAt       string `json:"created_at"`
		} `json:"data"`
	}
	if _, err := httpx.GetJSON(twitchUsersURL+query, headers, &users); err != nil {
		return ChatUserInfo{}, err
	}
	if len(users.Data) == 0 {
		return ChatUserInfo{}, fmt.Errorf("Twitch user not found")
	}
	u := users.Data[0]

	info := ChatUserInfo{
		Platform:    "twitch",
		ID:          u.ID,
		DisplayName: firstNonEmpty(u.DisplayName, u.Login),
		AvatarURL:   u.ProfileImageURL,
		Description: u.Description,
		CreatedAt:   u.CreatedAt,
		ChannelURL:  "https://twitch.tv/" + u.Login,
		Follower:    "unknown",
		Subscriber:  "unknown",
	}
	if u.BroadcasterType != "" {
		info.Details = append(info.Details, DetailItem{"Channel type", u.BroadcasterType})
	}

	// Does this user follow the broadcaster? Requires moderator:read:followers.
	var follows struct {
		Data []struct {
			FollowedAt string `json:"followed_at"`
		} `json:"data"`
	}
	if _, err := httpx.GetJSON(
		twitchFollowCheckURL+"?broadcaster_id="+conn.userID+"&user_id="+u.ID,
		headers, &follows,
	); err == nil {
		if len(follows.Data) > 0 {
			info.Follower = "yes"
			info.FollowedAt = follows.Data[0].FollowedAt
		} else {
			info.Follower = "no"
		}
	}

	// Is this user subscribed? Requires channel:read:subscriptions.
	var subs struct {
		Data []struct {
			Tier string `json:"tier"`
		} `json:"data"`
	}
	if status, err := httpx.GetJSON(
		twitchSubCheckURL+"?broadcaster_id="+conn.userID+"&user_id="+u.ID,
		headers, &subs,
	); err == nil {
		if len(subs.Data) > 0 {
			info.Subscriber = "yes"
			switch subs.Data[0].Tier {
			case "1000":
				info.SubTier = "Tier 1"
			case "2000":
				info.SubTier = "Tier 2"
			case "3000":
				info.SubTier = "Tier 3"
			}
		} else {
			info.Subscriber = "no"
		}
	} else if status == 404 {
		// Helix reports "not subscribed" as a 404 for this endpoint.
		info.Subscriber = "no"
	}

	return info, nil
}

func fetchYouTubeChatUser(conn serviceConn, id string) (ChatUserInfo, error) {
	if id == "" {
		return ChatUserInfo{}, fmt.Errorf("no channel id to look up")
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	var channels struct {
		Items []struct {
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
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(youtubeChannelByIDURL+url.QueryEscape(id), headers, &channels); err != nil {
		return ChatUserInfo{}, err
	}
	if len(channels.Items) == 0 {
		return ChatUserInfo{}, fmt.Errorf("YouTube channel not found")
	}
	ch := channels.Items[0]

	channelURL := "https://youtube.com/channel/" + ch.ID
	if ch.Snippet.CustomURL != "" {
		channelURL = "https://youtube.com/" + ch.Snippet.CustomURL
	}
	info := ChatUserInfo{
		Platform:    "youtube",
		ID:          ch.ID,
		DisplayName: ch.Snippet.Title,
		AvatarURL: firstNonEmpty(
			ch.Snippet.Thumbnails.Medium.URL,
			ch.Snippet.Thumbnails.Default.URL,
		),
		Description: ch.Snippet.Description,
		CreatedAt:   ch.Snippet.PublishedAt,
		ChannelURL:  channelURL,
		// YouTube's API cannot report whether a viewer subscribes to the
		// broadcaster; membership shows via chat badges instead.
		Follower:   "unknown",
		Subscriber: "unknown",
	}
	info.Details = append(info.Details,
		DetailItem{"Their subscribers", fmtCount(atoi64(ch.Statistics.SubscriberCount))},
		DetailItem{"Their videos", fmtCount(atoi64(ch.Statistics.VideoCount))},
	)
	return info, nil
}

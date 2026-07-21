package main

import (
	"fmt"
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
	client := twitchClient(conn)
	u, err := client.LookupUser(id, login)
	if err != nil {
		return ChatUserInfo{}, err
	}

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
	if followedAt, err := client.FollowedAt(u.ID); err == nil {
		if followedAt != "" {
			info.Follower = "yes"
			info.FollowedAt = followedAt
		} else {
			info.Follower = "no"
		}
	}

	// Is this user subscribed? Requires channel:read:subscriptions.
	if tier, status, err := client.SubscriptionTier(u.ID); err == nil {
		if tier != "" {
			info.Subscriber = "yes"
			switch tier {
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
	ch, err := youtubeClient(conn).ChannelByID(id)
	if err != nil {
		return ChatUserInfo{}, err
	}

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

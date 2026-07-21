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
	"strings"

	"bp-temp/internal/httpx"
)

// Data API endpoints the app uses.
const (
	CategoriesURL   = "https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US"
	ChannelsByIDURL = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id="
	ChatMessagesURL = "https://www.googleapis.com/youtube/v3/liveChat/messages"
	ChatBansURL     = "https://www.googleapis.com/youtube/v3/liveChat/bans"

	UploadsPlaylistURL = "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true"
	PlaylistItemsURL   = "https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50"
	VideosURL          = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status,liveStreamingDetails&id="
	CommentThreadsURL  = "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&order=relevance&textFormat=plainText&maxResults=25&videoId="

	MyChannelURL       = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&mine=true"
	ActiveBroadcastURL = "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status&broadcastStatus=active&broadcastType=all"
	LiveVideoURL       = "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,status,liveStreamingDetails&id="
	CompletedURL       = "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet&broadcastStatus=completed&broadcastType=all&maxResults=20"
	VideoMetaURL       = "https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id="
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

// VideoItem is a video as videos.list describes it, with every part the app
// asks for: snippet, statistics, contentDetails, status and, for broadcasts,
// liveStreamingDetails.
type VideoItem struct {
	ID      string `json:"id"`
	Snippet struct {
		Title        string `json:"title"`
		Description  string `json:"description"`
		PublishedAt  string `json:"publishedAt"`
		ChannelTitle string `json:"channelTitle"`
		// "live" | "upcoming" | "none" — the definitive live-broadcast flag.
		LiveBroadcastContent string `json:"liveBroadcastContent"`
		Thumbnails           struct {
			Medium struct {
				URL string `json:"url"`
			} `json:"medium"`
			High struct {
				URL string `json:"url"`
			} `json:"high"`
		} `json:"thumbnails"`
	} `json:"snippet"`
	Statistics struct {
		ViewCount     string `json:"viewCount"`
		LikeCount     string `json:"likeCount"`
		CommentCount  string `json:"commentCount"`
		FavoriteCount string `json:"favoriteCount"`
	} `json:"statistics"`
	ContentDetails struct {
		Duration   string `json:"duration"`
		Definition string `json:"definition"`
		Caption    string `json:"caption"`
	} `json:"contentDetails"`
	Status struct {
		PrivacyStatus string `json:"privacyStatus"`
	} `json:"status"`
	LiveStreamingDetails struct {
		ScheduledStartTime string `json:"scheduledStartTime"`
		ActualStartTime    string `json:"actualStartTime"`
		ActualEndTime      string `json:"actualEndTime"`
	} `json:"liveStreamingDetails"`
}

// WasEverLive reports whether the video is, was, or will be a live broadcast
// (live, upcoming/premiere, scheduled, or a finished live VOD). Checking
// liveBroadcastContent and scheduledStartTime — not just actualStartTime —
// catches broadcasts that are currently live (actualStartTime can lag) or not
// yet started.
func (v VideoItem) WasEverLive() bool {
	if lbc := v.Snippet.LiveBroadcastContent; lbc == "live" || lbc == "upcoming" {
		return true
	}
	return v.LiveStreamingDetails.ActualStartTime != "" ||
		v.LiveStreamingDetails.ScheduledStartTime != ""
}

// UploadsPlaylistID returns the channel's uploads playlist — the canonical
// "every video on this channel" — or "" when the channel has none.
func (c Client) UploadsPlaylistID() (string, error) {
	var channels struct {
		Items []struct {
			ContentDetails struct {
				RelatedPlaylists struct {
					Uploads string `json:"uploads"`
				} `json:"relatedPlaylists"`
			} `json:"contentDetails"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(UploadsPlaylistURL, c.Headers(), &channels); err != nil {
		return "", err
	}
	if len(channels.Items) == 0 {
		return "", nil
	}
	return channels.Items[0].ContentDetails.RelatedPlaylists.Uploads, nil
}

// PlaylistVideoIDs reads one page of a playlist's video ids and the token for
// the next, which is "" on the last page.
func (c Client) PlaylistVideoIDs(playlistID, pageToken string) ([]string, string, error) {
	endpoint := PlaylistItemsURL + "&playlistId=" + url.QueryEscape(playlistID)
	if pageToken != "" {
		endpoint += "&pageToken=" + url.QueryEscape(pageToken)
	}
	var page struct {
		Items []struct {
			ContentDetails struct {
				VideoID string `json:"videoId"`
			} `json:"contentDetails"`
		} `json:"items"`
		NextPageToken string `json:"nextPageToken"`
	}
	if _, err := httpx.GetJSON(endpoint, c.Headers(), &page); err != nil {
		return nil, "", err
	}
	ids := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		if item.ContentDetails.VideoID != "" {
			ids = append(ids, item.ContentDetails.VideoID)
		}
	}
	next := page.NextPageToken
	if len(page.Items) == 0 {
		next = ""
	}
	return ids, next, nil
}

// VideosByID reads full records for up to 50 videos — the API's limit for one
// videos.list call, which callers batch against.
func (c Client) VideosByID(ids []string) ([]VideoItem, error) {
	var videos struct {
		Items []VideoItem `json:"items"`
	}
	if _, err := httpx.GetJSON(VideosURL+strings.Join(ids, ","),
		c.Headers(), &videos); err != nil {
		return nil, err
	}
	return videos.Items, nil
}

// VideoByID reads one video's full record.
func (c Client) VideoByID(id string) (VideoItem, error) {
	items, err := c.VideosByID([]string{url.QueryEscape(id)})
	if err != nil {
		return VideoItem{}, err
	}
	if len(items) == 0 {
		return VideoItem{}, fmt.Errorf("video %s not found", id)
	}
	return items[0], nil
}

// CommentThread is one top-level comment with its reply count.
type CommentThread struct {
	Author      string
	AvatarURL   string
	Text        string
	LikeCount   int64
	ReplyCount  int64
	PublishedAt string
}

// CommentThreads reads a video's top comments by relevance. A Google API key
// reads public comments directly; without one the OAuth token is used, and
// the device-authorization flow this app uses cannot request the scope
// commentThreads.list needs — so a 403 is expected rather than a failure, and
// the status is returned for the caller to say so.
func (c Client) CommentThreads(videoID, apiKey string) ([]CommentThread, int, error) {
	endpoint := CommentThreadsURL + url.QueryEscape(videoID)
	headers := c.Headers()
	if apiKey != "" {
		endpoint += "&key=" + url.QueryEscape(apiKey)
		headers = nil
	}
	var threads struct {
		Items []struct {
			Snippet struct {
				TotalReplyCount int64 `json:"totalReplyCount"`
				TopLevelComment struct {
					Snippet struct {
						AuthorDisplayName     string `json:"authorDisplayName"`
						AuthorProfileImageURL string `json:"authorProfileImageUrl"`
						TextDisplay           string `json:"textDisplay"`
						LikeCount             int64  `json:"likeCount"`
						PublishedAt           string `json:"publishedAt"`
					} `json:"snippet"`
				} `json:"topLevelComment"`
			} `json:"snippet"`
		} `json:"items"`
	}
	status, err := httpx.GetJSON(endpoint, headers, &threads)
	if err != nil {
		return nil, status, err
	}
	out := make([]CommentThread, 0, len(threads.Items))
	for _, t := range threads.Items {
		s := t.Snippet.TopLevelComment.Snippet
		out = append(out, CommentThread{
			Author:      s.AuthorDisplayName,
			AvatarURL:   s.AuthorProfileImageURL,
			Text:        s.TextDisplay,
			LikeCount:   s.LikeCount,
			ReplyCount:  t.Snippet.TotalReplyCount,
			PublishedAt: s.PublishedAt,
		})
	}
	return out, status, nil
}

// MyChannel is the connected channel's own profile, counts and branding.
type MyChannel struct {
	ID      string `json:"id"`
	Snippet struct {
		Title      string `json:"title"`
		CustomURL  string `json:"customUrl"`
		Thumbnails struct {
			High    struct{ URL string } `json:"high"`
			Medium  struct{ URL string } `json:"medium"`
			Default struct{ URL string } `json:"default"`
		} `json:"thumbnails"`
	} `json:"snippet"`
	Statistics struct {
		SubscriberCount string `json:"subscriberCount"`
		ViewCount       string `json:"viewCount"`
		VideoCount      string `json:"videoCount"`
	} `json:"statistics"`
	BrandingSettings struct {
		Image struct {
			BannerExternalURL string `json:"bannerExternalUrl"`
		} `json:"image"`
	} `json:"brandingSettings"`
}

// MyChannelInfo reads the connected channel. The status rides along so a
// caller can tell an expired token from an unreachable API.
func (c Client) MyChannelInfo() (MyChannel, int, error) {
	var channels struct {
		Items []MyChannel `json:"items"`
	}
	status, err := httpx.GetJSON(MyChannelURL, c.Headers(), &channels)
	if err != nil {
		return MyChannel{}, status, err
	}
	if len(channels.Items) == 0 {
		return MyChannel{}, status, nil
	}
	return channels.Items[0], status, nil
}

// ActiveBroadcastID returns the id of the channel's live broadcast, or ""
// when it is not broadcasting.
func (c Client) ActiveBroadcastID() (string, error) {
	var broadcasts struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if _, err := httpx.GetJSON(ActiveBroadcastURL, c.Headers(), &broadcasts); err != nil {
		return "", err
	}
	if len(broadcasts.Items) == 0 {
		return "", nil
	}
	return broadcasts.Items[0].ID, nil
}

// LiveVideo is the real-time state of a broadcast: what it is called, how it
// is doing, and — once ActualEndTime is set — that it has finished.
type LiveVideo struct {
	Snippet struct {
		Title      string `json:"title"`
		Thumbnails struct {
			Medium struct {
				URL string `json:"url"`
			} `json:"medium"`
			High struct {
				URL string `json:"url"`
			} `json:"high"`
		} `json:"thumbnails"`
	} `json:"snippet"`
	Statistics struct {
		ViewCount string `json:"viewCount"`
		LikeCount string `json:"likeCount"`
	} `json:"statistics"`
	Status struct {
		PrivacyStatus string `json:"privacyStatus"`
	} `json:"status"`
	LiveStreamingDetails struct {
		ActualStartTime   string `json:"actualStartTime"`
		ActualEndTime     string `json:"actualEndTime"`
		ConcurrentViewers string `json:"concurrentViewers"`
	} `json:"liveStreamingDetails"`
}

// LiveVideoByID reads a broadcast's live metrics. found is false when the
// video is gone, which — like a set ActualEndTime — means the broadcast is
// over.
func (c Client) LiveVideoByID(videoID string) (v LiveVideo, found bool, err error) {
	var videos struct {
		Items []LiveVideo `json:"items"`
	}
	if _, err := httpx.GetJSON(LiveVideoURL+url.QueryEscape(videoID),
		c.Headers(), &videos); err != nil {
		return LiveVideo{}, false, err
	}
	if len(videos.Items) == 0 {
		return LiveVideo{}, false, nil
	}
	return videos.Items[0], true, nil
}

// CompletedBroadcast is one finished live broadcast, as the archive lists it.
type CompletedBroadcast struct {
	ID      string `json:"id"`
	Snippet struct {
		Title           string `json:"title"`
		ActualStartTime string `json:"actualStartTime"`
		Thumbnails      struct {
			Medium struct {
				URL string `json:"url"`
			} `json:"medium"`
			High struct {
				URL string `json:"url"`
			} `json:"high"`
		} `json:"thumbnails"`
	} `json:"snippet"`
}

// CompletedBroadcasts lists the channel's finished broadcasts, newest first.
func (c Client) CompletedBroadcasts() ([]CompletedBroadcast, error) {
	var broadcasts struct {
		Items []CompletedBroadcast `json:"items"`
	}
	if _, err := httpx.GetJSON(CompletedURL, c.Headers(), &broadcasts); err != nil {
		return nil, err
	}
	return broadcasts.Items, nil
}

// VideoMeta is a video's view count and duration — the two things the past
// broadcast list enriches itself with in one call.
type VideoMeta struct {
	ID         string `json:"id"`
	Statistics struct {
		ViewCount string `json:"viewCount"`
	} `json:"statistics"`
	ContentDetails struct {
		Duration string `json:"duration"` // ISO 8601, e.g. "PT3H8M33S"
	} `json:"contentDetails"`
}

// VideoMetaByIDs reads view counts and durations for several videos at once.
func (c Client) VideoMetaByIDs(ids []string) ([]VideoMeta, error) {
	var videos struct {
		Items []VideoMeta `json:"items"`
	}
	if _, err := httpx.GetJSON(VideoMetaURL+strings.Join(ids, ","),
		c.Headers(), &videos); err != nil {
		return nil, err
	}
	return videos.Items, nil
}

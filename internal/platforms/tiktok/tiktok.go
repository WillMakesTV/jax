// Package tiktok talks to TikTok's Open API v2: the account, its videos, and
// the direct-post publishing flow.
//
// Two things shape this package. TikTok grants what the app is approved for
// rather than what it asked for, so a call must only ever request the fields
// one scope covers — asking for a field outside it fails the whole call, not
// just that field. And every response carries an error block even on success,
// so callers check it rather than trusting the status alone.
package tiktok

import (
	"net/url"

	"bp-temp/internal/httpx"
)

// Open API endpoints the app uses.
const (
	UserInfoURL      = "https://open.tiktokapis.com/v2/user/info/"
	CreatorInfoURL   = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"
	VideoInitURL     = "https://open.tiktokapis.com/v2/post/publish/video/init/"
	VideoListURL     = "https://open.tiktokapis.com/v2/video/list/"
	PublishStatusURL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
)

// Client is an authenticated TikTok caller.
type Client struct {
	Token string
}

// Headers are the auth headers every call carries.
func (c Client) Headers() map[string]string {
	return map[string]string{"Authorization": "Bearer " + c.Token}
}

// UserFields reads user/info for exactly the named fields, decoding into out.
// Only ask for fields the granted scope covers.
func (c Client) UserFields(fields string, out any) error {
	_, err := httpx.GetJSON(UserInfoURL+"?fields="+fields, c.Headers(), out)
	return err
}

// DisplayName reads just the account's display name — the one identity field
// user.info.basic always carries.
func (c Client) DisplayName() (string, error) {
	var r struct {
		Data struct {
			User struct {
				DisplayName string `json:"display_name"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := c.UserFields("display_name", &r); err != nil {
		return "", err
	}
	return r.Data.User.DisplayName, nil
}

// ListVideos reads one page of the account's videos with the given fields.
// cursor is 0 for the first page; count 0 leaves TikTok's default.
func (c Client) ListVideos(fields string, cursor int64, count int, out any) error {
	endpoint := VideoListURL + "?fields=" + url.QueryEscape(fields)
	body := map[string]any{}
	if cursor > 0 {
		body["cursor"] = cursor
	}
	if count > 0 {
		body["max_count"] = count
	}
	_, err := httpx.PostJSON(endpoint, c.Headers(), body, out)
	return err
}

// CreatorInfo reads what the account may post right now: the privacy levels
// it is allowed to use, and the interaction settings it has disabled.
func (c Client) CreatorInfo(out any) error {
	_, err := httpx.PostJSON(CreatorInfoURL, c.Headers(), map[string]any{}, out)
	return err
}

// InitPost opens a publish: either a direct post or an upload session,
// depending on the payload. The response carries the publish id and, for
// uploads, the URL the file is sent to.
func (c Client) InitPost(payload map[string]any, out any) (int, error) {
	return httpx.PostJSON(VideoInitURL, c.Headers(), payload, out)
}

// PublishStatus polls a publish's progress by its id.
func (c Client) PublishStatus(publishID string, out any) (int, error) {
	return httpx.PostJSON(PublishStatusURL, c.Headers(),
		map[string]any{"publish_id": publishID}, out)
}

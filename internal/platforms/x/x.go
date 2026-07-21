// Package x talks to X's v2 API: the account behind a token, its public
// metrics, and posting.
//
// The app is on X's Free tier, where users/me allows only a couple of dozen
// calls a day — the caller caches aggressively (see keyXChannelInfo), so this
// package stays a thin, honest wrapper and does no caching of its own.
package x

import (
	"fmt"

	"bp-temp/internal/httpx"
)

// v2 endpoints the app uses.
const (
	UsersMeURL = "https://api.x.com/2/users/me"
	TweetsURL  = "https://api.x.com/2/tweets"
)

// Client is an authenticated X caller.
type Client struct {
	Token string
}

// Headers are the auth headers every call carries.
func (c Client) Headers() map[string]string {
	return map[string]string{"Authorization": "Bearer " + c.Token}
}

// User is the account a token belongs to.
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
}

// Self reads the account the token belongs to.
func (c Client) Self() (User, error) {
	var r struct {
		Data User `json:"data"`
	}
	if _, err := httpx.GetJSON(UsersMeURL, c.Headers(), &r); err != nil {
		return User{}, err
	}
	return r.Data, nil
}

// Profile is the account with the public numbers the dashboard card shows.
type Profile struct {
	Description   string `json:"description"`
	ProfileImage  string `json:"profile_image_url"`
	PublicMetrics struct {
		Followers int64 `json:"followers_count"`
		Following int64 `json:"following_count"`
		Tweets    int64 `json:"tweet_count"`
	} `json:"public_metrics"`
}

// SelfProfile reads the account with its public metrics, avatar and bio. This
// is the expensive call on the Free tier — cache what it returns.
func (c Client) SelfProfile() (Profile, error) {
	var r struct {
		Data Profile `json:"data"`
	}
	endpoint := UsersMeURL + "?user.fields=public_metrics,profile_image_url,description"
	if _, err := httpx.GetJSON(endpoint, c.Headers(), &r); err != nil {
		return Profile{}, err
	}
	return r.Data, nil
}

// Post publishes a tweet and returns its id. The status rides along so a
// caller can separate a missing permission (401/403) from a rate limit (429).
func (c Client) Post(text string) (string, int, error) {
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	status, err := httpx.PostJSON(TweetsURL, c.Headers(),
		map[string]string{"text": text}, &resp)
	if err != nil {
		return "", status, err
	}
	if resp.Data.ID == "" {
		return "", status, fmt.Errorf("X accepted the post but returned no id")
	}
	return resp.Data.ID, status, nil
}

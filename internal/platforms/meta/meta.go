// Package meta talks to Facebook's Graph API, which serves both of the Meta
// surfaces the app uses: a Facebook Page and the Instagram Business account
// linked to it.
//
// Unlike the other platform packages this one stays deliberately generic. The
// Graph API addresses everything as "node id + field list", and which fields a
// call may ask for depends on the Page token and the permissions granted to
// it — so the field lists stay with the features that know what they need, and
// this package owns the base URL, the API version, and the auth header.
package meta

import (
	"bp-temp/internal/httpx"
)

// GraphBase is the versioned Graph API root. Bumping the version here moves
// every call at once.
const GraphBase = "https://graph.facebook.com/v21.0"

// URL builds a Graph endpoint from a path beginning with "/".
func URL(path string) string { return GraphBase + path }

// Client is an authenticated Graph caller. The token is whichever one the
// call needs: the user token for account discovery, or a Page token for
// anything the Page or its Instagram account owns.
type Client struct {
	Token string
}

// Headers are the auth headers every Graph call carries.
func (c Client) Headers() map[string]string {
	return map[string]string{"Authorization": "Bearer " + c.Token}
}

// Get reads a Graph endpoint into out. path begins with "/" and carries its
// own field list — see the package note on why that stays with the caller.
func (c Client) Get(path string, out any) (int, error) {
	return httpx.GetJSON(URL(path), c.Headers(), out)
}

// Post writes to a Graph endpoint, decoding any response into out (which may
// be nil).
func (c Client) Post(path string, payload, out any) (int, error) {
	return httpx.PostJSON(URL(path), c.Headers(), payload, out)
}

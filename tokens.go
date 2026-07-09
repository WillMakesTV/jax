package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"
)

// ---------------------------------------------------------------------------
// OAuth token refresh
//
// Access tokens are short-lived (Twitch ~4h, Google ~1h). Persisting them
// alone would leave restored connections dead within the hour, so the refresh
// token issued alongside is used to mint a fresh access token on demand.
// ---------------------------------------------------------------------------

// refreshMargin refreshes tokens this close to (or past) their expiry.
const refreshMargin = 2 * time.Minute

// tokenExpiry converts an OAuth expires_in (seconds) to an absolute time,
// returning the zero time when the platform did not report one.
func tokenExpiry(expiresIn int) time.Time {
	if expiresIn <= 0 {
		return time.Time{}
	}
	return time.Now().Add(time.Duration(expiresIn) * time.Second)
}

// freshConn returns the connection for a service, first refreshing its access
// token when it is expired or about to expire. If the refresh fails the stale
// connection is returned as-is; the subsequent API call surfaces the 401 as a
// "reconnect" message to the user.
func (a *App) freshConn(name string) (serviceConn, bool) {
	conn, ok := a.getConn(name)
	if !ok {
		return conn, false
	}
	// Meta device-login tokens have no refresh endpoint (the refreshToken
	// slot carries the Facebook USER token instead — see meta.go), so an
	// expiring token is returned as-is rather than attempting — and logging —
	// a doomed refresh on every poll. The API call surfaces the eventual 401
	// as a reconnect message.
	if name == "facebook" || name == "instagram" {
		return conn, true
	}
	// Nothing to refresh with, or the token is still comfortably valid. An
	// unknown (zero) expiry is treated as expired so restored sessions with a
	// refresh token start from a known-good access token.
	if conn.refreshToken == "" ||
		(!conn.expiresAt.IsZero() && time.Until(conn.expiresAt) > refreshMargin) {
		return conn, true
	}

	refreshed, err := refreshServiceToken(name, conn)
	if err != nil {
		log.Printf("jax: %s token refresh: %v", name, err)
		return conn, true
	}
	a.setService(name, refreshed) // also persists the new tokens
	return refreshed, true
}

// refreshServiceToken exchanges the refresh token for a new access token.
// Twitch public clients refresh with just the client ID; Google also requires
// the client secret.
func refreshServiceToken(name string, conn serviceConn) (serviceConn, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", conn.refreshToken)
	form.Set("client_id", conn.clientID)

	endpoint := twitchTokenURL
	switch name {
	case "youtube":
		endpoint = googleTokenURL
		form.Set("client_secret", conn.clientSecret)
	case "kick":
		endpoint = kickTokenURL
		form.Set("client_secret", conn.clientSecret)
	case "facebook", "instagram":
		// Meta device-login tokens (~60 days) have no refresh endpoint; the
		// refreshToken slot carries the Facebook USER token instead (see
		// meta.go). Reconnecting is the only renewal.
		return conn, fmt.Errorf("Meta tokens cannot be refreshed — reconnect in Settings → Services")
	case "x":
		// X may require HTTP Basic auth on refresh (confidential clients),
		// which postForm can't add; x.go owns the exchange.
		return refreshXToken(conn)
	case "tiktok":
		// TikTok names the fields client_key/client_secret; tiktok.go owns
		// the exchange.
		return refreshTikTokToken(conn)
	}

	body, status, err := postForm(endpoint, form)
	if err != nil {
		return conn, err
	}
	if status != http.StatusOK {
		msg := string(body)
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return conn, fmt.Errorf("refresh failed (%d): %s", status, msg)
	}

	var t struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &t); err != nil {
		return conn, err
	}
	if t.AccessToken == "" {
		return conn, fmt.Errorf("refresh response missing access token")
	}

	conn.token = t.AccessToken
	// Twitch rotates the refresh token on every refresh; Google usually omits
	// it (the original stays valid), so only replace when one is returned.
	if t.RefreshToken != "" {
		conn.refreshToken = t.RefreshToken
	}
	conn.expiresAt = tokenExpiry(t.ExpiresIn)
	return conn, nil
}

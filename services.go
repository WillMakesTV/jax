package main

import (
	"bp-temp/internal/httpx"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

// DeviceCodeInfo is returned when starting an OAuth 2.0 device-code flow. The
// frontend shows the UserCode / VerificationURI to the user and then polls.
type DeviceCodeInfo struct {
	DeviceCode      string `json:"deviceCode"`
	UserCode        string `json:"userCode"`
	VerificationURI string `json:"verificationUri"`
	Interval        int    `json:"interval"`
	ExpiresIn       int    `json:"expiresIn"`
}

// AuthPollResult is returned each time the frontend polls a pending device-code
// flow. Status is one of "pending", "complete", or "error".
type AuthPollResult struct {
	Status  string `json:"status"`
	Account string `json:"account"`
	Message string `json:"message"`
}

// ServiceStatus reflects the current connection state of a remote service.
type ServiceStatus struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
	Account   string `json:"account"`
}

// ---------------------------------------------------------------------------
// Status store
// ---------------------------------------------------------------------------

// serviceConn holds everything needed to call a platform's API on behalf of the
// connected account. Persisted to the local database (see store.go) so the
// connection survives restarts; refreshed via the refresh token when the access
// token expires.
type serviceConn struct {
	token        string    // OAuth access token
	refreshToken string    // OAuth refresh token (empty if the platform issued none)
	clientID     string    // app client ID (required by Twitch Helix headers and refresh)
	clientSecret string    // app client secret (required by Google's token refresh)
	userID       string    // Twitch broadcaster ID / YouTube channel ID
	login        string    // Twitch login (URL slug); empty for YouTube
	account      string    // display name shown in the UI
	expiresAt    time.Time // access-token expiry; zero when unknown
}

// setService records a live connection and persists it so it survives restarts.
func (a *App) setService(name string, conn serviceConn) {
	a.mu.Lock()
	// The maps are normally built at construction; an App assembled some other
	// way (a test, a future entry point) must not panic its way through a
	// connection.
	if a.conns == nil {
		a.conns = map[string]serviceConn{}
	}
	if a.statuses == nil {
		a.statuses = map[string]ServiceStatus{}
	}
	a.conns[name] = conn
	a.statuses[name] = ServiceStatus{Name: name, Connected: true, Account: conn.account}
	a.mu.Unlock()

	if a.store != nil {
		if err := a.store.saveServiceConn(name, conn); err != nil {
			log.Printf("jax: persist %s connection: %v", name, err)
		}
	}
}

// getConn returns the live connection for a service, if one exists.
func (a *App) getConn(name string) (serviceConn, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	conn, ok := a.conns[name]
	return conn, ok
}

// GetServiceStatuses returns the current connection status of the OAuth-backed
// services (Twitch, YouTube). OBS is handled entirely in the frontend. A slice
// (rather than a map) is returned so Wails reliably generates the binding type.
func (a *App) GetServiceStatuses() []ServiceStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]ServiceStatus, 0, len(a.statuses))
	for _, v := range a.statuses {
		out = append(out, v)
	}
	return out
}

// DisconnectService clears the stored session and marks the service disconnected.
func (a *App) DisconnectService(name string) {
	a.mu.Lock()
	delete(a.conns, name)
	a.statuses[name] = ServiceStatus{Name: name, Connected: false}
	a.mu.Unlock()

	if a.store != nil {
		if err := a.store.deleteServiceConn(name); err != nil {
			log.Printf("jax: remove %s connection: %v", name, err)
		}
	}
}

func (a *App) openBrowser(uri string) {
	if a.ctx != nil && uri != "" {
		wruntime.BrowserOpenURL(a.ctx, uri)
	}
}

// pendingResult maps an OAuth error code to a poll result. The device-code spec
// uses "authorization_pending" (keep waiting) and "slow_down" (back off).
func pendingResult(errCode string) (AuthPollResult, bool) {
	switch errCode {
	case "authorization_pending":
		return AuthPollResult{Status: "pending"}, true
	case "slow_down":
		return AuthPollResult{Status: "pending", Message: "slow_down"}, true
	}
	return AuthPollResult{}, false
}

// ---------------------------------------------------------------------------
// Twitch — Device Code Grant Flow
// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
// ---------------------------------------------------------------------------

const (
	twitchDeviceURL = "https://id.twitch.tv/oauth2/device"
	twitchTokenURL  = "https://id.twitch.tv/oauth2/token"
	twitchUsersURL  = "https://api.twitch.tv/helix/users"
)

// StartTwitchDeviceAuth requests a device code and opens the verification page
// in the user's browser. `scopes` is a space-delimited scope list (may be empty
// for a basic read-only connection).
func (a *App) StartTwitchDeviceAuth(clientID, scopes string) (DeviceCodeInfo, error) {
	if strings.TrimSpace(clientID) == "" {
		return DeviceCodeInfo{}, fmt.Errorf("a Twitch Client ID is required")
	}
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("scopes", scopes)

	body, status, err := postForm(twitchDeviceURL, form)
	if err != nil {
		return DeviceCodeInfo{}, err
	}
	if status != http.StatusOK {
		return DeviceCodeInfo{}, fmt.Errorf("Twitch device request failed (%d): %s", status, string(body))
	}

	var r struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		Interval        int    `json:"interval"`
		ExpiresIn       int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return DeviceCodeInfo{}, err
	}

	a.openBrowser(r.VerificationURI)
	return DeviceCodeInfo{
		DeviceCode:      r.DeviceCode,
		UserCode:        r.UserCode,
		VerificationURI: r.VerificationURI,
		Interval:        r.Interval,
		ExpiresIn:       r.ExpiresIn,
	}, nil
}

// PollTwitchDeviceAuth exchanges the device code for a token. The frontend calls
// this every `interval` seconds until status is "complete" or "error".
func (a *App) PollTwitchDeviceAuth(clientID, deviceCode, scopes string) (AuthPollResult, error) {
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("device_code", deviceCode)
	form.Set("scopes", scopes)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")

	body, status, err := postForm(twitchTokenURL, form)
	if err != nil {
		return AuthPollResult{}, err
	}

	if status == http.StatusOK {
		var t struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int    `json:"expires_in"`
		}
		if err := json.Unmarshal(body, &t); err != nil {
			return AuthPollResult{}, err
		}
		user := a.fetchTwitchUser(clientID, t.AccessToken)
		a.setService("twitch", serviceConn{
			token:        t.AccessToken,
			refreshToken: t.RefreshToken,
			clientID:     clientID,
			userID:       user.id,
			login:        user.login,
			account:      user.display,
			expiresAt:    tokenExpiry(t.ExpiresIn),
		})
		return AuthPollResult{Status: "complete", Account: user.display}, nil
	}

	// Errors arrive as JSON. Twitch uses the `message` field; tolerate `error`.
	var e struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	_ = json.Unmarshal(body, &e)
	code := strings.ToLower(strings.TrimSpace(e.Message + " " + e.Error))
	if strings.Contains(code, "authorization_pending") || code == "" {
		return AuthPollResult{Status: "pending"}, nil
	}
	if strings.Contains(code, "slow_down") {
		return AuthPollResult{Status: "pending", Message: "slow_down"}, nil
	}
	return AuthPollResult{Status: "error", Message: firstNonEmpty(e.Message, e.Error)}, nil
}

// twitchUser identifies the token's owner. The broadcaster ID is what the
// Helix live-stream endpoints key on.
type twitchUser struct {
	id      string
	login   string
	display string
}

func (a *App) fetchTwitchUser(clientID, token string) twitchUser {
	fallback := twitchUser{display: "Twitch account"}
	req, err := http.NewRequest(http.MethodGet, twitchUsersURL, nil)
	if err != nil {
		return fallback
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", clientID)
	resp, err := httpx.Client.Do(req)
	if err != nil {
		return fallback
	}
	defer resp.Body.Close()

	var r struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
			Login       string `json:"login"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil || len(r.Data) == 0 {
		return fallback
	}
	u := r.Data[0]
	return twitchUser{
		id:      u.ID,
		login:   u.Login,
		display: firstNonEmpty(u.DisplayName, u.Login, "Twitch account"),
	}
}

// ---------------------------------------------------------------------------
// YouTube (Google) — OAuth 2.0 for limited-input devices
// https://developers.google.com/identity/protocols/oauth2/limited-input-device
// ---------------------------------------------------------------------------

const (
	googleDeviceURL = "https://oauth2.googleapis.com/device/code"
	googleTokenURL  = "https://oauth2.googleapis.com/token"
	// The full youtube scope covers reading plus live-chat writes (broadcast
	// messages). It must be one of the scopes Google's limited-input device
	// flow allows — youtube.force-ssl is NOT (the device-code request itself
	// fails with invalid_scope), and youtube.readonly cannot send chat.
	youtubeScope      = "https://www.googleapis.com/auth/youtube"
	youtubeChannelURL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"
)

// StartYouTubeDeviceAuth requests a Google device code for the YouTube
// read-only scope and opens the verification page in the browser.
func (a *App) StartYouTubeDeviceAuth(clientID string) (DeviceCodeInfo, error) {
	if strings.TrimSpace(clientID) == "" {
		return DeviceCodeInfo{}, fmt.Errorf("a Google Client ID is required")
	}
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("scope", youtubeScope)

	body, status, err := postForm(googleDeviceURL, form)
	if err != nil {
		return DeviceCodeInfo{}, err
	}
	if status != http.StatusOK {
		return DeviceCodeInfo{}, fmt.Errorf("Google device request failed (%d): %s", status, string(body))
	}

	var r struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURL string `json:"verification_url"`
		Interval        int    `json:"interval"`
		ExpiresIn       int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return DeviceCodeInfo{}, err
	}

	a.openBrowser(r.VerificationURL)
	return DeviceCodeInfo{
		DeviceCode:      r.DeviceCode,
		UserCode:        r.UserCode,
		VerificationURI: r.VerificationURL,
		Interval:        r.Interval,
		ExpiresIn:       r.ExpiresIn,
	}, nil
}

// PollYouTubeDeviceAuth exchanges the device code for a token. Google's device
// flow requires the client secret in the token request.
func (a *App) PollYouTubeDeviceAuth(clientID, clientSecret, deviceCode string) (AuthPollResult, error) {
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("device_code", deviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")

	body, status, err := postForm(googleTokenURL, form)
	if err != nil {
		return AuthPollResult{}, err
	}

	if status == http.StatusOK {
		var t struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int    `json:"expires_in"`
		}
		if err := json.Unmarshal(body, &t); err != nil {
			return AuthPollResult{}, err
		}
		channelID, title := a.fetchYouTubeChannel(t.AccessToken)
		a.setService("youtube", serviceConn{
			token:        t.AccessToken,
			refreshToken: t.RefreshToken,
			clientID:     clientID,
			clientSecret: clientSecret,
			userID:       channelID,
			account:      title,
			expiresAt:    tokenExpiry(t.ExpiresIn),
		})
		return AuthPollResult{Status: "complete", Account: title}, nil
	}

	// Google returns errors in the `error` field.
	var e struct {
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	_ = json.Unmarshal(body, &e)
	if res, ok := pendingResult(e.Error); ok {
		return res, nil
	}
	return AuthPollResult{Status: "error", Message: firstNonEmpty(e.ErrorDescription, e.Error)}, nil
}

// fetchYouTubeChannel returns the token owner's channel ID and title.
func (a *App) fetchYouTubeChannel(token string) (channelID, title string) {
	fallbackTitle := "YouTube channel"
	req, err := http.NewRequest(http.MethodGet, youtubeChannelURL, nil)
	if err != nil {
		return "", fallbackTitle
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := httpx.Client.Do(req)
	if err != nil {
		return "", fallbackTitle
	}
	defer resp.Body.Close()

	var r struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil || len(r.Items) == 0 {
		return "", fallbackTitle
	}
	return r.Items[0].ID, firstNonEmpty(r.Items[0].Snippet.Title, fallbackTitle)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func postForm(endpoint string, form url.Values) ([]byte, int, error) {
	resp, err := httpx.Client.PostForm(endpoint, form)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

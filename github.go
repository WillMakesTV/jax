package main

import (
	"bp-temp/internal/httpx"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ---------------------------------------------------------------------------
// GitHub — OAuth Device Flow
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
//
// The Development tab's "Connect GitHub" section (shown while AI Debugging is
// enabled). The connection identifies the GitHub user and the repository the
// AI-debugging workflow files issues and pushes fixes against. The OAuth app
// must have Device Flow enabled; the same user-code + poll UX as Twitch.
// ---------------------------------------------------------------------------

const (
	githubDeviceURL = "https://github.com/login/device/code"
	githubTokenURL  = "https://github.com/login/oauth/access_token"
	githubUserURL   = "https://api.github.com/user"
	// Full repo scope: the debugging workflow reads and writes issues and
	// pushes fixes, on private repositories too.
	githubScope = "repo"
)

// GitHubConnection is the Development tab's view of the GitHub link: whether
// a token is stored, whose it is, and the repository debug work targets.
type GitHubConnection struct {
	Connected bool   `json:"connected"`
	Account   string `json:"account"`
	Repo      string `json:"repo"` // "owner/repo", '' when not set
}

// githubPostForm is postForm with the Accept header GitHub's OAuth endpoints
// require — without it they answer form-encoded, not JSON.
func githubPostForm(endpoint string, form url.Values) ([]byte, int, error) {
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := httpx.Client.Do(req)
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

// StartGitHubDeviceAuth requests a device code and opens the verification page
// in the user's browser.
func (a *App) StartGitHubDeviceAuth(clientID string) (DeviceCodeInfo, error) {
	if strings.TrimSpace(clientID) == "" {
		return DeviceCodeInfo{}, fmt.Errorf("a GitHub OAuth app Client ID is required")
	}
	form := url.Values{}
	form.Set("client_id", strings.TrimSpace(clientID))
	form.Set("scope", githubScope)

	body, status, err := githubPostForm(githubDeviceURL, form)
	if err != nil {
		return DeviceCodeInfo{}, err
	}
	if status != http.StatusOK {
		return DeviceCodeInfo{}, fmt.Errorf("GitHub device request failed (%d): %s", status, string(body))
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
	if r.DeviceCode == "" {
		return DeviceCodeInfo{}, fmt.Errorf("GitHub device request returned no code: %s", string(body))
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

// PollGitHubDeviceAuth exchanges the device code for a token. The frontend
// calls this every `interval` seconds until status is "complete" or "error".
// GitHub answers 200 even for pending/error states, so the JSON error field
// is what drives the result.
func (a *App) PollGitHubDeviceAuth(clientID, deviceCode string) (AuthPollResult, error) {
	form := url.Values{}
	form.Set("client_id", strings.TrimSpace(clientID))
	form.Set("device_code", deviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")

	body, _, err := githubPostForm(githubTokenURL, form)
	if err != nil {
		return AuthPollResult{}, err
	}

	var r struct {
		AccessToken      string `json:"access_token"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return AuthPollResult{}, err
	}
	if r.AccessToken == "" {
		if result, ok := pendingResult(r.Error); ok {
			return result, nil
		}
		return AuthPollResult{
			Status:  "error",
			Message: firstNonEmpty(r.ErrorDescription, r.Error, "authorization failed"),
		}, nil
	}

	account := a.fetchGitHubUser(r.AccessToken)
	a.setService("github", serviceConn{
		token:    r.AccessToken,
		clientID: strings.TrimSpace(clientID),
		login:    account,
		account:  account,
	})
	return AuthPollResult{Status: "complete", Account: account}, nil
}

// fetchGitHubUser resolves the token's owner login for display.
func (a *App) fetchGitHubUser(token string) string {
	const fallback = "GitHub account"
	req, err := http.NewRequest(http.MethodGet, githubUserURL, nil)
	if err != nil {
		return fallback
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := httpx.Client.Do(req)
	if err != nil {
		return fallback
	}
	defer resp.Body.Close()

	var r struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil || r.Login == "" {
		return fallback
	}
	return r.Login
}

// githubRepoPattern is the "owner/repo" shape SetGitHubRepo accepts.
var githubRepoPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9._-]+$`)

// GetGitHubConnection reports the stored GitHub link and target repository.
func (a *App) GetGitHubConnection() GitHubConnection {
	out := GitHubConnection{}
	if conn, ok := a.getConn("github"); ok {
		out.Connected = true
		out.Account = conn.account
	}
	if a.store != nil {
		repo, err := a.store.getSetting(keyGitHubRepo)
		if err != nil {
			log.Printf("jax: read github repo: %v", err)
		}
		out.Repo = repo
	}
	return out
}

// SetGitHubRepo stores the "owner/repo" the AI-debugging workflow targets.
// A blank value clears it.
func (a *App) SetGitHubRepo(repo string) error {
	if a.store == nil {
		return fmt.Errorf("store is not open")
	}
	repo = strings.TrimSpace(repo)
	if repo != "" && !githubRepoPattern.MatchString(repo) {
		return fmt.Errorf("the repository must be in owner/repo form (e.g. octocat/hello-world)")
	}
	return a.store.setSetting(keyGitHubRepo, repo)
}

// DisconnectGitHub clears the stored GitHub session.
func (a *App) DisconnectGitHub() {
	a.DisconnectService("github")
}

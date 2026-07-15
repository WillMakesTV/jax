package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// X (Twitter)
//
// X has no live-video API surface — Periscope's API is long gone, and X Live
// (Media Studio) exposes neither live status nor chat. What the API offers a
// streaming brand is identity and reach:
//
//   - OAuth 2.0 authorization-code + PKCE (loopback redirect on a FIXED
//     port, like Kick): http://localhost:53518/x/callback must be registered
//     verbatim on the X app. Public (no secret) and confidential clients are
//     both supported; offline.access keeps a refresh token.
//   - Dashboard channel card: the account's public metrics (followers,
//     following, posts) via GET /2/users/me — cached hard (6h) because the
//     Free API tier allows very few users/me calls per day.
//   - Go-live announcements: a plan targeting X posts ONE announcement (the
//     plan's title + the connected channels' links) via POST /2/tweets when
//     the stream session is actually on the air — never during off-air
//     "Update Stream Info" rehearsals, and never twice for the same plan.
//
// No chat, events, VODs, or videos — X's pricing gates reads (search,
// timelines) behind paid tiers, and none of them are live-stream surfaces.
// ---------------------------------------------------------------------------

const (
	xAuthorizeURL = "https://x.com/i/oauth2/authorize"
	xTokenURL     = "https://api.x.com/2/oauth2/token"
	xUsersMeURL   = "https://api.x.com/2/users/me"
	xTweetsURL    = "https://api.x.com/2/tweets"

	// xScopes: read the own account, post announcements, and keep a refresh
	// token (offline.access).
	xScopes = "tweet.read tweet.write users.read offline.access"

	// xRedirectPort is fixed for the same reason as Kick's: the registered
	// redirect URI must match verbatim.
	xRedirectPort = 53518
	xRedirectPath = "/x/callback"
)

var xRedirectURI = fmt.Sprintf("http://localhost:%d%s", xRedirectPort, xRedirectPath)

// XRedirectURI exposes the redirect URI to the connect form.
func (a *App) XRedirectURI() string {
	return xRedirectURI
}

// xAuthState is one in-flight browser sign-in.
type xAuthState struct {
	state        string
	verifier     string
	clientID     string
	clientSecret string
	server       *http.Server
	result       *AuthPollResult
}

// xTokenForm posts to the token endpoint, adding HTTP Basic auth for
// confidential clients (X requires it when the app has a secret).
func xTokenForm(form url.Values, clientID, clientSecret string) ([]byte, int, error) {
	req, err := http.NewRequest(http.MethodPost, xTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if clientSecret != "" {
		req.SetBasicAuth(clientID, clientSecret)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body := make([]byte, 0)
	buf := make([]byte, 4096)
	for {
		n, rerr := resp.Body.Read(buf)
		body = append(body, buf[:n]...)
		if rerr != nil {
			break
		}
	}
	return body, resp.StatusCode, nil
}

// StartXAuth begins the authorization-code + PKCE sign-in: starts the
// loopback callback listener, opens the browser on X's consent page, and
// returns the authorize URL. The frontend then polls PollXAuth. The client
// secret is optional — X native/public clients don't have one.
func (a *App) StartXAuth(clientID, clientSecret string) (string, error) {
	clientID = strings.TrimSpace(clientID)
	clientSecret = strings.TrimSpace(clientSecret)
	if clientID == "" {
		return "", fmt.Errorf("an X Client ID is required")
	}

	verifier, err := randBase64(48)
	if err != nil {
		return "", err
	}
	state, err := randBase64(24)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	a.CancelXAuth()

	mux := http.NewServeMux()
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", xRedirectPort), Handler: mux}
	auth := &xAuthState{
		state:        state,
		verifier:     verifier,
		clientID:     clientID,
		clientSecret: clientSecret,
		server:       server,
	}
	mux.HandleFunc(xRedirectPath, func(w http.ResponseWriter, r *http.Request) {
		a.handleXCallback(auth, w, r)
	})

	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return "", fmt.Errorf(
			"could not open the sign-in listener on port %d (is another app using it?): %v",
			xRedirectPort, err)
	}

	a.mu.Lock()
	a.xAuth = auth
	a.mu.Unlock()

	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("jax: x auth listener: %v", err)
		}
	}()
	go func(s *xAuthState) {
		time.Sleep(5 * time.Minute)
		a.mu.Lock()
		lingering := a.xAuth == s && s.result == nil
		a.mu.Unlock()
		if lingering {
			a.CancelXAuth()
		}
	}(auth)

	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", xRedirectURI)
	q.Set("scope", xScopes)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	authorize := xAuthorizeURL + "?" + q.Encode()

	a.openBrowser(authorize)
	return authorize, nil
}

// handleXCallback receives the browser redirect, exchanges the code, and
// records the outcome for PollXAuth.
func (a *App) handleXCallback(auth *xAuthState, w http.ResponseWriter, r *http.Request) {
	finish := func(res AuthPollResult, page string) {
		a.mu.Lock()
		if a.xAuth == auth {
			auth.result = &res
		}
		a.mu.Unlock()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, "<html><body style=\"font-family:sans-serif;padding:2rem\"><h3>%s</h3><p>You can close this tab and return to the app.</p></body></html>", page)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = auth.server.Shutdown(ctx)
		}()
	}

	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		finish(AuthPollResult{Status: "error", Message: firstNonEmpty(q.Get("error_description"), e)},
			"X sign-in failed")
		return
	}
	if q.Get("state") != auth.state {
		finish(AuthPollResult{Status: "error", Message: "state mismatch — try connecting again"},
			"X sign-in failed")
		return
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", auth.clientID)
	form.Set("redirect_uri", xRedirectURI)
	form.Set("code_verifier", auth.verifier)
	form.Set("code", q.Get("code"))

	body, status, err := xTokenForm(form, auth.clientID, auth.clientSecret)
	if err != nil {
		finish(AuthPollResult{Status: "error", Message: err.Error()}, "X sign-in failed")
		return
	}
	if status != http.StatusOK {
		msg := string(body)
		if len(msg) > 200 {
			msg = msg[:200]
		}
		finish(AuthPollResult{Status: "error", Message: fmt.Sprintf("token exchange failed (%d): %s", status, msg)},
			"X sign-in failed")
		return
	}

	var t struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &t); err != nil || t.AccessToken == "" {
		finish(AuthPollResult{Status: "error", Message: "unexpected token response"}, "X sign-in failed")
		return
	}

	user := fetchXUser(t.AccessToken)
	a.setService("x", serviceConn{
		token:        t.AccessToken,
		refreshToken: t.RefreshToken,
		clientID:     auth.clientID,
		clientSecret: auth.clientSecret,
		userID:       user.id,
		login:        user.username,
		account:      firstNonEmpty("@"+user.username, user.name, "X account"),
		expiresAt:    tokenExpiry(t.ExpiresIn),
	})
	finish(AuthPollResult{Status: "complete", Account: "@" + user.username}, "X connected 🎉")
}

// PollXAuth reports the state of the in-flight browser sign-in.
func (a *App) PollXAuth() AuthPollResult {
	a.mu.Lock()
	auth := a.xAuth
	a.mu.Unlock()
	if auth == nil {
		return AuthPollResult{Status: "error", Message: "no X sign-in is in progress"}
	}
	a.mu.Lock()
	res := auth.result
	if res != nil {
		a.xAuth = nil
	}
	a.mu.Unlock()
	if res == nil {
		return AuthPollResult{Status: "pending"}
	}
	return *res
}

// CancelXAuth abandons a pending sign-in and frees the callback port.
func (a *App) CancelXAuth() {
	a.mu.Lock()
	auth := a.xAuth
	a.xAuth = nil
	a.mu.Unlock()
	if auth != nil && auth.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = auth.server.Shutdown(ctx)
	}
}

// refreshXToken exchanges the refresh token (offline.access) for new tokens.
// Called from tokens.go; X rotates the refresh token on every refresh.
func refreshXToken(conn serviceConn) (serviceConn, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", conn.refreshToken)
	form.Set("client_id", conn.clientID)

	body, status, err := xTokenForm(form, conn.clientID, conn.clientSecret)
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
	if err := json.Unmarshal(body, &t); err != nil || t.AccessToken == "" {
		return conn, fmt.Errorf("unexpected refresh response")
	}
	conn.token = t.AccessToken
	if t.RefreshToken != "" {
		conn.refreshToken = t.RefreshToken
	}
	conn.expiresAt = tokenExpiry(t.ExpiresIn)
	return conn, nil
}

// xUser identifies the token's owner.
type xUser struct {
	id       string
	username string
	name     string
}

func fetchXUser(token string) xUser {
	fallback := xUser{name: "X account"}
	var r struct {
		Data struct {
			ID       string `json:"id"`
			Username string `json:"username"`
			Name     string `json:"name"`
		} `json:"data"`
	}
	if _, err := getJSON(xUsersMeURL, map[string]string{"Authorization": "Bearer " + token}, &r); err != nil {
		return fallback
	}
	return xUser{id: r.Data.ID, username: r.Data.Username, name: r.Data.Name}
}

// ---------------------------------------------------------------------------
// Dashboard channel card
// ---------------------------------------------------------------------------

// keyXChannelInfo caches the account's public metrics. The TTL is long (see
// xProfileTTL) because the Free API tier allows only a couple dozen users/me
// calls per day.
const keyXChannelInfo = "x_channel_info_v2"

const xProfileTTL = 6 * time.Hour

type xChannelInfo struct {
	Followers string `json:"followers"`
	Following string `json:"following"`
	Posts     string `json:"posts"`
	// The raw counts, for the aggregate hero and the daily history (see
	// metrics.go); the strings above are formatted for display.
	FollowersN int64 `json:"followersN"`
	PostsN     int64 `json:"postsN"`
	Avatar    string `json:"avatar"`
	Bio       string `json:"bio"`
}

// fetchXLive fills the Dashboard card. X exposes no live-video state, so the
// card is channel data only (Live stays false, which the UI renders as the
// channel-details card).
func (a *App) fetchXLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:     "x",
		ChannelName:  conn.account,
		ChannelLogin: conn.login,
		ChannelURL:   "https://x.com/" + conn.login,
		StreamURL:    "https://x.com/" + conn.login,
		Details:      []DetailItem{},
	}

	info, _, _, err := cachedJSON(a, keyXChannelInfo, xProfileTTL, false, func() (xChannelInfo, error) {
		out := xChannelInfo{}
		var r struct {
			Data struct {
				Description   string `json:"description"`
				ProfileImage  string `json:"profile_image_url"`
				PublicMetrics struct {
					Followers int64 `json:"followers_count"`
					Following int64 `json:"following_count"`
					Tweets    int64 `json:"tweet_count"`
				} `json:"public_metrics"`
			} `json:"data"`
		}
		endpoint := xUsersMeURL + "?user.fields=public_metrics,profile_image_url,description"
		if _, err := getJSON(endpoint, map[string]string{"Authorization": "Bearer " + conn.token}, &r); err != nil {
			return out, err
		}
		out.Followers = fmtCount(r.Data.PublicMetrics.Followers)
		out.Following = fmtCount(r.Data.PublicMetrics.Following)
		out.Posts = fmtCount(r.Data.PublicMetrics.Tweets)
		out.FollowersN = r.Data.PublicMetrics.Followers
		out.PostsN = r.Data.PublicMetrics.Tweets
		// X serves a tiny avatar by default; ask for the 400x400 variant.
		out.Avatar = strings.Replace(r.Data.ProfileImage, "_normal.", "_400x400.", 1)
		out.Bio = r.Data.Description
		return out, nil
	})
	if err != nil {
		log.Printf("jax: x profile: %v", err)
		if strings.Contains(err.Error(), "(401)") {
			ls.Error = errReauth
		} else if strings.Contains(err.Error(), "(429)") {
			ls.Error = "X API rate limit reached — the card refreshes later."
		} else {
			ls.Error = "Could not reach the X API."
		}
		return ls
	}
	ls.AvatarURL = info.Avatar
	if info.Followers != "" {
		ls.Details = append(ls.Details, DetailItem{"Followers", info.Followers})
	}
	if info.Following != "" {
		ls.Details = append(ls.Details, DetailItem{"Following", info.Following})
	}
	if info.Posts != "" {
		ls.Details = append(ls.Details, DetailItem{"Posts", info.Posts})
	}
	return ls
}

// ---------------------------------------------------------------------------
// Go-live announcements (shared plumbing in announce.go)
// ---------------------------------------------------------------------------

// applyPlanToX posts the plan's go-live announcement — once per plan, and
// only while the plan's stream session is actually on the air. Off-air
// rehearsals ("Update Stream Info") report what will happen instead of
// posting. Returns "" on success or nothing-to-do, else a warning.
func (a *App) applyPlanToX(plan PlannedStream, _ *ContentSeries) string {
	conn, ok := a.freshConn("x")
	if !ok {
		return "X is not connected — no announcement was posted."
	}
	if a.planAnnounced("x", plan.ID) {
		return "" // already announced; nothing to redo
	}
	session := a.GetActiveStreamSession()
	if !session.Active || session.PlanID != plan.ID {
		return "X: the go-live announcement posts once the stream is on the air."
	}

	// X counts every link as 23 chars; a conservative 270-rune budget stays
	// safely under the 280 cap.
	text := announcementBody(broadcastBaseTitle(plan), a.watchLinks(2), 270)
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	status, err := postJSON(xTweetsURL, map[string]string{"Authorization": "Bearer " + conn.token},
		map[string]string{"text": text}, &resp)
	if err != nil {
		log.Printf("jax: x announce: %v", err)
		if status == 401 || status == 403 {
			return "X: reconnect in Settings → Services to grant posting permission."
		}
		if status == 429 {
			return "X: the API rate limit blocked the announcement — post it manually."
		}
		return "X: the announcement could not be posted."
	}

	a.markAnnounced("x", plan.ID, resp.Data.ID)
	return ""
}

// xInfoStatus reports the announcement state for the Broadcast page's
// per-channel check. The Detail keeps an unposted announcement from blocking
// Go Live — posting happens as part of going live, not before it.
func (a *App) xInfoStatus(plan PlannedStream) PlanChannelInfo {
	info := PlanChannelInfo{Channel: "x", WantTitle: broadcastBaseTitle(plan)}
	_, ok := a.freshConn("x")
	info.Connected = ok
	if !ok {
		info.Detail = "X is not connected."
		return info
	}
	if a.planAnnounced("x", plan.ID) {
		info.Matches = true
		info.CurrentTitle = "Announcement posted"
		return info
	}
	info.Detail = "The go-live announcement posts once the stream is on the air."
	return info
}

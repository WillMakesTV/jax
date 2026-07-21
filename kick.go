package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Kick
//
// Kick's public API (https://docs.kick.com) authenticates with OAuth 2.1
// authorization-code + PKCE — there is no device-code flow like Twitch's or
// Google's. The app therefore runs a one-shot loopback redirect listener on a
// FIXED port (the redirect URI must be registered verbatim on the Kick app):
//
//	http://localhost:53517/kick/callback
//
// StartKickAuth opens the browser and starts the listener; the frontend polls
// PollKickAuth (same AuthPollResult contract as the device flows) until the
// callback lands and the token exchange completes.
//
// API surface used:
//   - official (api.kick.com/public/v1): users, channels (read + PATCH title/
//     category), livestreams, categories search, chat send.
//   - unofficial (kick.com/api/v2): VOD list and the chatroom id — the
//     official API has no VOD or chat-read endpoints; chat reading happens in
//     the frontend over Kick's public Pusher websocket (see lib/kickChat.ts).
//     These sit behind Cloudflare and may intermittently refuse non-browser
//     clients; failures degrade to empty results.
// ---------------------------------------------------------------------------

const (
	kickAuthorizeURL   = "https://id.kick.com/oauth/authorize"
	kickTokenURL       = "https://id.kick.com/oauth/token"
	kickUsersURL       = "https://api.kick.com/public/v1/users"
	kickChannelsURL    = "https://api.kick.com/public/v1/channels"
	kickCategoriesURL  = "https://api.kick.com/public/v1/categories"
	kickChatSendURL    = "https://api.kick.com/public/v1/chat"
	kickUnofficialBase = "https://kick.com/api/v2"

	// kickScopes covers reading the channel, updating stream info, and
	// sending chat as the broadcaster.
	kickScopes = "user:read channel:read channel:write chat:write"

	// kickRedirectPort is fixed: the redirect URI registered on the Kick app
	// must match exactly, so an ephemeral port would break every user's app
	// configuration.
	kickRedirectPort = 53517
	kickRedirectPath = "/kick/callback"
)

// kickRedirectURI is the exact redirect URI to register on the Kick app.
var kickRedirectURI = fmt.Sprintf("http://localhost:%d%s", kickRedirectPort, kickRedirectPath)

// KickRedirectURI exposes the redirect URI to the frontend so the connect
// form can show what to register on dev.kick.com.
func (a *App) KickRedirectURI() string {
	return kickRedirectURI
}

// kickAuthState is one in-flight browser sign-in.
type kickAuthState struct {
	state        string
	verifier     string
	clientID     string
	clientSecret string
	server       *http.Server
	// result is nil while the callback is still pending.
	result *AuthPollResult
}

// randBase64 returns n random bytes as unpadded URL-safe base64.
func randBase64(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// StartKickAuth begins the authorization-code + PKCE sign-in: it starts the
// loopback callback listener, opens the browser on Kick's consent page, and
// returns the authorize URL (shown as a fallback link). The frontend then
// polls PollKickAuth.
func (a *App) StartKickAuth(clientID, clientSecret string) (string, error) {
	clientID = strings.TrimSpace(clientID)
	clientSecret = strings.TrimSpace(clientSecret)
	if clientID == "" || clientSecret == "" {
		return "", fmt.Errorf("a Kick Client ID and Client Secret are required")
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

	// One sign-in at a time: tear down any previous pending listener.
	a.CancelKickAuth()

	mux := http.NewServeMux()
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", kickRedirectPort), Handler: mux}
	auth := &kickAuthState{
		state:        state,
		verifier:     verifier,
		clientID:     clientID,
		clientSecret: clientSecret,
		server:       server,
	}
	mux.HandleFunc(kickRedirectPath, func(w http.ResponseWriter, r *http.Request) {
		a.handleKickCallback(auth, w, r)
	})

	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return "", fmt.Errorf(
			"could not open the sign-in listener on port %d (is another app using it?): %v",
			kickRedirectPort, err)
	}

	a.mu.Lock()
	a.kickAuth = auth
	a.mu.Unlock()

	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("jax: kick auth listener: %v", err)
		}
	}()
	// A forgotten consent page must not hold the port forever.
	go func(s *kickAuthState) {
		time.Sleep(5 * time.Minute)
		a.mu.Lock()
		lingering := a.kickAuth == s && s.result == nil
		a.mu.Unlock()
		if lingering {
			a.CancelKickAuth()
		}
	}(auth)

	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", kickRedirectURI)
	q.Set("scope", kickScopes)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	authorize := kickAuthorizeURL + "?" + q.Encode()

	a.openBrowser(authorize)
	return authorize, nil
}

// handleKickCallback receives the browser redirect, exchanges the code, and
// records the outcome for PollKickAuth.
func (a *App) handleKickCallback(auth *kickAuthState, w http.ResponseWriter, r *http.Request) {
	finish := func(res AuthPollResult, page string) {
		a.mu.Lock()
		if a.kickAuth == auth {
			auth.result = &res
		}
		a.mu.Unlock()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, "<html><body style=\"font-family:sans-serif;padding:2rem\"><h3>%s</h3><p>You can close this tab and return to the app.</p></body></html>", page)
		// The listener has served its purpose; free the port.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = auth.server.Shutdown(ctx)
		}()
	}

	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		finish(AuthPollResult{Status: "error", Message: firstNonEmpty(q.Get("error_description"), e)},
			"Kick sign-in failed")
		return
	}
	if q.Get("state") != auth.state {
		finish(AuthPollResult{Status: "error", Message: "state mismatch — try connecting again"},
			"Kick sign-in failed")
		return
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", auth.clientID)
	form.Set("client_secret", auth.clientSecret)
	form.Set("redirect_uri", kickRedirectURI)
	form.Set("code_verifier", auth.verifier)
	form.Set("code", q.Get("code"))

	body, status, err := postForm(kickTokenURL, form)
	if err != nil {
		finish(AuthPollResult{Status: "error", Message: err.Error()}, "Kick sign-in failed")
		return
	}
	if status != http.StatusOK {
		msg := string(body)
		if len(msg) > 200 {
			msg = msg[:200]
		}
		finish(AuthPollResult{Status: "error", Message: fmt.Sprintf("token exchange failed (%d): %s", status, msg)},
			"Kick sign-in failed")
		return
	}

	var t struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &t); err != nil || t.AccessToken == "" {
		finish(AuthPollResult{Status: "error", Message: "unexpected token response"}, "Kick sign-in failed")
		return
	}

	user := fetchKickUser(t.AccessToken)
	slug := fetchKickSlug(t.AccessToken)
	a.setService("kick", serviceConn{
		token:        t.AccessToken,
		refreshToken: t.RefreshToken,
		clientID:     auth.clientID,
		clientSecret: auth.clientSecret,
		userID:       user.id,
		login:        slug,
		account:      user.name,
		expiresAt:    tokenExpiry(t.ExpiresIn),
	})
	finish(AuthPollResult{Status: "complete", Account: user.name}, "Kick connected 🎉")
}

// PollKickAuth reports the state of the in-flight browser sign-in; the
// frontend calls it on an interval, exactly like the device-code polls.
func (a *App) PollKickAuth() AuthPollResult {
	a.mu.Lock()
	auth := a.kickAuth
	a.mu.Unlock()
	if auth == nil {
		return AuthPollResult{Status: "error", Message: "no Kick sign-in is in progress"}
	}
	a.mu.Lock()
	res := auth.result
	if res != nil {
		a.kickAuth = nil // consumed
	}
	a.mu.Unlock()
	if res == nil {
		return AuthPollResult{Status: "pending"}
	}
	return *res
}

// CancelKickAuth abandons a pending sign-in and frees the callback port.
func (a *App) CancelKickAuth() {
	a.mu.Lock()
	auth := a.kickAuth
	a.kickAuth = nil
	a.mu.Unlock()
	if auth != nil && auth.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = auth.server.Shutdown(ctx)
	}
}

// kickUser identifies the token's owner.
type kickUser struct {
	id     string // numeric user id (the broadcaster_user_id the API keys on)
	name   string
	avatar string
}

// fetchKickUser returns the token owner's identity.
func fetchKickUser(token string) kickUser {
	fallback := kickUser{name: "Kick account"}
	var r struct {
		Data []struct {
			UserID         json.Number `json:"user_id"`
			Name           string      `json:"name"`
			ProfilePicture string      `json:"profile_picture"`
		} `json:"data"`
	}
	if _, err := getJSON(kickUsersURL, map[string]string{"Authorization": "Bearer " + token}, &r); err != nil || len(r.Data) == 0 {
		return fallback
	}
	u := r.Data[0]
	return kickUser{
		id:     u.UserID.String(),
		name:   firstNonEmpty(u.Name, "Kick account"),
		avatar: u.ProfilePicture,
	}
}

// kickChannel is the own-channel read used by live status and info checks.
type kickChannel struct {
	BroadcasterUserID json.Number `json:"broadcaster_user_id"`
	Slug              string      `json:"slug"`
	ChannelDesc       string      `json:"channel_description"`
	BannerPicture     string      `json:"banner_picture"`
	StreamTitle       string      `json:"stream_title"`
	Category          struct {
		ID   json.Number `json:"id"`
		Name string      `json:"name"`
	} `json:"category"`
	Stream struct {
		IsLive      bool   `json:"is_live"`
		IsMature    bool   `json:"is_mature"`
		Language    string `json:"language"`
		StartTime   string `json:"start_time"`
		Thumbnail   string `json:"thumbnail"`
		URL         string `json:"url"`
		ViewerCount int    `json:"viewer_count"`
	} `json:"stream"`
}

func kickHeaders(conn serviceConn) map[string]string {
	return map[string]string{"Authorization": "Bearer " + conn.token}
}

// fetchKickChannel reads the connected account's channel.
func fetchKickChannel(conn serviceConn) (kickChannel, int, error) {
	var r struct {
		Data []kickChannel `json:"data"`
	}
	status, err := getJSON(kickChannelsURL, kickHeaders(conn), &r)
	if err != nil {
		return kickChannel{}, status, err
	}
	if len(r.Data) == 0 {
		return kickChannel{}, status, fmt.Errorf("kick returned no channel")
	}
	return r.Data[0], status, nil
}

// fetchKickSlug returns the token owner's channel slug (the kick.com URL and
// the key the unofficial endpoints address channels by).
func fetchKickSlug(token string) string {
	var r struct {
		Data []struct {
			Slug string `json:"slug"`
		} `json:"data"`
	}
	if _, err := getJSON(kickChannelsURL, map[string]string{"Authorization": "Bearer " + token}, &r); err != nil || len(r.Data) == 0 {
		return ""
	}
	return r.Data[0].Slug
}

// keyKickChannelInfo caches the slow-moving channel-level data: branding from
// the official users endpoint plus the analytics only the site API carries
// (follower count, verification). The _v2 suffix invalidates caches written
// before the analytics fields were added.
const keyKickChannelInfo = "kick_channel_info_v3"

// kickChannelBranding is the cached channel-level block.
type kickChannelBranding struct {
	Avatar    string `json:"avatar"`
	Followers string `json:"followers"` // formatted count; "" when unavailable
	Verified  bool   `json:"verified"`
	// The raw follower count, for the aggregate hero and the daily history
	// (see metrics.go); Followers above is formatted for display.
	FollowersN int64 `json:"followersN"`
}

// fetchKickChannelInfo assembles the cached block: the avatar from the
// official users endpoint, follower count and verification from the site API
// (best-effort — Cloudflare may refuse it; those fields then stay empty).
func fetchKickChannelInfo(conn serviceConn) kickChannelBranding {
	out := kickChannelBranding{Avatar: fetchKickUser(conn.token).avatar}
	if conn.login == "" {
		return out
	}
	var r struct {
		FollowersCount int64 `json:"followers_count"`
		Verified       bool  `json:"verified"`
	}
	if err := kickUnofficialGet("/channels/"+url.PathEscape(conn.login), &r); err != nil {
		log.Printf("jax: kick channel analytics: %v", err)
		return out
	}
	out.Followers = fmtCount(r.FollowersCount)
	out.FollowersN = r.FollowersCount
	out.Verified = r.Verified
	return out
}

// fetchKickLive gathers the broadcaster's current stream state from the
// official channels endpoint.
func (a *App) fetchKickLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:     "kick",
		ChannelName:  conn.account,
		ChannelLogin: conn.login,
		ChannelURL:   "https://kick.com/" + conn.login,
		StreamURL:    "https://kick.com/" + conn.login,
		// Never nil: a nil slice marshals as JSON null, which the frontend's
		// channel cards read .length on.
		Details: []DetailItem{},
	}

	ch, status, err := fetchKickChannel(conn)
	if err != nil {
		log.Printf("jax: kick channel: %v", err)
		if status == http.StatusUnauthorized {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the Kick API."
		}
		return ls
	}
	if ch.Slug != "" && ch.Slug != conn.login {
		ls.ChannelLogin = ch.Slug
		ls.ChannelURL = "https://kick.com/" + ch.Slug
		ls.StreamURL = ls.ChannelURL
	}
	ls.BannerURL = ch.BannerPicture
	ls.Title = ch.StreamTitle
	ls.Category = ch.Category.Name

	if ch.Stream.IsLive {
		ls.Live = true
		ls.ViewerCount = ch.Stream.ViewerCount
		ls.StartedAt = kickTimeToRFC3339(ch.Stream.StartTime)
		ls.ThumbnailURL = ch.Stream.Thumbnail
		if ch.Stream.Language != "" {
			ls.Details = append(ls.Details, DetailItem{"Language", ch.Stream.Language})
		}
		if ch.Stream.IsMature {
			ls.Details = append(ls.Details, DetailItem{"Mature content", "Yes"})
		}
	}

	// Channel-level data (avatar, follower count, verification) is
	// slow-moving; serve it from the 1-hour cache like Twitch's channel info.
	info, _, _, err := cachedJSON(a, keyKickChannelInfo, apiCacheTTL, false, func() (kickChannelBranding, error) {
		return fetchKickChannelInfo(conn), nil
	})
	if err == nil {
		ls.AvatarURL = info.Avatar
		if info.Followers != "" {
			ls.Details = append(ls.Details, DetailItem{"Followers", info.Followers})
		}
		if info.Verified {
			ls.Details = append(ls.Details, DetailItem{"Verified", "Yes"})
		}
	}
	return ls
}

// kickTimeToRFC3339 normalises Kick timestamps ("2006-01-02 15:04:05" UTC or
// already-RFC3339) to RFC3339 so the rest of the app parses them uniformly.
func kickTimeToRFC3339(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	return s
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

// sendKickChat posts a message to the broadcaster's chat as the user.
func sendKickChat(conn serviceConn, message string) (int, error) {
	id, err := strconv.Atoi(conn.userID)
	if err != nil {
		return 0, fmt.Errorf("kick account details unavailable — try reconnecting")
	}
	var resp struct {
		Data struct {
			IsSent bool `json:"is_sent"`
		} `json:"data"`
	}
	status, err := postJSON(kickChatSendURL, kickHeaders(conn), map[string]any{
		"broadcaster_user_id": id,
		"content":             message,
		"type":                "user",
	}, &resp)
	if err != nil {
		return status, err
	}
	if !resp.Data.IsSent {
		return status, fmt.Errorf("kick dropped the message")
	}
	return status, nil
}

// KickChatIDs are the Pusher subscription keys for the connected channel:
// the chatroom id carries chat + chatroom events (subs, gifts, hosts), the
// channel id carries channel events (follows).
type KickChatIDs struct {
	ChatroomID int `json:"chatroomId"`
	ChannelID  int `json:"channelId"`
}

// GetKickChatIDs resolves the connected channel's chatroom and channel ids —
// the keys the frontend's Pusher chat/event reader subscribes with. They live
// only on the unofficial site API.
func (a *App) GetKickChatIDs() (KickChatIDs, error) {
	conn, ok := a.freshConn("kick")
	if !ok {
		return KickChatIDs{}, fmt.Errorf("connect Kick in Settings → Services first")
	}
	slug := conn.login
	if slug == "" {
		return KickChatIDs{}, fmt.Errorf("the Kick channel slug is unknown — try reconnecting")
	}
	var r struct {
		ID       int `json:"id"`
		Chatroom struct {
			ID int `json:"id"`
		} `json:"chatroom"`
	}
	if err := kickUnofficialGet("/channels/"+url.PathEscape(slug), &r); err != nil {
		return KickChatIDs{}, fmt.Errorf("could not resolve the Kick chatroom: %v", err)
	}
	if r.Chatroom.ID == 0 {
		return KickChatIDs{}, fmt.Errorf("kick returned no chatroom for %q", slug)
	}
	return KickChatIDs{ChatroomID: r.Chatroom.ID, ChannelID: r.ID}, nil
}

// fetchKickChatUser looks up a chatter's public profile. Every Kick user has
// a channel page, so the unofficial channels endpoint (keyed by the chat
// message's slug) is the profile source; follower-of-the-broadcaster checks
// have no API, so those fields stay "unknown".
func fetchKickChatUser(login string) (ChatUserInfo, error) {
	slug := strings.ToLower(strings.TrimSpace(login))
	if slug == "" {
		return ChatUserInfo{}, fmt.Errorf("no user slug to look up")
	}
	var r struct {
		FollowersCount int64 `json:"followers_count"`
		Verified       bool  `json:"verified"`
		User           struct {
			ID         json.Number `json:"id"`
			Username   string      `json:"username"`
			Bio        string      `json:"bio"`
			ProfilePic string      `json:"profile_pic"`
		} `json:"user"`
	}
	if err := kickUnofficialGet("/channels/"+url.PathEscape(slug), &r); err != nil {
		return ChatUserInfo{}, fmt.Errorf("could not load the Kick profile: %v", err)
	}
	info := ChatUserInfo{
		Platform:    "kick",
		ID:          r.User.ID.String(),
		DisplayName: firstNonEmpty(r.User.Username, slug),
		AvatarURL:   r.User.ProfilePic,
		Description: r.User.Bio,
		ChannelURL:  "https://kick.com/" + slug,
		Follower:    "unknown",
		Subscriber:  "unknown",
	}
	info.Details = append(info.Details, DetailItem{"Followers", fmtCount(r.FollowersCount)})
	if r.Verified {
		info.Details = append(info.Details, DetailItem{"Verified", "Yes"})
	}
	return info, nil
}

// ---------------------------------------------------------------------------
// VODs (unofficial site API — the public API has no VOD endpoints)
// ---------------------------------------------------------------------------

// kickUnofficialGet fetches kick.com's site API (no auth). Cloudflare fronts
// it and may refuse non-browser clients, so a browser-like UA is sent and
// callers must tolerate failure.
func kickUnofficialGet(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, kickUnofficialBase+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("kick.com refused the request (%d)", resp.StatusCode)
	}
	return json.Unmarshal(body, out)
}

// kickVODItem is one entry of /channels/{slug}/videos.
type kickVODItem struct {
	SessionTitle string `json:"session_title"`
	StartTime    string `json:"start_time"`
	Duration     int64  `json:"duration"` // milliseconds
	Views        int    `json:"views"`
	Thumbnail    struct {
		Src string `json:"src"`
	} `json:"thumbnail"`
	Video struct {
		UUID string `json:"uuid"`
	} `json:"video"`
}

// fetchKickVODList reads the channel's recent VODs from the site API.
func fetchKickVODList(conn serviceConn) ([]kickVODItem, error) {
	if conn.login == "" {
		return nil, errors.New("missing kick channel slug")
	}
	var items []kickVODItem
	if err := kickUnofficialGet("/channels/"+url.PathEscape(conn.login)+"/videos", &items); err != nil {
		return nil, err
	}
	return items, nil
}

// fetchKickVODs maps the channel's VODs into past broadcasts. Durations use
// the shared compactDuration (see local.go).
func fetchKickVODs(conn serviceConn) ([]PastBroadcast, error) {
	items, err := fetchKickVODList(conn)
	if err != nil {
		return nil, err
	}
	// The broadcast currently on the air is already represented by the live
	// card, but Kick's site API lists its still-recording VOD too — a
	// duplicate of the same stream. Its start time marks which VOD to skip;
	// the start+duration heuristic below can't be trusted alone, since Kick
	// reports a still-recording VOD's duration as zero or stale.
	var liveStart time.Time
	if ch, _, err := fetchKickChannel(conn); err == nil && ch.Stream.IsLive {
		if t, err := time.Parse(time.RFC3339, kickTimeToRFC3339(ch.Stream.StartTime)); err == nil {
			liveStart = t
		}
	}
	out := make([]PastBroadcast, 0, len(items))
	for _, v := range items {
		if v.Video.UUID == "" {
			continue
		}
		secs := int(v.Duration / 1000)
		started := kickTimeToRFC3339(v.StartTime)
		if t, err := time.Parse(time.RFC3339, started); err == nil {
			// The running broadcast's own VOD (a minute of clock slack).
			if !liveStart.IsZero() && !t.Before(liveStart.Add(-time.Minute)) {
				continue
			}
			// A VOD still recording belongs on the live card, not the
			// archive; skip entries whose start+duration reaches (near) now.
			if secs > 0 && time.Since(t.Add(time.Duration(secs)*time.Second)) < time.Minute {
				continue
			}
		}
		out = append(out, PastBroadcast{
			Platform:     "kick",
			Title:        v.SessionTitle,
			URL:          "https://kick.com/" + conn.login + "/videos/" + v.Video.UUID,
			ThumbnailURL: v.Thumbnail.Src,
			StartedAt:    started,
			Duration:     compactDuration(secs),
			DurationSecs: secs,
			ViewCount:    v.Views,
		})
	}
	return out, nil
}

// fetchKickVideos maps the channel's VODs into the videos catalogue.
func fetchKickVideos(conn serviceConn) ([]Video, error) {
	items, err := fetchKickVODList(conn)
	if err != nil {
		return nil, err
	}
	out := make([]Video, 0, len(items))
	for _, v := range items {
		if v.Video.UUID == "" {
			continue
		}
		out = append(out, Video{
			Platform:     "kick",
			ID:           v.Video.UUID,
			Title:        v.SessionTitle,
			URL:          "https://kick.com/" + conn.login + "/videos/" + v.Video.UUID,
			ThumbnailURL: v.Thumbnail.Src,
			PublishedAt:  kickTimeToRFC3339(v.StartTime),
			Duration:     compactDuration(int(v.Duration / 1000)),
			DurationSecs: int(v.Duration / 1000),
			ViewCount:    int64(v.Views),
			Kind:         "VOD",
			ChannelName:  conn.account,
		})
	}
	return out, nil
}

// fetchKickVideoDetails returns one VOD's details. Kick's APIs expose no
// per-video analytics or comments, so the stats are what the listing carries.
func fetchKickVideoDetails(conn serviceConn, id string) (VideoDetails, error) {
	videos, err := fetchKickVideos(conn)
	if err != nil {
		return VideoDetails{}, err
	}
	for _, v := range videos {
		if v.ID != id {
			continue
		}
		stats := []DetailItem{
			{Label: "Views", Value: fmtCount(v.ViewCount)},
		}
		if v.Duration != "" {
			stats = append(stats, DetailItem{Label: "Duration", Value: v.Duration})
		}
		return VideoDetails{
			Video:        v,
			Stats:        stats,
			Comments:     []VideoComment{},
			CommentsNote: "Kick's API does not expose VOD comments.",
		}, nil
	}
	return VideoDetails{}, fmt.Errorf("that Kick VOD was not found — it may have expired")
}

// ---------------------------------------------------------------------------
// Stream info (plans) & categories
// ---------------------------------------------------------------------------

// SearchKickCategories searches Kick's category catalogue for the series
// form's picker. An empty query returns no results. Never nil on success.
func (a *App) SearchKickCategories(query string) ([]ServiceCategory, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []ServiceCategory{}, nil
	}
	conn, ok := a.freshConn("kick")
	if !ok {
		return nil, fmt.Errorf("connect Kick in Settings → Services first")
	}

	var r struct {
		Data []struct {
			ID   json.Number `json:"id"`
			Name string      `json:"name"`
		} `json:"data"`
	}
	status, err := getJSON(kickCategoriesURL+"?q="+url.QueryEscape(query), kickHeaders(conn), &r)
	if err != nil {
		if status == http.StatusUnauthorized {
			return nil, errors.New(errReauth)
		}
		return nil, fmt.Errorf("Kick category search failed: %v", err)
	}

	out := make([]ServiceCategory, 0, len(r.Data))
	for _, d := range r.Data {
		out = append(out, ServiceCategory{ID: d.ID.String(), Name: d.Name})
	}
	return out, nil
}

// keyKickTitlePush stores the stream title the app last pushed to Kick.
// Kick's channels endpoint only reports stream_title while live, so this
// record is how the plan info check compares titles while the channel is
// offline (mirroring the YouTube thumbnail-push record).
const keyKickTitlePush = "kick_title_push"

// pushedKickTitle loads the last title the app pushed to Kick ("" if none).
func (a *App) pushedKickTitle() string {
	title := ""
	if a.store != nil {
		if _, err := a.store.getJSON(keyKickTitlePush, &title); err != nil {
			log.Printf("jax: load kick title push: %v", err)
		}
	}
	return title
}

// recordKickTitlePush remembers the stream title last pushed to Kick.
func (a *App) recordKickTitlePush(title string) {
	if a.store == nil {
		return
	}
	if err := a.store.setJSON(keyKickTitlePush, title); err != nil {
		log.Printf("jax: record kick title push: %v", err)
	}
}

// applyKickInfo pushes a title (and optional category id) to the channel,
// then reads the channel back to confirm the write took — Kick acknowledges
// with 204, so verification is the only way to catch a silently ignored
// update (e.g. a token missing the channel:write scope on some app setups).
func applyKickInfo(conn serviceConn, title, categoryID string) error {
	payload := map[string]any{"stream_title": title}
	if categoryID != "" {
		if id, err := strconv.Atoi(categoryID); err == nil {
			payload["category_id"] = id
		}
	}
	status, err := patchJSON(kickChannelsURL, kickHeaders(conn), payload)
	if err != nil {
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			return fmt.Errorf("kick rejected the update (%d) — reconnect Kick in Settings → Services so the channel:write permission is granted, and check the scope is enabled on your Kick app", status)
		}
		return err
	}
	log.Printf("jax: kick channel patch accepted (%d)", status)

	// Read-back verification.
	ch, _, err := fetchKickChannel(conn)
	if err != nil {
		log.Printf("jax: kick patch verify read: %v", err)
		return nil // the write was accepted; don't fail on a flaky re-read
	}
	// Kick only reports stream_title for the current livestream, so an
	// offline channel reads back "" no matter what was stored — inconclusive,
	// not a failure. Only a different non-empty title (the old one still in
	// place) indicates the write was silently ignored.
	if ch.StreamTitle == "" {
		log.Printf("jax: kick patch verify: no stream title reported (channel offline?) — write accepted, read-back inconclusive")
		return nil
	}
	if ch.StreamTitle != title {
		return fmt.Errorf(
			"kick accepted the update but still reports %q — check that your Kick app has the channel:write scope enabled and reconnect",
			ch.StreamTitle)
	}
	return nil
}

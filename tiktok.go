package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// TikTok
//
// TikTok is an announcement channel like X: no live-video API surface for
// third parties, but Login Kit + the Content Posting API allow posting on
// the creator's behalf.
//
//   - OAuth: Login Kit for Desktop — authorization-code + PKCE with a
//     loopback redirect (localhost is explicitly allowed for desktop apps):
//     http://localhost:53519/tiktok/callback, registered verbatim. TikTok's
//     PKCE deviates from the RFC: code_challenge is the HEX-encoded SHA256
//     of the verifier. Access tokens last ~24h; the refresh token (~1 year,
//     rotating) renews them.
//   - Announcements: TikTok has no text posts, so the go-live announcement
//     is a short vertical VIDEO rendered locally with ffmpeg — the plan's
//     thumbnail (or a brand-dark card) looped for a few seconds — uploaded
//     via FILE_UPLOAD direct post with the title + watch links as caption.
//   - AUDIT CAVEAT: unaudited TikTok API clients may only post SELF_ONLY
//     (private) content, and the account must be private at post time. The
//     app picks the most public privacy level the creator-info endpoint
//     offers and warns when that is SELF_ONLY.
//   - Dashboard card: display name, avatar, follower/likes/video counts
//     (user.info.basic + user.info.stats), cached for an hour.
// ---------------------------------------------------------------------------

const (
	tiktokAuthorizeURL   = "https://www.tiktok.com/v2/auth/authorize/"
	tiktokTokenURL       = "https://open.tiktokapis.com/v2/oauth/token/"
	tiktokUserInfoURL    = "https://open.tiktokapis.com/v2/user/info/"
	tiktokCreatorInfoURL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/"
	tiktokVideoInitURL   = "https://open.tiktokapis.com/v2/post/publish/video/init/"

	tiktokScopes = "user.info.basic,user.info.stats,video.publish"

	tiktokRedirectPort = 53519
	tiktokRedirectPath = "/tiktok/callback"
)

var tiktokRedirectURI = fmt.Sprintf("http://localhost:%d%s", tiktokRedirectPort, tiktokRedirectPath)

// TikTokRedirectURI exposes the redirect URI to the connect form.
func (a *App) TikTokRedirectURI() string {
	return tiktokRedirectURI
}

// tiktokAuthState is one in-flight browser sign-in.
type tiktokAuthState struct {
	state        string
	verifier     string
	clientKey    string
	clientSecret string
	server       *http.Server
	result       *AuthPollResult
}

// StartTikTokAuth begins the Login Kit sign-in: loopback listener, browser
// consent, PollTikTokAuth polling. TikTok issues both a client key and a
// client secret for desktop apps.
func (a *App) StartTikTokAuth(clientKey, clientSecret string) (string, error) {
	clientKey, clientSecret = strings.TrimSpace(clientKey), strings.TrimSpace(clientSecret)
	if clientKey == "" || clientSecret == "" {
		return "", fmt.Errorf("a TikTok Client Key and Client Secret are required")
	}

	verifier, err := randBase64(48)
	if err != nil {
		return "", err
	}
	state, err := randBase64(24)
	if err != nil {
		return "", err
	}
	// TikTok's PKCE: hex-encoded SHA256 (not base64url like the RFC).
	sum := sha256.Sum256([]byte(verifier))
	challenge := hex.EncodeToString(sum[:])

	a.CancelTikTokAuth()

	mux := http.NewServeMux()
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", tiktokRedirectPort), Handler: mux}
	auth := &tiktokAuthState{
		state:        state,
		verifier:     verifier,
		clientKey:    clientKey,
		clientSecret: clientSecret,
		server:       server,
	}
	mux.HandleFunc(tiktokRedirectPath, func(w http.ResponseWriter, r *http.Request) {
		a.handleTikTokCallback(auth, w, r)
	})

	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return "", fmt.Errorf(
			"could not open the sign-in listener on port %d (is another app using it?): %v",
			tiktokRedirectPort, err)
	}

	a.mu.Lock()
	a.tiktokAuth = auth
	a.mu.Unlock()

	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("jax: tiktok auth listener: %v", err)
		}
	}()
	go func(s *tiktokAuthState) {
		time.Sleep(5 * time.Minute)
		a.mu.Lock()
		lingering := a.tiktokAuth == s && s.result == nil
		a.mu.Unlock()
		if lingering {
			a.CancelTikTokAuth()
		}
	}(auth)

	q := url.Values{}
	q.Set("client_key", clientKey)
	q.Set("response_type", "code")
	q.Set("scope", tiktokScopes)
	q.Set("redirect_uri", tiktokRedirectURI)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	authorize := tiktokAuthorizeURL + "?" + q.Encode()

	a.openBrowser(authorize)
	return authorize, nil
}

// handleTikTokCallback exchanges the code and records the outcome.
func (a *App) handleTikTokCallback(auth *tiktokAuthState, w http.ResponseWriter, r *http.Request) {
	finish := func(res AuthPollResult, page string) {
		a.mu.Lock()
		if a.tiktokAuth == auth {
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
			"TikTok sign-in failed")
		return
	}
	if q.Get("state") != auth.state {
		finish(AuthPollResult{Status: "error", Message: "state mismatch — try connecting again"},
			"TikTok sign-in failed")
		return
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_key", auth.clientKey)
	form.Set("client_secret", auth.clientSecret)
	form.Set("redirect_uri", tiktokRedirectURI)
	form.Set("code_verifier", auth.verifier)
	form.Set("code", q.Get("code"))

	body, status, err := postForm(tiktokTokenURL, form)
	if err != nil {
		finish(AuthPollResult{Status: "error", Message: err.Error()}, "TikTok sign-in failed")
		return
	}
	var t struct {
		AccessToken      string `json:"access_token"`
		RefreshToken     string `json:"refresh_token"`
		ExpiresIn        int    `json:"expires_in"`
		OpenID           string `json:"open_id"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if uerr := json.Unmarshal(body, &t); uerr != nil || t.AccessToken == "" {
		msg := firstNonEmpty(t.ErrorDescription, t.Error, fmt.Sprintf("token exchange failed (%d)", status))
		finish(AuthPollResult{Status: "error", Message: msg}, "TikTok sign-in failed")
		return
	}

	name := fetchTikTokDisplayName(t.AccessToken)
	a.setService("tiktok", serviceConn{
		token:        t.AccessToken,
		refreshToken: t.RefreshToken,
		clientID:     auth.clientKey,
		clientSecret: auth.clientSecret,
		userID:       t.OpenID,
		account:      name,
		expiresAt:    tokenExpiry(t.ExpiresIn),
	})
	finish(AuthPollResult{Status: "complete", Account: name}, "TikTok connected 🎉")
}

// PollTikTokAuth reports the state of the in-flight sign-in.
func (a *App) PollTikTokAuth() AuthPollResult {
	a.mu.Lock()
	auth := a.tiktokAuth
	a.mu.Unlock()
	if auth == nil {
		return AuthPollResult{Status: "error", Message: "no TikTok sign-in is in progress"}
	}
	a.mu.Lock()
	res := auth.result
	if res != nil {
		a.tiktokAuth = nil
	}
	a.mu.Unlock()
	if res == nil {
		return AuthPollResult{Status: "pending"}
	}
	return *res
}

// CancelTikTokAuth abandons a pending sign-in and frees the callback port.
func (a *App) CancelTikTokAuth() {
	a.mu.Lock()
	auth := a.tiktokAuth
	a.tiktokAuth = nil
	a.mu.Unlock()
	if auth != nil && auth.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = auth.server.Shutdown(ctx)
	}
}

// refreshTikTokToken renews the ~24h access token; TikTok rotates the
// refresh token. Called from tokens.go.
func refreshTikTokToken(conn serviceConn) (serviceConn, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_key", conn.clientID)
	form.Set("client_secret", conn.clientSecret)
	form.Set("refresh_token", conn.refreshToken)

	body, status, err := postForm(tiktokTokenURL, form)
	if err != nil {
		return conn, err
	}
	var t struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if uerr := json.Unmarshal(body, &t); uerr != nil || t.AccessToken == "" {
		msg := string(body)
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return conn, fmt.Errorf("refresh failed (%d): %s", status, msg)
	}
	conn.token = t.AccessToken
	if t.RefreshToken != "" {
		conn.refreshToken = t.RefreshToken
	}
	conn.expiresAt = tokenExpiry(t.ExpiresIn)
	return conn, nil
}

// tiktokError is the error block every open.tiktokapis.com response carries;
// code "ok" means success even on HTTP 200.
type tiktokError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e tiktokError) ok() bool {
	return e.Code == "" || e.Code == "ok"
}

// fetchTikTokDisplayName resolves the account's display name for the status.
func fetchTikTokDisplayName(token string) string {
	var r struct {
		Data struct {
			User struct {
				DisplayName string `json:"display_name"`
			} `json:"user"`
		} `json:"data"`
	}
	endpoint := tiktokUserInfoURL + "?fields=display_name"
	if _, err := getJSON(endpoint, map[string]string{"Authorization": "Bearer " + token}, &r); err != nil {
		return "TikTok account"
	}
	return firstNonEmpty(r.Data.User.DisplayName, "TikTok account")
}

// ---------------------------------------------------------------------------
// Dashboard channel card
// ---------------------------------------------------------------------------

// keyTikTokChannelInfo caches the slow-moving account stats.
const keyTikTokChannelInfo = "tiktok_channel_info_v1"

type tiktokChannelInfo struct {
	Username  string `json:"username"`
	Avatar    string `json:"avatar"`
	Followers string `json:"followers"`
	Likes     string `json:"likes"`
	Videos    string `json:"videos"`
	Link      string `json:"link"`
}

// fetchTikTokLive fills the Dashboard card. TikTok exposes no live-video
// state to third parties, so the card is channel data only.
func (a *App) fetchTikTokLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:    "tiktok",
		ChannelName: conn.account,
		Details:     []DetailItem{},
	}

	info, _, _, err := cachedJSON(a, keyTikTokChannelInfo, apiCacheTTL, false, func() (tiktokChannelInfo, error) {
		out := tiktokChannelInfo{}
		var r struct {
			Data struct {
				User struct {
					Username       string `json:"username"`
					AvatarURL      string `json:"avatar_url"`
					ProfileDeepURL string `json:"profile_deep_link"`
					FollowerCount  int64  `json:"follower_count"`
					LikesCount     int64  `json:"likes_count"`
					VideoCount     int64  `json:"video_count"`
				} `json:"user"`
			} `json:"data"`
			Error tiktokError `json:"error"`
		}
		endpoint := tiktokUserInfoURL + "?fields=username,avatar_url,profile_deep_link,follower_count,likes_count,video_count"
		if _, err := getJSON(endpoint, map[string]string{"Authorization": "Bearer " + conn.token}, &r); err != nil {
			return out, err
		}
		if !r.Error.ok() {
			return out, fmt.Errorf("tiktok: %s", firstNonEmpty(r.Error.Message, r.Error.Code))
		}
		u := r.Data.User
		out.Username = u.Username
		out.Avatar = u.AvatarURL
		out.Followers = fmtCount(u.FollowerCount)
		out.Likes = fmtCount(u.LikesCount)
		out.Videos = fmtCount(u.VideoCount)
		out.Link = firstNonEmpty(u.ProfileDeepURL, "https://tiktok.com/@"+u.Username)
		return out, nil
	})
	if err != nil {
		log.Printf("jax: tiktok profile: %v", err)
		if strings.Contains(err.Error(), "(401)") || strings.Contains(err.Error(), "access_token_invalid") {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the TikTok API."
		}
		return ls
	}
	ls.ChannelLogin = info.Username
	ls.ChannelURL = info.Link
	ls.StreamURL = info.Link
	ls.AvatarURL = info.Avatar
	if info.Followers != "" {
		ls.Details = append(ls.Details, DetailItem{"Followers", info.Followers})
	}
	if info.Likes != "" {
		ls.Details = append(ls.Details, DetailItem{"Likes", info.Likes})
	}
	if info.Videos != "" {
		ls.Details = append(ls.Details, DetailItem{"Videos", info.Videos})
	}
	return ls
}

// ---------------------------------------------------------------------------
// Go-live announcement (video direct post)
// ---------------------------------------------------------------------------

// renderAnnouncementVideo produces a short vertical MP4 for the announcement:
// the plan's thumbnail letterboxed to 1080x1920 (or a brand-dark card when
// the plan has none), with a silent audio track — TikTok rejects videos
// without audio streams.
func (a *App) renderAnnouncementVideo(plan PlannedStream) (string, error) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg was not found on PATH — it renders the announcement video")
	}
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	out := filepath.Join(dir, "tiktok_announce.mp4")
	_ = os.Remove(out)

	args := []string{"-y", "-loglevel", "error"}
	thumb := ""
	if file := sanitizeThumbFile(plan.ThumbnailFile); file != "" {
		if d, err := planThumbsDir(); err == nil {
			p := filepath.Join(d, file)
			if fileExists(p) {
				thumb = p
			}
		}
	}
	if thumb != "" {
		args = append(args,
			"-loop", "1", "-i", thumb,
			"-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
			"-t", "5",
			"-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0F0F14",
		)
	} else {
		args = append(args,
			"-f", "lavfi", "-i", "color=c=0x0F0F14:s=1080x1920:d=5",
			"-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
			"-t", "5",
		)
	}
	args = append(args,
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
		"-c:a", "aac", "-shortest", out,
	)
	cmd := exec.Command(ffmpeg, args...)
	hideWindow(cmd)
	if raw, err := cmd.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 200 {
			msg = msg[len(msg)-200:]
		}
		return "", fmt.Errorf("could not render the announcement video: %s", firstNonEmpty(msg, err.Error()))
	}
	return out, nil
}

// tiktokPrivacyLevel picks the most public privacy level the creator may
// post with. Unaudited API clients only offer SELF_ONLY.
func tiktokPrivacyLevel(conn serviceConn) (string, error) {
	var r struct {
		Data struct {
			PrivacyLevelOptions []string `json:"privacy_level_options"`
		} `json:"data"`
		Error tiktokError `json:"error"`
	}
	if _, err := postJSON(tiktokCreatorInfoURL, map[string]string{"Authorization": "Bearer " + conn.token},
		map[string]any{}, &r); err != nil {
		return "", err
	}
	if !r.Error.ok() {
		return "", fmt.Errorf("tiktok: %s", firstNonEmpty(r.Error.Message, r.Error.Code))
	}
	for _, want := range []string{"PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"} {
		for _, opt := range r.Data.PrivacyLevelOptions {
			if opt == want {
				return opt, nil
			}
		}
	}
	if len(r.Data.PrivacyLevelOptions) > 0 {
		return r.Data.PrivacyLevelOptions[0], nil
	}
	return "", fmt.Errorf("tiktok offered no privacy levels — the account may not be able to post right now")
}

// applyPlanToTikTok posts the plan's go-live announcement video — once per
// plan, only while the plan's session is on the air (mirrors X/Facebook).
func (a *App) applyPlanToTikTok(plan PlannedStream, _ *ContentSeries) string {
	conn, ok := a.freshConn("tiktok")
	if !ok {
		return "TikTok is not connected — no announcement was posted."
	}
	if a.planAnnounced("tiktok", plan.ID) {
		return ""
	}
	session := a.GetActiveStreamSession()
	if !session.Active || session.PlanID != plan.ID {
		return "TikTok: the go-live announcement posts once the stream is on the air."
	}

	privacy, err := tiktokPrivacyLevel(conn)
	if err != nil {
		log.Printf("jax: tiktok creator info: %v", err)
		return "TikTok: the announcement could not be posted (creator info unavailable)."
	}

	video, err := a.renderAnnouncementVideo(plan)
	if err != nil {
		log.Printf("jax: tiktok render: %v", err)
		return "TikTok: " + err.Error()
	}
	raw, err := os.ReadFile(video)
	if err != nil {
		return "TikTok: the rendered announcement video could not be read."
	}

	// Direct post: init (whole file as a single chunk — it is a few hundred
	// KB), then PUT the bytes to the returned upload URL.
	caption := announcementBody(broadcastBaseTitle(plan), a.watchLinks(2), 2100)
	var initResp struct {
		Data struct {
			PublishID string `json:"publish_id"`
			UploadURL string `json:"upload_url"`
		} `json:"data"`
		Error tiktokError `json:"error"`
	}
	_, err = postJSON(tiktokVideoInitURL, map[string]string{"Authorization": "Bearer " + conn.token},
		map[string]any{
			"post_info": map[string]any{
				"title":           caption,
				"privacy_level":   privacy,
				"disable_duet":    false,
				"disable_comment": false,
				"disable_stitch":  false,
			},
			"source_info": map[string]any{
				"source":            "FILE_UPLOAD",
				"video_size":        len(raw),
				"chunk_size":        len(raw),
				"total_chunk_count": 1,
			},
		}, &initResp)
	if err != nil || !initResp.Error.ok() {
		detail := ""
		if err != nil {
			detail = err.Error()
		} else {
			detail = firstNonEmpty(initResp.Error.Message, initResp.Error.Code)
		}
		log.Printf("jax: tiktok init: %s", detail)
		if strings.Contains(detail, "unaudited") || strings.Contains(detail, "reached_active_user_cap") {
			return "TikTok: posting is limited until the TikTok app passes its audit."
		}
		return "TikTok: the announcement could not be posted."
	}

	req, err := http.NewRequest(http.MethodPut, initResp.Data.UploadURL, bytes.NewReader(raw))
	if err != nil {
		return "TikTok: the announcement upload could not start."
	}
	req.Header.Set("Content-Type", "video/mp4")
	req.Header.Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(raw)-1, len(raw)))
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("jax: tiktok upload: %v", err)
		return "TikTok: the announcement upload failed."
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		log.Printf("jax: tiktok upload (%d): %s", resp.StatusCode, string(body))
		return "TikTok: the announcement upload failed."
	}

	a.markAnnounced("tiktok", plan.ID, initResp.Data.PublishID)
	if privacy == "SELF_ONLY" {
		return "TikTok: announcement posted as PRIVATE — unaudited TikTok apps can only post privately; pass TikTok's audit to post publicly."
	}
	return ""
}

// tiktokInfoStatus reports the announcement state for the Broadcast page.
func (a *App) tiktokInfoStatus(plan PlannedStream) PlanChannelInfo {
	info := PlanChannelInfo{Channel: "tiktok", WantTitle: broadcastBaseTitle(plan)}
	_, ok := a.freshConn("tiktok")
	info.Connected = ok
	if !ok {
		info.Detail = "TikTok is not connected."
		return info
	}
	if a.planAnnounced("tiktok", plan.ID) {
		info.Matches = true
		info.CurrentTitle = "Announcement posted"
		return info
	}
	info.Detail = "The go-live announcement posts once the stream is on the air."
	return info
}

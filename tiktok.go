package main

import (
	"bp-temp/internal/httpx"
	"bp-temp/internal/mediakit"
	"bp-temp/internal/platform"
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
	tiktokVideoListURL   = "https://open.tiktokapis.com/v2/video/list/"
	tiktokPublishStatus  = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"

	// The user-info scopes are split three ways, and asking for a field under
	// the wrong one is a scope_not_authorized error, not a missing field:
	//
	//   user.info.basic   open_id, avatar_url, display_name
	//   user.info.profile username, profile_deep_link, bio, is_verified
	//   user.info.stats   follower_count, likes_count, video_count
	//
	// (TikTok moved username and profile_deep_link out of .basic in early 2024;
	// an app still asking for them under .basic alone is refused outright.)
	//
	// video.list reads the creator's own posts for the Videos page;
	// video.publish posts on their behalf. Each is granted independently, so
	// every call below asks only for what one scope covers and degrades when a
	// scope was not granted — see fetchTikTokProfile and friends.
	tiktokScopes = "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish"

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
		Scope            string `json:"scope"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if uerr := json.Unmarshal(body, &t); uerr != nil || t.AccessToken == "" {
		msg := firstNonEmpty(t.ErrorDescription, t.Error, fmt.Sprintf("token exchange failed (%d)", status))
		finish(AuthPollResult{Status: "error", Message: msg}, "TikTok sign-in failed")
		return
	}
	// TikTok grants what the app is approved for, not what was asked for — a
	// scope still awaiting review is simply dropped, silently. Recording what
	// came back is the only way to explain a feature that then doesn't work.
	if t.Scope != "" && t.Scope != tiktokScopes {
		log.Printf("jax: tiktok granted scopes %q (asked for %q)", t.Scope, tiktokScopes)
	}

	// A reconnect is usually someone fixing their TikTok app's scopes; the
	// hour-old card would hide the fix until it expired.
	if a.store != nil {
		if err := a.store.deleteCacheEntry(keyTikTokChannelInfo); err != nil {
			log.Printf("jax: clear tiktok channel cache: %v", err)
		}
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
	if _, err := httpx.GetJSON(endpoint, map[string]string{"Authorization": "Bearer " + token}, &r); err != nil {
		return "TikTok account"
	}
	return firstNonEmpty(r.Data.User.DisplayName, "TikTok account")
}

// ---------------------------------------------------------------------------
// Dashboard channel card
// ---------------------------------------------------------------------------

// keyTikTokChannelInfo caches the slow-moving account stats.
const keyTikTokChannelInfo = "tiktok_channel_info_v3"

type tiktokChannelInfo struct {
	Username  string `json:"username"`
	Avatar    string `json:"avatar"`
	Followers string `json:"followers"`
	Likes  string `json:"likes"`
	Videos string `json:"videos"`
	Link   string `json:"link"`
	// Handle is the @name, derived from the profile web link (no scope carries
	// it directly); a posted video's URL is built from it.
	Handle string `json:"handle"`
	// Views is the total across the account's videos — TikTok has no lifetime
	// view figure, so it is summed from the video list (see fetchTikTokViews).
	// ViewsOver records how many videos that sum actually covered.
	Views     string `json:"views"`
	ViewsOver int64  `json:"viewsOver"`
	// The raw counts, for the aggregate hero and the daily history (see
	// metrics.go); the strings above are formatted for display.
	FollowersN int64 `json:"followersN"`
	LikesN     int64 `json:"likesN"`
	VideosN    int64 `json:"videosN"`
	ViewsN     int64 `json:"viewsN"`
}

// tiktokFailure turns a TikTok API failure into something the producer can
// actually act on.
//
// A 401 from TikTok is not always an expired token: it answers 401 just the
// same when the app was never granted the scope in the first place — the
// commonest state while a TikTok app is still being set up. Telling someone to
// reconnect when reconnecting cannot possibly help is worse than telling them
// nothing, so the scope case is named before the expiry case (a scope error
// carries a 401 too, and would otherwise be swallowed by it).
func tiktokFailure(err error) string {
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "scope_not_authorized"),
		strings.Contains(msg, "scope_permission_missed"):
		return "TikTok hasn't granted this app the scopes it needs. On developers.tiktok.com, add user.info.basic, user.info.profile, user.info.stats, video.list and video.publish to the app, then reconnect."
	case strings.Contains(msg, "access_token_invalid"),
		strings.Contains(msg, "access_token_expired"),
		strings.Contains(msg, "(401)"):
		return errReauth
	case strings.Contains(msg, "rate_limit"):
		return "TikTok is rate-limiting the app — try again in a few minutes."
	}
	return "Could not reach the TikTok API."
}

// tiktokUserFields queries user/info for the named fields.
func tiktokUserFields(conn serviceConn, fields string, out any) error {
	_, err := httpx.GetJSON(tiktokUserInfoURL+"?fields="+fields,
		map[string]string{"Authorization": "Bearer " + conn.token}, out)
	return err
}

// fetchTikTokProfile reads the account's identity — and nothing but what
// user.info.basic covers. display_name and avatar_url are the only identity
// fields that scope still carries: username and profile_deep_link moved to
// user.info.profile, and asking for them here would fail the whole call.
func fetchTikTokProfile(conn serviceConn) (tiktokChannelInfo, error) {
	var out tiktokChannelInfo
	var r struct {
		Data struct {
			User struct {
				DisplayName string `json:"display_name"`
				AvatarURL   string `json:"avatar_url"`
			} `json:"user"`
		} `json:"data"`
		Error tiktokError `json:"error"`
	}
	if err := tiktokUserFields(conn, "display_name,avatar_url", &r); err != nil {
		return out, err
	}
	if !r.Error.ok() {
		return out, fmt.Errorf("%s: %s", r.Error.Code, r.Error.Message)
	}
	out.Username = r.Data.User.DisplayName
	out.Avatar = r.Data.User.AvatarURL
	return out, nil
}

// fetchTikTokLinks reads the profile links (user.info.profile).
//
// Deliberately does NOT ask for `username`: TikTok's own scope description for
// user.info.profile lists profile_web_link, profile_deep_link, bio_description
// and is_verified — and nothing else. Asking for a field a scope doesn't cover
// fails the whole call, so the @handle is derived from the web link instead of
// requested (see tiktokHandleFrom).
//
// Kept apart from the identity call because it is a different scope, and a
// scope that wasn't granted must cost only the fields it covers — not the card.
func fetchTikTokLinks(conn serviceConn) (webLink, deepLink string, err error) {
	var r struct {
		Data struct {
			User struct {
				ProfileWebLink  string `json:"profile_web_link"`
				ProfileDeepLink string `json:"profile_deep_link"`
			} `json:"user"`
		} `json:"data"`
		Error tiktokError `json:"error"`
	}
	if err := tiktokUserFields(conn, "profile_web_link,profile_deep_link", &r); err != nil {
		return "", "", err
	}
	if !r.Error.ok() {
		return "", "", fmt.Errorf("%s: %s", r.Error.Code, r.Error.Message)
	}
	return r.Data.User.ProfileWebLink, r.Data.User.ProfileDeepLink, nil
}

// tiktokHandle returns the connected account's @handle from the cached channel
// info ("" when user.info.profile was never granted, so the link it comes from
// was never read).
func (a *App) tiktokHandle() string {
	var info tiktokChannelInfo
	if a.readCache(keyTikTokChannelInfo, &info) {
		return info.Handle
	}
	return ""
}

// tiktokHandleFrom pulls the @handle out of a profile web link
// ("https://www.tiktok.com/@someone" → "someone"). It is the only way to learn
// the handle without a scope that carries it, and the handle is what a posted
// video's URL is built from.
func tiktokHandleFrom(webLink string) string {
	if i := strings.LastIndex(webLink, "/@"); i >= 0 {
		handle := webLink[i+2:]
		if j := strings.IndexAny(handle, "/?#"); j >= 0 {
			handle = handle[:j]
		}
		return handle
	}
	return ""
}

// tiktokViewsPageCap bounds the walk below. 20 videos a page, so this covers a
// 400-video back catalogue — deep enough for a real creator, shallow enough
// that the Dashboard never spends a minute on TikTok's pagination.
const tiktokViewsPageCap = 20

// fetchTikTokViews totals the account's video views (video.list).
//
// TikTok exposes no lifetime view count anywhere — user.info.stats gives
// followers, likes and a video count, but not views. The only way to the number
// is to add up every video's own view_count, so this walks the video list and
// sums it. Returns the total and how many videos it covered, because a total
// that silently stopped at the page cap would be a lie told with a straight
// face: the UI says "across N videos" rather than claiming a lifetime figure it
// didn't actually reach.
func fetchTikTokViews(conn serviceConn) (views int64, videos int64, err error) {
	endpoint := tiktokVideoListURL + "?fields=id,view_count"
	cursor := int64(0)

	for page := 0; page < tiktokViewsPageCap; page++ {
		var r struct {
			Data struct {
				Videos []struct {
					ViewCount int64 `json:"view_count"`
				} `json:"videos"`
				Cursor  int64 `json:"cursor"`
				HasMore bool  `json:"has_more"`
			} `json:"data"`
			Error tiktokError `json:"error"`
		}
		body := map[string]any{"max_count": 20}
		if cursor > 0 {
			body["cursor"] = cursor
		}
		if _, err := httpx.PostJSON(endpoint,
			map[string]string{"Authorization": "Bearer " + conn.token},
			body, &r); err != nil {
			return 0, 0, err
		}
		if !r.Error.ok() {
			return 0, 0, fmt.Errorf("%s: %s", r.Error.Code, r.Error.Message)
		}

		for _, v := range r.Data.Videos {
			views += v.ViewCount
			videos++
		}
		if !r.Data.HasMore || len(r.Data.Videos) == 0 {
			break
		}
		cursor = r.Data.Cursor
	}
	return views, videos, nil
}

// fetchTikTokStats reads the follower/likes/video counts (user.info.stats).
// Kept apart from the profile on purpose: this is the scope most likely to be
// missing, and losing the counts must not cost the whole card.
func fetchTikTokStats(conn serviceConn) (tiktokChannelInfo, error) {
	var out tiktokChannelInfo
	var r struct {
		Data struct {
			User struct {
				FollowerCount int64 `json:"follower_count"`
				LikesCount    int64 `json:"likes_count"`
				VideoCount    int64 `json:"video_count"`
			} `json:"user"`
		} `json:"data"`
		Error tiktokError `json:"error"`
	}
	if err := tiktokUserFields(conn, "follower_count,likes_count,video_count", &r); err != nil {
		return out, err
	}
	if !r.Error.ok() {
		return out, fmt.Errorf("%s: %s", r.Error.Code, r.Error.Message)
	}
	u := r.Data.User
	out.Followers = fmtCount(u.FollowerCount)
	out.Likes = fmtCount(u.LikesCount)
	out.Videos = fmtCount(u.VideoCount)
	out.FollowersN = u.FollowerCount
	out.LikesN = u.LikesCount
	out.VideosN = u.VideoCount
	return out, nil
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
		// TikTok splits this data across three scopes, each granted
		// independently. One request covering all of them is all-or-nothing:
		// a single ungranted field fails the whole call, and the card dies —
		// name, avatar and all — over a follower count that was never more
		// than a nice-to-have. So each scope gets its own call, and only the
		// identity (user.info.basic, the one scope every TikTok app has) is
		// allowed to fail the card.
		out, err := fetchTikTokProfile(conn)
		if err != nil {
			return out, err
		}
		if webLink, deepLink, err := fetchTikTokLinks(conn); err != nil {
			log.Printf("jax: tiktok profile link unavailable (user.info.profile not granted?): %v", err)
		} else {
			out.Link = firstNonEmpty(webLink, deepLink)
			out.Handle = tiktokHandleFrom(webLink)
		}
		if stats, err := fetchTikTokStats(conn); err != nil {
			log.Printf("jax: tiktok stats unavailable (user.info.stats not granted?): %v", err)
		} else {
			out.Followers, out.Likes, out.Videos = stats.Followers, stats.Likes, stats.Videos
			out.FollowersN, out.LikesN, out.VideosN = stats.FollowersN, stats.LikesN, stats.VideosN
		}
		// Views have to be added up from the videos themselves (video.list) —
		// TikTok publishes no lifetime total.
		if views, over, err := fetchTikTokViews(conn); err != nil {
			log.Printf("jax: tiktok views unavailable (video.list not granted?): %v", err)
		} else {
			out.ViewsN = views
			out.Views = fmtCount(views)
			out.ViewsOver = over
		}
		return out, nil
	})
	if err != nil {
		log.Printf("jax: tiktok profile: %v", err)
		ls.Error = tiktokFailure(err)
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
	if info.Views != "" {
		// Say what the total actually covers: TikTok gives no lifetime figure,
		// so this is the sum over the videos the list reached, and pretending
		// otherwise would be a quiet lie.
		label := "Views"
		if info.ViewsOver > 0 {
			label = fmt.Sprintf("Views (across %d videos)", info.ViewsOver)
		}
		ls.Details = append(ls.Details, DetailItem{label, info.Views})
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
	ffmpeg, err := mediakit.FFmpeg("it renders the announcement video")
	if err != nil {
		return "", err
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
	platform.HideWindow(cmd)
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
	if _, err := httpx.PostJSON(tiktokCreatorInfoURL, map[string]string{"Authorization": "Bearer " + conn.token},
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

// fetchTikTokVideos lists the creator's own posts for the Videos page. TikTok
// is short-form by definition, so every post lands in the Shorts & Reels tab.
//
// The list needs the video.list scope. A connection made before the app asked
// for it will be refused here — the error says so, and reconnecting TikTok in
// Settings → Services fixes it. It is reported rather than swallowed, because
// "no videos" and "you need to reconnect" are very different things.
func (a *App) fetchTikTokVideos(conn serviceConn) ([]Video, error) {
	var r struct {
		Data struct {
			Videos []struct {
				ID            string `json:"id"`
				Title         string `json:"title"`
				Description   string `json:"video_description"`
				Duration      int    `json:"duration"`
				CoverImageURL string `json:"cover_image_url"`
				ShareURL      string `json:"share_url"`
				CreateTime    int64  `json:"create_time"` // unix seconds
				ViewCount     int64  `json:"view_count"`
			} `json:"videos"`
		} `json:"data"`
		Error tiktokError `json:"error"`
	}
	endpoint := tiktokVideoListURL +
		"?fields=id,title,video_description,duration,cover_image_url,share_url,create_time,view_count"
	if _, err := httpx.PostJSON(endpoint,
		map[string]string{"Authorization": "Bearer " + conn.token},
		map[string]any{"max_count": 20}, &r); err != nil {
		return nil, fmt.Errorf("%s", tiktokFailure(err))
	}
	if !r.Error.ok() {
		return nil, fmt.Errorf("%s", tiktokFailure(
			fmt.Errorf("%s: %s", r.Error.Code, r.Error.Message)))
	}

	out := make([]Video, 0, len(r.Data.Videos))
	for _, v := range r.Data.Videos {
		published := ""
		if v.CreateTime > 0 {
			published = time.Unix(v.CreateTime, 0).UTC().Format(time.RFC3339)
		}
		out = append(out, Video{
			Platform:     "tiktok",
			ID:           v.ID,
			Title:        firstNonEmpty(v.Title, firstLine(v.Description)),
			Description:  v.Description,
			URL:          v.ShareURL,
			ThumbnailURL: v.CoverImageURL,
			PublishedAt:  published,
			Duration:     formatSecsCompact(v.Duration),
			DurationSecs: v.Duration,
			ViewCount:    v.ViewCount,
			Kind:         "TikTok",
			Status:       "public",
			ChannelName:  conn.account,
			IsShort:      true,
		})
	}
	return out, nil
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
	_, err = httpx.PostJSON(tiktokVideoInitURL, map[string]string{"Authorization": "Bearer " + conn.token},
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
	resp, err := httpx.Client.Do(req)
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

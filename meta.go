package main

import (
	"bp-temp/internal/httpx"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Meta — Facebook Pages & Instagram Live
//
// Both platforms ride one Meta app and one sign-in. Facebook connects with
// the "Login for Devices" flow (the same user-code + poll UX as Twitch and
// YouTube) using the app's App ID and CLIENT TOKEN (Settings → Advanced on
// the Meta app — not the app secret). The user token (~60 days, no refresh
// endpoint; reconnect when it expires) lists the user's Pages, and the first
// Page's own token becomes the working credential.
//
// Instagram derives from the Facebook connection: the Page's linked Instagram
// Business account is addressed through graph.facebook.com with the same
// Page token (Instagram API with Facebook Login).
//
// Capability notes, mirrored in the UI:
//   - Facebook: live status + viewers, live comments (poll) + send as the
//     Page, past live VODs, the Page's video catalogue, title/description
//     push onto the CURRENT live video (like YouTube, the object only exists
//     while live/scheduled).
//   - Instagram Live: live status and comments (readable only DURING the
//     broadcast) + replies; no viewer count, no VODs, and no editable stream
//     info — Instagram's API simply doesn't expose them.
//   - Neither platform has a follower event feed; the Events panel carries
//     no Meta sources.
// ---------------------------------------------------------------------------

const (
	fbGraphURL        = "https://graph.facebook.com/v21.0"
	fbDeviceLoginURL  = fbGraphURL + "/device/login"
	fbDeviceStatusURL = fbGraphURL + "/device/login_status"

	// fbScopes: Pages (list/read/engage/post/publish) plus the Instagram
	// permissions the linked business account needs. pages_manage_posts
	// covers the go-live announcement posts; business_management surfaces
	// Pages managed through a Business/Meta Business Suite portfolio (which
	// /me/accounts omits without it). Dev-mode apps grant these to the app's
	// own admins without App Review.
	// instagram_manage_insights is what turns Instagram Reels from a like count
	// into a real view count — nothing else on the Graph API exposes views for
	// a Reel (see fetchInstagramReelViews in shorts.go). Adding it means
	// reconnecting Facebook: Meta grants the scopes asked for at consent, not
	// the ones the app later wishes it had.
	fbScopes = "public_profile,business_management,pages_show_list,pages_read_engagement,pages_manage_engagement,pages_manage_posts,pages_read_user_content,publish_video,instagram_basic,instagram_manage_comments,instagram_manage_insights"
)

// metaHeaders authenticates a Graph API call with the connection's token.
func metaHeaders(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

// ---------------------------------------------------------------------------
// Facebook device login
// ---------------------------------------------------------------------------

// StartFacebookDeviceAuth requests a device code and opens the verification
// page. clientToken is the Meta app's client token (App Settings → Advanced).
func (a *App) StartFacebookDeviceAuth(appID, clientToken string) (DeviceCodeInfo, error) {
	appID, clientToken = strings.TrimSpace(appID), strings.TrimSpace(clientToken)
	if appID == "" || clientToken == "" {
		return DeviceCodeInfo{}, fmt.Errorf("a Meta App ID and Client Token are required")
	}
	form := url.Values{}
	form.Set("access_token", appID+"|"+clientToken)
	form.Set("scope", fbScopes)

	body, status, err := postForm(fbDeviceLoginURL, form)
	if err != nil {
		return DeviceCodeInfo{}, err
	}
	if status != http.StatusOK {
		return DeviceCodeInfo{}, fmt.Errorf("Facebook device request failed (%d): %s", status, string(body))
	}

	var r struct {
		Code            string `json:"code"`
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
		DeviceCode:      r.Code,
		UserCode:        r.UserCode,
		VerificationURI: r.VerificationURI,
		Interval:        r.Interval,
		ExpiresIn:       r.ExpiresIn,
	}, nil
}

// PollFacebookDeviceAuth exchanges the device code for a user token, then
// connects the user's first Facebook Page (its Page token is the working
// credential; the user token is kept for page re-selection and Instagram).
func (a *App) PollFacebookDeviceAuth(appID, clientToken, code string) (AuthPollResult, error) {
	form := url.Values{}
	form.Set("access_token", strings.TrimSpace(appID)+"|"+strings.TrimSpace(clientToken))
	form.Set("code", code)

	body, status, err := postForm(fbDeviceStatusURL, form)
	if err != nil {
		return AuthPollResult{}, err
	}

	// A granted token completes the flow. Meta's device endpoints don't map
	// cleanly onto HTTP statuses (pending states have been observed on both
	// 200 and 400), so the body decides, not the status code.
	var t struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	_ = json.Unmarshal(body, &t)
	if t.AccessToken != "" {
		page, err := firstFacebookPage(t.AccessToken)
		if err != nil {
			return AuthPollResult{Status: "error", Message: err.Error()}, nil
		}
		a.setService("facebook", serviceConn{
			token: page.AccessToken,
			// Facebook has no refresh endpoint; the slot instead carries the
			// user token (Instagram linkage, page re-listing). tokens.go
			// knows not to "refresh" Meta connections.
			refreshToken: t.AccessToken,
			clientID:     strings.TrimSpace(appID),
			clientSecret: strings.TrimSpace(clientToken),
			userID:       page.ID,
			account:      page.Name,
			expiresAt:    tokenExpiry(t.ExpiresIn),
		})
		return AuthPollResult{Status: "complete", Account: page.Name}, nil
	}

	// Errors carry Meta's subcodes: 1349174 = authorization pending,
	// 1349172 = polling too fast, 1349152 = code expired.
	var e struct {
		Error struct {
			Message      string `json:"message"`
			ErrorSubcode int    `json:"error_subcode"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &e)
	switch e.Error.ErrorSubcode {
	case 1349174:
		return AuthPollResult{Status: "pending"}, nil
	case 1349172:
		return AuthPollResult{Status: "pending", Message: "slow_down"}, nil
	case 1349152:
		return AuthPollResult{Status: "error", Message: "The code expired before authorization — try again."}, nil
	}
	if e.Error.Message != "" {
		return AuthPollResult{Status: "error", Message: e.Error.Message}, nil
	}
	// Truly unrecognized: surface what Meta sent so it can be diagnosed.
	snippet := string(body)
	if len(snippet) > 200 {
		snippet = snippet[:200]
	}
	return AuthPollResult{Status: "error", Message: fmt.Sprintf("unexpected device login response (%d): %s", status, snippet)}, nil
}

// fbPage is one entry of the user's /me/accounts.
type fbPage struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AccessToken string `json:"access_token"`
}

// firstFacebookPage lists the user's Pages and returns the first. A Page is
// mandatory — live videos, comments, and the video catalogue all hang off it.
func firstFacebookPage(userToken string) (fbPage, error) {
	var r struct {
		Data []fbPage `json:"data"`
	}
	if _, err := httpx.GetJSON(fbGraphURL+"/me/accounts?fields=id,name,access_token", metaHeaders(userToken), &r); err != nil {
		return fbPage{}, fmt.Errorf("could not list your Facebook Pages: %v", err)
	}
	if len(r.Data) == 0 {
		// Diagnosing an empty list needs to name WHO signed in — the most
		// common cause is the approval happening as a different Facebook
		// identity than the one that manages the Page.
		who := fbUserName(userToken)
		if fbPermissionGranted(userToken, "pages_show_list") {
			return fbPage{}, fmt.Errorf(
				"the sign-in completed as %q, but that account shared no Pages with the app — if the Page belongs to another profile/account, approve the code at facebook.com/device while signed in as it; otherwise re-consent and choose \"opt in to all current and future Pages\"", who)
		}
		return fbPage{}, fmt.Errorf(
			"the sign-in completed as %q without granting Pages access — reconnect and keep the Pages permissions checked on the consent screen", who)
	}
	return r.Data[0], nil
}

// fbUserName identifies the token's owner for diagnostics.
func fbUserName(userToken string) string {
	var r struct {
		Name string `json:"name"`
		ID   string `json:"id"`
	}
	if _, err := httpx.GetJSON(fbGraphURL+"/me?fields=id,name", metaHeaders(userToken), &r); err != nil {
		return "unknown account"
	}
	return firstNonEmpty(r.Name, r.ID, "unknown account")
}

// fbPermissionGranted reports whether the token carries a granted permission.
func fbPermissionGranted(userToken, permission string) bool {
	var r struct {
		Data []struct {
			Permission string `json:"permission"`
			Status     string `json:"status"`
		} `json:"data"`
	}
	if _, err := httpx.GetJSON(fbGraphURL+"/me/permissions", metaHeaders(userToken), &r); err != nil {
		return false
	}
	for _, p := range r.Data {
		if p.Permission == permission && p.Status == "granted" {
			return true
		}
	}
	return false
}

// FBPageInfo is one manageable Page, for the connect dialog's Page picker.
type FBPageInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Selected bool   `json:"selected"`
	// Instagram is the linked IG Business account's username as the Graph API
	// reports it ("" when the API sees none — the deciding fact for whether
	// IG live comments will work from this Page).
	Instagram string `json:"instagram"`
}

// ListFacebookPages lists every Page the connected user manages, marking the
// one the app currently works as and the Instagram account the API sees
// linked to each. The user token rides in the connection's refreshToken slot
// (see PollFacebookDeviceAuth).
func (a *App) ListFacebookPages() ([]FBPageInfo, error) {
	conn, ok := a.getConn("facebook")
	if !ok {
		return nil, fmt.Errorf("Facebook is not connected")
	}
	var r struct {
		Data []struct {
			ID                       string `json:"id"`
			Name                     string `json:"name"`
			InstagramBusinessAccount struct {
				Username string `json:"username"`
			} `json:"instagram_business_account"`
		} `json:"data"`
	}
	endpoint := fbGraphURL + "/me/accounts?fields=id,name,instagram_business_account{username}&limit=100"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.refreshToken), &r); err != nil {
		return nil, fmt.Errorf("could not list your Facebook Pages: %v", err)
	}
	out := make([]FBPageInfo, 0, len(r.Data))
	for _, p := range r.Data {
		out = append(out, FBPageInfo{
			ID:        p.ID,
			Name:      p.Name,
			Selected:  p.ID == conn.userID,
			Instagram: p.InstagramBusinessAccount.Username,
		})
	}
	return out, nil
}

// SelectFacebookPage switches the connection to another managed Page: its
// Page token becomes the working credential, the cached Page data drops, and
// a linked Instagram connection re-derives from the new Page (or disconnects
// when the new Page has none).
func (a *App) SelectFacebookPage(pageID string) (ServiceStatus, error) {
	conn, ok := a.getConn("facebook")
	if !ok {
		return ServiceStatus{}, fmt.Errorf("Facebook is not connected")
	}
	var r struct {
		Data []fbPage `json:"data"`
	}
	if _, err := httpx.GetJSON(fbGraphURL+"/me/accounts?fields=id,name,access_token&limit=100", metaHeaders(conn.refreshToken), &r); err != nil {
		return ServiceStatus{}, fmt.Errorf("could not list your Facebook Pages: %v", err)
	}
	for _, p := range r.Data {
		if p.ID != pageID {
			continue
		}
		conn.token = p.AccessToken
		conn.userID = p.ID
		conn.account = p.Name
		a.setService("facebook", conn)

		// The Page-scoped caches and memos belong to the old Page.
		if a.store != nil {
			_ = a.store.deleteCacheEntry(keyFBChannelInfo)
			_ = a.store.deleteCacheEntry(keyIGChannelInfo)
		}
		a.mu.Lock()
		a.fbLiveVideoID = ""
		a.igLiveMediaID = ""
		a.mu.Unlock()

		// Instagram rides the Page; re-derive it from the new one.
		if _, wasLinked := a.getConn("instagram"); wasLinked {
			if _, err := a.ConnectInstagram(); err != nil {
				log.Printf("jax: instagram re-link after page switch: %v", err)
				a.DisconnectService("instagram")
			}
		}
		return ServiceStatus{Name: "facebook", Connected: true, Account: p.Name}, nil
	}
	return ServiceStatus{}, fmt.Errorf("that Page was not found among the accounts shared with the app")
}

// ConnectInstagram links the Instagram Business account attached to the
// connected Facebook Page. It reuses the Page token, so Facebook must be
// connected first.
func (a *App) ConnectInstagram() (ServiceStatus, error) {
	conn, ok := a.freshConn("facebook")
	if !ok {
		return ServiceStatus{}, fmt.Errorf("connect Facebook first — Instagram rides its Page connection")
	}
	var r struct {
		InstagramBusinessAccount struct {
			ID             string `json:"id"`
			Username       string `json:"username"`
			ProfilePicture string `json:"profile_picture_url"`
		} `json:"instagram_business_account"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) +
		"?fields=instagram_business_account{id,username,profile_picture_url}"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err != nil {
		return ServiceStatus{}, fmt.Errorf("could not read the Page's Instagram account: %v", err)
	}
	ig := r.InstagramBusinessAccount
	if ig.ID == "" {
		return ServiceStatus{}, fmt.Errorf(
			"the Facebook Page %q has no linked Instagram Business account — link one in the Page settings, then retry", conn.account)
	}
	account := "@" + firstNonEmpty(ig.Username, ig.ID)
	a.setService("instagram", serviceConn{
		token:        conn.token, // the Page token addresses the IG account
		clientID:     conn.clientID,
		clientSecret: conn.clientSecret,
		userID:       ig.ID,
		login:        ig.Username,
		account:      account,
		expiresAt:    conn.expiresAt,
	})
	return ServiceStatus{Name: "instagram", Connected: true, Account: account}, nil
}

// ---------------------------------------------------------------------------
// Live status
// ---------------------------------------------------------------------------

// keyFBChannelInfo caches the slow-moving Page-level data.
const keyFBChannelInfo = "facebook_channel_info_v2"

type fbChannelInfo struct {
	Link      string `json:"link"`
	Followers string `json:"followers"`
	Likes     string `json:"likes"`
	Avatar    string `json:"avatar"`
	Banner    string `json:"banner"`
	// The raw counts, for the aggregate hero and the daily history (see
	// metrics.go); the strings above are formatted for display.
	FollowersN int64 `json:"followersN"`
	LikesN     int64 `json:"likesN"`
}

// fbPermalink absolutizes Graph's relative permalink_url values.
func fbPermalink(p string) string {
	if strings.HasPrefix(p, "/") {
		return "https://www.facebook.com" + p
	}
	return p
}

// fbLiveNow returns the Page's currently-live video (nil when offline),
// memoising its id for the chat/send paths.
func (a *App) fbLiveNow(conn serviceConn) (*fbLiveVideo, error) {
	var r struct {
		Data []fbLiveVideo `json:"data"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) +
		`/live_videos?broadcast_status=["LIVE"]&limit=1&fields=id,title,description,permalink_url,live_views,creation_time`
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err != nil {
		return nil, err
	}
	a.mu.Lock()
	if len(r.Data) > 0 {
		a.fbLiveVideoID = r.Data[0].ID
	} else {
		a.fbLiveVideoID = ""
	}
	a.mu.Unlock()
	if len(r.Data) == 0 {
		return nil, nil
	}
	return &r.Data[0], nil
}

type fbLiveVideo struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	PermalinkURL string `json:"permalink_url"`
	LiveViews    int    `json:"live_views"`
	CreationTime string `json:"creation_time"`
}

// fetchFacebookLive gathers the Page's live state and cached Page analytics.
func (a *App) fetchFacebookLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:    "facebook",
		ChannelName: conn.account,
		Details:     []DetailItem{},
	}

	live, err := a.fbLiveNow(conn)
	if err != nil {
		log.Printf("jax: facebook live: %v", err)
		if strings.Contains(err.Error(), "(190)") || strings.Contains(err.Error(), "code\":190") {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the Facebook API."
		}
		return ls
	}
	if live != nil {
		ls.Live = true
		ls.Title = live.Title
		ls.ViewerCount = live.LiveViews
		ls.StartedAt = metaTimeToRFC3339(live.CreationTime)
		ls.StreamURL = fbPermalink(live.PermalinkURL)
	}

	info, _, _, err := cachedJSON(a, keyFBChannelInfo, apiCacheTTL, false, func() (fbChannelInfo, error) {
		out := fbChannelInfo{}
		var page struct {
			Link           string `json:"link"`
			FanCount       int64  `json:"fan_count"`
			FollowersCount int64  `json:"followers_count"`
			Picture        struct {
				Data struct {
					URL string `json:"url"`
				} `json:"data"`
			} `json:"picture"`
			Cover struct {
				Source string `json:"source"`
			} `json:"cover"`
		}
		endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) +
			"?fields=link,fan_count,followers_count,picture{url},cover{source}"
		if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &page); err != nil {
			return out, err
		}
		out.Link = page.Link
		out.Followers = fmtCount(page.FollowersCount)
		out.Likes = fmtCount(page.FanCount)
		out.FollowersN = page.FollowersCount
		out.LikesN = page.FanCount
		out.Avatar = page.Picture.Data.URL
		out.Banner = page.Cover.Source
		return out, nil
	})
	if err == nil {
		ls.ChannelURL = info.Link
		if ls.StreamURL == "" {
			ls.StreamURL = info.Link
		}
		ls.AvatarURL = info.Avatar
		ls.BannerURL = info.Banner
		if info.Followers != "" && info.Followers != "0" {
			ls.Details = append(ls.Details, DetailItem{"Followers", info.Followers})
		}
		if info.Likes != "" && info.Likes != "0" {
			ls.Details = append(ls.Details, DetailItem{"Page likes", info.Likes})
		}
	}
	return ls
}

// keyIGChannelInfo caches the slow-moving Instagram account data.
const keyIGChannelInfo = "instagram_channel_info_v2"

type igChannelInfo struct {
	Followers string `json:"followers"`
	Posts     string `json:"posts"`
	Avatar    string `json:"avatar"`
	// The raw counts, for the aggregate hero and the daily history (see
	// metrics.go); the strings above are formatted for display.
	FollowersN int64 `json:"followersN"`
	PostsN     int64 `json:"postsN"`
}

// igLiveNow returns the account's live media id ("" when not live),
// memoising it for the chat/send paths. Live media exist only while
// broadcasting.
func (a *App) igLiveNow(conn serviceConn) (string, error) {
	var r struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) + "/live_media?limit=1&fields=id"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err != nil {
		return "", err
	}
	id := ""
	if len(r.Data) > 0 {
		id = r.Data[0].ID
	}
	a.mu.Lock()
	a.igLiveMediaID = id
	a.mu.Unlock()
	return id, nil
}

// fetchInstagramLive gathers the account's live state. Instagram's API
// exposes no viewer count for live media.
func (a *App) fetchInstagramLive(conn serviceConn) LiveStream {
	ls := LiveStream{
		Platform:     "instagram",
		ChannelName:  conn.account,
		ChannelLogin: conn.login,
		ChannelURL:   "https://instagram.com/" + conn.login,
		StreamURL:    "https://instagram.com/" + conn.login + "/live",
		Details:      []DetailItem{},
	}

	mediaID, err := a.igLiveNow(conn)
	if err != nil {
		log.Printf("jax: instagram live: %v", err)
		if strings.Contains(err.Error(), "(190)") || strings.Contains(err.Error(), "code\":190") {
			ls.Error = errReauth
		} else {
			ls.Error = "Could not reach the Instagram API."
		}
		return ls
	}
	if mediaID != "" {
		ls.Live = true
		ls.Details = append(ls.Details,
			DetailItem{"Viewer count", "Not exposed by Instagram's API"},
			// Stopping the encoder leaves an Instagram Live open, and the API
			// offers no end-broadcast call — only the user can close it.
			DetailItem{"Still live?", "Stopping OBS does not end an Instagram Live — end it from the Instagram app or the Live Producer page"},
		)
	}

	info, _, _, err := cachedJSON(a, keyIGChannelInfo, apiCacheTTL, false, func() (igChannelInfo, error) {
		out := igChannelInfo{}
		var user struct {
			FollowersCount    int64  `json:"followers_count"`
			MediaCount        int64  `json:"media_count"`
			ProfilePictureURL string `json:"profile_picture_url"`
		}
		endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) +
			"?fields=followers_count,media_count,profile_picture_url"
		if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &user); err != nil {
			return out, err
		}
		out.Followers = fmtCount(user.FollowersCount)
		out.Posts = fmtCount(user.MediaCount)
		out.FollowersN = user.FollowersCount
		out.PostsN = user.MediaCount
		out.Avatar = user.ProfilePictureURL
		return out, nil
	})
	if err == nil {
		ls.AvatarURL = info.Avatar
		if info.Followers != "" {
			ls.Details = append(ls.Details, DetailItem{"Followers", info.Followers})
		}
		if info.Posts != "" {
			ls.Details = append(ls.Details, DetailItem{"Posts", info.Posts})
		}
	}
	return ls
}

// metaTimeToRFC3339 normalises Graph timestamps ("2006-01-02T15:04:05+0000")
// to RFC3339.
func metaTimeToRFC3339(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if t, err := time.Parse("2006-01-02T15:04:05-0700", s); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	return s
}

// ---------------------------------------------------------------------------
// Chat (polled, like YouTube; the frontend dedupes by message id)
// ---------------------------------------------------------------------------

// metaChatPoll is the interval the frontend waits between Meta chat polls.
const metaChatPollMs = 10_000

// GetFacebookLiveChat returns the newest comments on the Page's live video.
// Pages are read newest-first and reversed; the frontend's dedupe absorbs
// the overlap between polls.
func (a *App) GetFacebookLiveChat() (LiveChatPage, error) {
	page := LiveChatPage{Messages: []ChatMessage{}, Events: []LiveEvent{}, PollIntervalMs: metaChatPollMs}
	conn, ok := a.freshConn("facebook")
	if !ok {
		return page, fmt.Errorf("Facebook is not connected")
	}

	a.mu.Lock()
	videoID := a.fbLiveVideoID
	a.mu.Unlock()
	if videoID == "" {
		if live, err := a.fbLiveNow(conn); err != nil || live == nil {
			return page, err
		}
		a.mu.Lock()
		videoID = a.fbLiveVideoID
		a.mu.Unlock()
	}

	var r struct {
		Data []struct {
			ID      string `json:"id"`
			Message string `json:"message"`
			From    struct {
				ID      string `json:"id"`
				Name    string `json:"name"`
				Picture struct {
					Data struct {
						URL string `json:"url"`
					} `json:"data"`
				} `json:"picture"`
			} `json:"from"`
			CreatedTime string `json:"created_time"`
		} `json:"data"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(videoID) +
		"/comments?order=reverse_chronological&live_filter=no_filter&limit=25&fields=id,message,from{id,name,picture{url}},created_time"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err != nil {
		// The live video may have just ended; re-resolve on the next poll.
		a.mu.Lock()
		a.fbLiveVideoID = ""
		a.mu.Unlock()
		return page, err
	}

	page.Live = true
	for i := len(r.Data) - 1; i >= 0; i-- { // oldest first
		c := r.Data[i]
		if c.Message == "" {
			continue
		}
		page.Messages = append(page.Messages, ChatMessage{
			ID:       c.ID,
			Platform: "facebook",
			// Comments from users who haven't granted the app visibility
			// arrive without a `from`; label them rather than dropping them.
			Author:      firstNonEmpty(c.From.Name, "Facebook viewer"),
			AuthorID:    c.From.ID,
			AvatarURL:   c.From.Picture.Data.URL,
			Badges:      []string{},
			Text:        c.Message,
			PublishedAt: metaTimeToRFC3339(c.CreatedTime),
		})
	}
	return page, nil
}

// GetInstagramLiveChat returns the newest comments on the account's live
// media. Only readable while the broadcast runs.
func (a *App) GetInstagramLiveChat() (LiveChatPage, error) {
	page := LiveChatPage{Messages: []ChatMessage{}, Events: []LiveEvent{}, PollIntervalMs: metaChatPollMs}
	conn, ok := a.freshConn("instagram")
	if !ok {
		return page, fmt.Errorf("Instagram is not connected")
	}

	a.mu.Lock()
	mediaID := a.igLiveMediaID
	a.mu.Unlock()
	if mediaID == "" {
		id, err := a.igLiveNow(conn)
		if err != nil || id == "" {
			return page, err
		}
		mediaID = id
	}

	var r struct {
		Data []struct {
			ID       string `json:"id"`
			Text     string `json:"text"`
			Username string `json:"username"`
			From     struct {
				ID       string `json:"id"`
				Username string `json:"username"`
			} `json:"from"`
			Timestamp string `json:"timestamp"`
		} `json:"data"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(mediaID) +
		"/comments?fields=id,text,username,from{id,username},timestamp"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err != nil {
		a.mu.Lock()
		a.igLiveMediaID = ""
		a.mu.Unlock()
		return page, err
	}

	page.Live = true
	for _, c := range r.Data {
		if c.Text == "" {
			continue
		}
		author := firstNonEmpty(c.Username, c.From.Username, "Instagram viewer")
		page.Messages = append(page.Messages, ChatMessage{
			ID:          c.ID,
			Platform:    "instagram",
			Author:      author,
			AuthorID:    c.From.ID,
			Badges:      []string{},
			Text:        c.Text,
			PublishedAt: metaTimeToRFC3339(c.Timestamp),
		})
	}
	return page, nil
}

// sendFacebookChat comments on the live video as the Page.
func (a *App) sendFacebookChat(conn serviceConn, message string) (int, error) {
	live, err := a.fbLiveNow(conn)
	if err != nil {
		return 0, err
	}
	if live == nil {
		return 0, fmt.Errorf("no live Facebook broadcast to comment on")
	}
	return httpx.PostJSON(
		fbGraphURL+"/"+url.PathEscape(live.ID)+"/comments",
		metaHeaders(conn.token), map[string]string{"message": message}, nil,
	)
}

// sendInstagramChat comments on the live media as the account.
func (a *App) sendInstagramChat(conn serviceConn, message string) (int, error) {
	mediaID, err := a.igLiveNow(conn)
	if err != nil {
		return 0, err
	}
	if mediaID == "" {
		return 0, fmt.Errorf("no live Instagram broadcast to comment on")
	}
	return httpx.PostJSON(
		fbGraphURL+"/"+url.PathEscape(mediaID)+"/comments",
		metaHeaders(conn.token), map[string]string{"message": message}, nil,
	)
}

// ---------------------------------------------------------------------------
// Past streams & videos (Facebook only — Instagram live media leave no VOD)
// ---------------------------------------------------------------------------

// fetchFacebookPastLives maps the Page's finished live videos into past
// broadcasts.
func (a *App) fetchFacebookPastLives(conn serviceConn) ([]PastBroadcast, error) {
	var r struct {
		Data []struct {
			Title        string `json:"title"`
			PermalinkURL string `json:"permalink_url"`
			CreationTime string `json:"creation_time"`
			Video        struct {
				ID     string  `json:"id"`
				Length float64 `json:"length"`
			} `json:"video"`
		} `json:"data"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) +
		`/live_videos?broadcast_status=["VOD"]&limit=20&fields=title,permalink_url,creation_time,video{id,length}`
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err != nil {
		return nil, err
	}
	out := make([]PastBroadcast, 0, len(r.Data))
	for _, v := range r.Data {
		if v.PermalinkURL == "" {
			continue
		}
		secs := int(v.Video.Length)
		out = append(out, PastBroadcast{
			Platform:     "facebook",
			Title:        v.Title,
			URL:          fbPermalink(v.PermalinkURL),
			StartedAt:    metaTimeToRFC3339(v.CreationTime),
			Duration:     compactDuration(secs),
			DurationSecs: secs,
		})
	}
	return out, nil
}

// fetchFacebookVideos maps the Page's video catalogue.
func (a *App) fetchFacebookVideos(conn serviceConn) ([]Video, error) {
	var r struct {
		Data []struct {
			ID           string  `json:"id"`
			Title        string  `json:"title"`
			Description  string  `json:"description"`
			PermalinkURL string  `json:"permalink_url"`
			CreatedTime  string  `json:"created_time"`
			Length       float64 `json:"length"`
			LiveStatus   string  `json:"live_status"`
			Picture      string  `json:"picture"`
		} `json:"data"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) +
		"/videos?limit=50&fields=id,title,description,permalink_url,created_time,length,live_status,picture"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err != nil {
		return nil, err
	}
	out := make([]Video, 0, len(r.Data))
	for _, v := range r.Data {
		kind := "Upload"
		if v.LiveStatus != "" {
			kind = "Live VOD"
		}
		secs := int(v.Length)
		out = append(out, Video{
			Platform:     "facebook",
			ID:           v.ID,
			Title:        firstNonEmpty(v.Title, v.Description),
			Description:  v.Description,
			URL:          fbPermalink(v.PermalinkURL),
			ThumbnailURL: v.Picture,
			PublishedAt:  metaTimeToRFC3339(v.CreatedTime),
			Duration:     compactDuration(secs),
			DurationSecs: secs,
			Kind:         kind,
			ChannelName:  conn.account,
		})
	}
	return out, nil
}

// fetchFacebookVideoDetails returns one video's details plus engagement
// summaries.
func (a *App) fetchFacebookVideoDetails(conn serviceConn, id string) (VideoDetails, error) {
	var v struct {
		ID           string  `json:"id"`
		Title        string  `json:"title"`
		Description  string  `json:"description"`
		PermalinkURL string  `json:"permalink_url"`
		CreatedTime  string  `json:"created_time"`
		Length       float64 `json:"length"`
		Picture      string  `json:"picture"`
		Comments     struct {
			Summary struct {
				TotalCount int64 `json:"total_count"`
			} `json:"summary"`
		} `json:"comments"`
		Likes struct {
			Summary struct {
				TotalCount int64 `json:"total_count"`
			} `json:"summary"`
		} `json:"likes"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(id) +
		"?fields=id,title,description,permalink_url,created_time,length,picture,comments.limit(0).summary(true),likes.limit(0).summary(true)"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &v); err != nil {
		return VideoDetails{}, err
	}
	secs := int(v.Length)
	return VideoDetails{
		Video: Video{
			Platform:     "facebook",
			ID:           v.ID,
			Title:        firstNonEmpty(v.Title, v.Description),
			Description:  v.Description,
			URL:          fbPermalink(v.PermalinkURL),
			ThumbnailURL: v.Picture,
			PublishedAt:  metaTimeToRFC3339(v.CreatedTime),
			Duration:     compactDuration(secs),
			DurationSecs: secs,
			ChannelName:  conn.account,
		},
		Stats: []DetailItem{
			{Label: "Likes", Value: fmtCount(v.Likes.Summary.TotalCount)},
			{Label: "Comments", Value: fmtCount(v.Comments.Summary.TotalCount)},
		},
		Comments:     []VideoComment{},
		CommentsNote: "Comment threads open on Facebook — the API returns counts here.",
	}, nil
}

// ---------------------------------------------------------------------------
// Stream info (plans)
// ---------------------------------------------------------------------------

// applyPlanToFacebook does two things: writes the plan's title and
// description onto the Page's CURRENT live video (when one exists — the
// Page may go live via its own stream key rather than the app), and posts
// the go-live announcement to the Page feed once the stream session is on
// the air (once per plan; see announce.go).
func (a *App) applyPlanToFacebook(plan PlannedStream, _ *ContentSeries) string {
	conn, ok := a.freshConn("facebook")
	if !ok {
		return "Facebook is not connected — its stream info was not updated."
	}
	var warnings []string

	live, err := a.fbLiveNow(conn)
	switch {
	case err != nil:
		log.Printf("jax: apply plan to facebook: %v", err)
		warnings = append(warnings, "Facebook: the stream info could not be updated.")
	case live == nil:
		warnings = append(warnings, "Facebook: no live video to retitle — it exists once a stream reaches the Page.")
	default:
		payload := map[string]string{"title": broadcastBaseTitle(plan)}
		if strings.TrimSpace(plan.Description) != "" {
			payload["description"] = plan.Description
		}
		if _, err := httpx.PostJSON(fbGraphURL+"/"+url.PathEscape(live.ID), metaHeaders(conn.token), payload, nil); err != nil {
			log.Printf("jax: apply plan to facebook: %v", err)
			warnings = append(warnings, "Facebook: the stream info could not be updated.")
		}
	}

	if w := a.fbAnnouncePlan(conn, plan); w != "" {
		warnings = append(warnings, w)
	}
	return strings.Join(warnings, " ")
}

// fbAnnouncePlan posts the go-live announcement to the Page feed — once per
// plan, only while the plan's session is on the air (mirrors X).
func (a *App) fbAnnouncePlan(conn serviceConn, plan PlannedStream) string {
	if a.planAnnounced("facebook", plan.ID) {
		return ""
	}
	session := a.GetActiveStreamSession()
	if !session.Active || session.PlanID != plan.ID {
		return "Facebook: the go-live announcement posts once the stream is on the air."
	}

	links := a.watchLinks(3)
	payload := map[string]string{
		"message": announcementBody(broadcastBaseTitle(plan), links, 0),
	}
	if len(links) > 0 {
		payload["link"] = links[0] // the first watch link gets the preview card
	}
	var resp struct {
		ID string `json:"id"`
	}
	status, err := httpx.PostJSON(
		fbGraphURL+"/"+url.PathEscape(conn.userID)+"/feed",
		metaHeaders(conn.token), payload, &resp,
	)
	if err != nil {
		log.Printf("jax: facebook announce: %v", err)
		if status == 401 || status == 403 {
			return "Facebook: reconnect in Settings → Services to grant the pages_manage_posts permission."
		}
		return "Facebook: the announcement could not be posted."
	}
	a.markAnnounced("facebook", plan.ID, resp.ID)
	return ""
}

// facebookInfoStatus compares the current live video's title with the plan's.
func (a *App) facebookInfoStatus(plan PlannedStream) PlanChannelInfo {
	info := PlanChannelInfo{Channel: "facebook", WantTitle: broadcastBaseTitle(plan)}
	conn, ok := a.freshConn("facebook")
	if !ok {
		info.Detail = "Facebook is not connected."
		return info
	}
	info.Connected = true
	live, err := a.fbLiveNow(conn)
	if err != nil {
		log.Printf("jax: facebook info status: %v", err)
		info.Detail = "Could not read the current stream info."
		return info
	}
	if live == nil {
		info.Detail = "No live broadcast to check — the title applies once the stream is up."
		return info
	}
	info.CurrentTitle = live.Title
	info.Matches = info.CurrentTitle == info.WantTitle
	return info
}

// instagramInfoStatus: Instagram Live carries no editable stream info at all,
// so the check reports that rather than blocking Go Live.
func (a *App) instagramInfoStatus(_ PlannedStream) PlanChannelInfo {
	info := PlanChannelInfo{Channel: "instagram"}
	_, ok := a.freshConn("instagram")
	info.Connected = ok
	if !ok {
		info.Detail = "Instagram is not connected."
		return info
	}
	info.Detail = "Instagram Live carries no editable stream info."
	return info
}

// ---------------------------------------------------------------------------
// Chat user popups
// ---------------------------------------------------------------------------

// fetchFacebookChatUser resolves a commenter minimally — Graph exposes only
// what the commenter shares with the Page (often just the id and name).
func fetchFacebookChatUser(conn serviceConn, id string) (ChatUserInfo, error) {
	if id == "" {
		return ChatUserInfo{}, fmt.Errorf("facebook did not identify this commenter")
	}
	info := ChatUserInfo{
		Platform:   "facebook",
		ID:         id,
		ChannelURL: "https://facebook.com/" + url.PathEscape(id),
		Follower:   "unknown",
		Subscriber: "unknown",
	}
	var u struct {
		Name    string `json:"name"`
		Picture struct {
			Data struct {
				URL string `json:"url"`
			} `json:"data"`
		} `json:"picture"`
	}
	if _, err := httpx.GetJSON(fbGraphURL+"/"+url.PathEscape(id)+"?fields=name,picture{url}", metaHeaders(conn.token), &u); err == nil {
		info.DisplayName = u.Name
		info.AvatarURL = u.Picture.Data.URL
	}
	if info.DisplayName == "" {
		info.DisplayName = "Facebook viewer"
	}
	return info, nil
}

// fetchInstagramChatUser resolves a commenter through business discovery
// (works for business/creator accounts; personal accounts degrade to a
// profile link).
func fetchInstagramChatUser(conn serviceConn, username string) (ChatUserInfo, error) {
	username = strings.TrimSpace(strings.TrimPrefix(username, "@"))
	if username == "" {
		return ChatUserInfo{}, fmt.Errorf("instagram did not identify this commenter")
	}
	info := ChatUserInfo{
		Platform:    "instagram",
		DisplayName: "@" + username,
		ChannelURL:  "https://instagram.com/" + url.PathEscape(username),
		Follower:    "unknown",
		Subscriber:  "unknown",
	}
	var r struct {
		BusinessDiscovery struct {
			FollowersCount    int64  `json:"followers_count"`
			MediaCount        int64  `json:"media_count"`
			ProfilePictureURL string `json:"profile_picture_url"`
			Biography         string `json:"biography"`
		} `json:"business_discovery"`
	}
	endpoint := fbGraphURL + "/" + url.PathEscape(conn.userID) +
		"?fields=business_discovery.username(" + url.QueryEscape(username) +
		"){followers_count,media_count,profile_picture_url,biography}"
	if _, err := httpx.GetJSON(endpoint, metaHeaders(conn.token), &r); err == nil {
		bd := r.BusinessDiscovery
		info.AvatarURL = bd.ProfilePictureURL
		info.Description = bd.Biography
		if bd.FollowersCount > 0 {
			info.Details = append(info.Details, DetailItem{"Followers", fmtCount(bd.FollowersCount)})
		}
		if bd.MediaCount > 0 {
			info.Details = append(info.Details, DetailItem{"Posts", fmtCount(bd.MediaCount)})
		}
	}
	return info, nil
}

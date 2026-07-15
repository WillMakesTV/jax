package main

import (
	"fmt"
	"net/url"
	"strings"
)

// ---------------------------------------------------------------------------
// Tracked-video shares
//
// A finished video rarely lives in one place: the plan publishes to YouTube
// and/or TikTok from the app, and the producer reposts it to Instagram,
// Facebook, or anywhere else by hand. The plan's ShareURLs collect those
// hand-posted addresses; here they join the publish records and resolve
// against the connected channels' video lists so a tracked video can show
// every posting and one aggregated view count.
// ---------------------------------------------------------------------------

// TrackedShare is one place the published video lives.
type TrackedShare struct {
	URL      string `json:"url"`
	Platform string `json:"platform"` // "" when the host isn't recognized
	Source   string `json:"source"`   // "publish" (from a publish record) | "manual"
	// Video is the live listing the URL resolved to; nil when none of the
	// connected channels lists it (its views are then unknown).
	Video *Video `json:"video"`
}

// Share sources.
const (
	shareSourcePublish = "publish"
	shareSourceManual  = "manual"
)

// maxShareURLs caps a plan's hand-added share list.
const maxShareURLs = 24

// parseVideoURL extracts the platform and, where the public URL carries it,
// the platform's video id from a video link. Best-effort: an unrecognized
// host returns ("", ""); a recognized host whose URL shape doesn't expose the
// API id (Instagram shortcodes, share-redirect hosts) returns (platform, "").
func parseVideoURL(raw string) (platform, id string) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", ""
	}
	host := strings.ToLower(u.Hostname())
	host = strings.TrimPrefix(host, "www.")
	segs := strings.FieldsFunc(u.Path, func(r rune) bool { return r == '/' })
	seg := func(i int) string {
		if i < 0 || i >= len(segs) {
			return ""
		}
		return segs[i]
	}

	switch {
	case host == "youtu.be":
		return "youtube", seg(0)
	case host == "youtube.com" || strings.HasSuffix(host, ".youtube.com"):
		switch seg(0) {
		case "watch":
			return "youtube", u.Query().Get("v")
		case "shorts", "live", "embed", "v":
			return "youtube", seg(1)
		}
		return "youtube", ""
	case host == "vm.tiktok.com" || host == "vt.tiktok.com":
		// Share-redirect links; the real id is behind a redirect we don't
		// follow.
		return "tiktok", ""
	case host == "tiktok.com" || strings.HasSuffix(host, ".tiktok.com"):
		// /@handle/video/<id>
		if strings.HasPrefix(seg(0), "@") && seg(1) == "video" {
			return "tiktok", seg(2)
		}
		return "tiktok", ""
	case host == "instagram.com" || strings.HasSuffix(host, ".instagram.com"):
		// Permalinks carry the shortcode, which is not the Graph media id —
		// Instagram shares match by URL instead (see resolveTrackedShares).
		return "instagram", ""
	case host == "fb.watch":
		return "facebook", ""
	case host == "facebook.com" || strings.HasSuffix(host, ".facebook.com"):
		if seg(0) == "reel" {
			return "facebook", seg(1)
		}
		if seg(0) == "watch" {
			return "facebook", u.Query().Get("v")
		}
		for i, s := range segs {
			if s == "videos" {
				return "facebook", seg(i + 1)
			}
		}
		return "facebook", ""
	case host == "kick.com" || strings.HasSuffix(host, ".kick.com"):
		// /<login>/videos/<uuid>
		if seg(1) == "videos" {
			return "kick", seg(2)
		}
		return "kick", ""
	case host == "clips.twitch.tv":
		return "twitch", seg(0)
	case host == "twitch.tv" || strings.HasSuffix(host, ".twitch.tv"):
		if seg(0) == "videos" {
			return "twitch", seg(1)
		}
		if seg(1) == "clip" {
			return "twitch", seg(2)
		}
		return "twitch", ""
	}
	return "", ""
}

// normalizeVideoURL reduces a video link to a comparable form: no scheme, no
// "www."/"m." host prefix, no fragment, and no query except the "v" video id
// YouTube and Facebook watch URLs carry. "" when raw isn't a URL with a host.
//
// Instagram serves one posting under several paths — /reel/CODE, /reels/CODE,
// /p/CODE, /tv/CODE, any of them optionally prefixed with the account's
// username — so its links normalize to the shortcode's canonical /reel/ form,
// or a hand-pasted variant would never match the API permalink and the share
// would stay unresolved.
func normalizeVideoURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	host = strings.TrimPrefix(host, "www.")
	host = strings.TrimPrefix(host, "m.")
	if host == "instagram.com" || strings.HasSuffix(host, ".instagram.com") {
		if code := instagramShortcode(u.Path); code != "" {
			return "instagram.com/reel/" + code
		}
	}
	path := strings.TrimRight(u.Path, "/")
	if v := u.Query().Get("v"); v != "" {
		return host + path + "?v=" + v
	}
	return host + path
}

// instagramShortcode pulls the media shortcode out of an Instagram URL path,
// "" when the path doesn't carry one. /share/... redirect links hold an opaque
// share token, not the shortcode, and stay unrecognized.
func instagramShortcode(path string) string {
	segs := strings.FieldsFunc(path, func(r rune) bool { return r == '/' })
	if len(segs) > 0 && strings.EqualFold(segs[0], "share") {
		return ""
	}
	for i, s := range segs {
		switch strings.ToLower(s) {
		case "reel", "reels", "p", "tv":
			if i+1 < len(segs) {
				return segs[i+1]
			}
		}
	}
	return ""
}

// resolveTrackedShares joins a completed plan's postings — the publish
// records first, then the hand-added ShareURLs — against the live video
// indexes. total counts each resolved video once, however many URLs point at
// it; unresolved shares are listed but contribute nothing.
func resolveTrackedShares(
	plan VideoPlan,
	rec *VideoPublishRecord,
	tik *TikTokPublishRecord,
	byKey, byURL map[string]*Video,
) (shares []TrackedShare, total int64) {
	shares = []TrackedShare{}
	seenVideo := map[string]bool{} // "platform|id" of resolved videos
	seenURL := map[string]bool{}   // normalized URLs already listed

	add := func(rawURL, platform, source string, v *Video) {
		if v != nil {
			key := v.Platform + "|" + v.ID
			if seenVideo[key] {
				return
			}
			seenVideo[key] = true
			total += v.ViewCount
			platform = v.Platform
		}
		if n := normalizeVideoURL(rawURL); n != "" {
			if seenURL[n] {
				return
			}
			seenURL[n] = true
		}
		shares = append(shares, TrackedShare{
			URL: rawURL, Platform: platform, Source: source, Video: v,
		})
	}

	resolve := func(rawURL string) (string, *Video) {
		platform, id := parseVideoURL(rawURL)
		if id != "" {
			if v, ok := byKey[platform+"|"+id]; ok {
				return platform, v
			}
		}
		if v, ok := byURL[normalizeVideoURL(rawURL)]; ok {
			return platform, v
		}
		return platform, nil
	}

	if rec != nil {
		v := byKey["youtube|"+rec.VideoID]
		add(rec.URL, "youtube", shareSourcePublish, v)
	}
	// A TikTok record may carry no URL (unaudited apps post SELF_ONLY and get
	// no share link back); it can't be listed or matched then.
	if tik != nil && tik.URL != "" {
		platform, v := resolve(tik.URL)
		if platform == "" {
			platform = "tiktok"
		}
		add(tik.URL, platform, shareSourcePublish, v)
	}
	for _, u := range plan.ShareURLs {
		platform, v := resolve(u)
		add(u, platform, shareSourceManual, v)
	}
	return shares, total
}

// SetVideoPlanShares replaces a plan's hand-added share URLs and returns the
// plan's tracked view with the shares resolved, so the caller sees the new
// aggregate immediately.
func (a *App) SetVideoPlanShares(planID string, urls []string) (TrackedVideo, error) {
	if a.store == nil {
		return TrackedVideo{}, fmt.Errorf("storage unavailable")
	}

	clean := []string{}
	seen := map[string]bool{}
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return TrackedVideo{}, fmt.Errorf("%q is not a link that can be tracked", raw)
		}
		n := normalizeVideoURL(raw)
		if seen[n] {
			continue
		}
		seen[n] = true
		clean = append(clean, raw)
	}
	if len(clean) > maxShareURLs {
		return TrackedVideo{}, fmt.Errorf("a video can track at most %d share links", maxShareURLs)
	}

	plans := a.GetVideoPlans()
	found := false
	for i := range plans {
		if plans[i].ID != planID {
			continue
		}
		plans[i].ShareURLs = clean
		found = true
		break
	}
	if !found {
		return TrackedVideo{}, fmt.Errorf("that video plan no longer exists")
	}
	// The stored form carries file names, not the URLs derived per launch.
	stored := make([]VideoPlan, len(plans))
	copy(stored, plans)
	for j := range stored {
		stored[j].ThumbnailURL = ""
		stored[j].ThumbnailHistoryURLs = nil
	}
	if err := a.store.setJSON(keyVideoPlans, stored); err != nil {
		return TrackedVideo{}, err
	}

	for _, t := range a.GetTrackedVideos() {
		if t.Plan.ID == planID {
			return t, nil
		}
	}
	// The plan exists but isn't completed (shares can be set regardless);
	// hand back an unresolved view rather than an error.
	for _, p := range a.GetVideoPlans() {
		if p.ID == planID {
			return TrackedVideo{Plan: p, Shares: []TrackedShare{}}, nil
		}
	}
	return TrackedVideo{}, fmt.Errorf("that video plan no longer exists")
}

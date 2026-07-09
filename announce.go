package main

import (
	"log"
	"strings"
)

// ---------------------------------------------------------------------------
// Go-live announcements
//
// Plans can target social platforms (X, Facebook) that don't carry the
// stream but announce it: applying the plan while the stream session is ON
// THE AIR posts one announcement — the plan's title plus the connected
// channels' watch links. The posted ids are persisted per platform+plan so
// re-applies (Update Stream Info re-runs, routine retries) never post twice.
//
// Instagram is the odd one out: its API cannot create text posts (feed and
// story publishing require publicly hosted media, which a desktop app cannot
// provide), so Instagram announcements are deliberately unsupported.
// ---------------------------------------------------------------------------

// keyAnnouncedPlans maps "<platform>|<planID>" → posted announcement id.
const keyAnnouncedPlans = "announced_plans"

// announcedPlans loads the announcement record ({} when none).
func (a *App) announcedPlans() map[string]string {
	out := map[string]string{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyAnnouncedPlans, &out); err != nil {
			log.Printf("jax: announced plans: %v", err)
		}
	}
	return out
}

// planAnnounced reports whether the plan already announced on the platform.
func (a *App) planAnnounced(platform, planID string) bool {
	return a.announcedPlans()[platform+"|"+planID] != ""
}

// markAnnounced records a posted announcement.
func (a *App) markAnnounced(platform, planID, postID string) {
	announced := a.announcedPlans()
	announced[platform+"|"+planID] = firstNonEmpty(postID, "posted")
	if a.store != nil {
		if err := a.store.setJSON(keyAnnouncedPlans, announced); err != nil {
			log.Printf("jax: persist announcement: %v", err)
		}
	}
}

// watchLinks returns the connected streaming channels' watch URLs, capped so
// announcements stay tight.
func (a *App) watchLinks(max int) []string {
	var links []string
	if conn, ok := a.getConn("twitch"); ok && conn.login != "" {
		links = append(links, "https://twitch.tv/"+conn.login)
	}
	if conn, ok := a.getConn("youtube"); ok && conn.userID != "" {
		links = append(links, "https://youtube.com/channel/"+conn.userID+"/live")
	}
	if conn, ok := a.getConn("kick"); ok && conn.login != "" {
		links = append(links, "https://kick.com/"+conn.login)
	}
	if max > 0 && len(links) > max {
		links = links[:max]
	}
	return links
}

// announcementBody composes the announcement: live marker + title + watch
// links. maxRunes > 0 trims the headline to fit platforms with length caps
// (X); the links ride below the headline either way.
func announcementBody(title string, links []string, maxRunes int) string {
	suffix := ""
	if len(links) > 0 {
		suffix = "\n\n" + strings.Join(links, "\n")
	}
	text := "🔴 Live now: " + title
	if maxRunes > 0 {
		budget := maxRunes - len([]rune(suffix))
		if runes := []rune(text); len(runes) > budget && budget > 20 {
			text = string(runes[:budget-1]) + "…"
		}
	}
	return text + suffix
}

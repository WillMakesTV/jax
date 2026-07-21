package main

import (
	"bp-temp/internal/httpx"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// ---------------------------------------------------------------------------
// Pushing a stream's description to YouTube
//
// Like thumbnails (see youtube_thumb.go), a past stream's description only
// lives locally until it is written onto the VOD via videos.update. The text
// each stream last pushed is recorded so the UI can tell when the YouTube
// video is showing an older description and offer to update it.
// ---------------------------------------------------------------------------

// keyStreamDescPush stores the startedAt → last-pushed-description map.
const keyStreamDescPush = "past_stream_desc_push"

// descPushes loads the saved startedAt → pushed-description map. Never nil.
func (a *App) descPushes() map[string]string {
	m := map[string]string{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamDescPush, &m); err != nil {
			log.Printf("jax: load description pushes: %v", err)
		}
	}
	if m == nil {
		return map[string]string{}
	}
	return m
}

// UpdateYouTubeDescription writes the description onto the stream's YouTube
// VOD(s) and records the push. The caller persists the description first
// (SetStreamDescription), so what YouTube receives matches what the app
// shows. videoURLs are the stream's YouTube watch URLs (usually one).
func (a *App) UpdateYouTubeDescription(startedAt, description string, videoURLs []string) error {
	if strings.TrimSpace(description) == "" {
		return fmt.Errorf("write or generate a description first")
	}
	ids := []string{}
	for _, raw := range videoURLs {
		if id := youtubeVideoID(raw); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return fmt.Errorf("no YouTube video found for this stream")
	}

	conn, ok := a.freshConn("youtube")
	if !ok {
		return fmt.Errorf("connect YouTube in Settings → Services first")
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	for _, id := range ids {
		// videos.update replaces the whole snippet, so read the current one
		// and change only the description — the title, category, and tags
		// set elsewhere survive.
		var videos struct {
			Items []struct {
				Snippet map[string]any `json:"snippet"`
			} `json:"items"`
		}
		if _, err := httpx.GetJSON(
			"https://www.googleapis.com/youtube/v3/videos?part=snippet&id="+id,
			headers, &videos,
		); err != nil {
			return fmt.Errorf("the YouTube video's details could not be read: %v", err)
		}
		if len(videos.Items) == 0 {
			return fmt.Errorf("the YouTube video was not found — it may have been deleted")
		}
		snippet := videos.Items[0].Snippet
		snippet["description"] = description

		status, err := httpx.SendJSON(http.MethodPut,
			"https://www.googleapis.com/youtube/v3/videos?part=snippet",
			headers, map[string]any{"id": id, "snippet": snippet}, nil)
		if err != nil {
			if status == 401 || status == 403 {
				return fmt.Errorf("YouTube: reconnect in Settings → Services to grant the update permission")
			}
			return fmt.Errorf("YouTube rejected the description update: %v", err)
		}
	}

	if a.store != nil {
		pushes := a.descPushes()
		pushes[startedAt] = description
		if err := a.store.setJSON(keyStreamDescPush, pushes); err != nil {
			return err
		}
	}
	return nil
}

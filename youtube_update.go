package main

import (
	"fmt"
	"log"
	"net/http"
	"strings"
)

// ---------------------------------------------------------------------------
// One-shot "Update YouTube" for a past stream
//
// A past stream's identity lives in the app — its (plan or renamed) title,
// description, and custom thumbnail. UpdateYouTubeStreamInfo writes all of
// it onto the stream's YouTube VOD(s) as one user action: the snippet's
// title and description in a single videos.update per video, then the
// thumbnail via thumbnails.set. The "🔴 LIVE: " prefix belongs to live
// broadcasts only, so it is stripped from the pushed title — the broadcast
// is over. Supersedes the separate description/thumbnail pushes
// (youtube_desc.go, youtube_thumb.go), whose push records it keeps updated.
// ---------------------------------------------------------------------------

// keyStreamTitlePush stores the startedAt → last-pushed-title map.
const keyStreamTitlePush = "past_stream_title_push"

// YouTubePushResult reports what one "Update YouTube" action wrote.
type YouTubePushResult struct {
	// Title as pushed — the stream's effective title, live prefix removed.
	Title string `json:"title"`
	// DescriptionPushed is false when the stream has no description yet (the
	// VOD's current text is left alone).
	DescriptionPushed bool `json:"descriptionPushed"`
	// ThumbnailPushed is false when the stream has no custom thumbnail.
	ThumbnailPushed bool `json:"thumbnailPushed"`
	// Thumb is the refreshed custom-thumbnail record when one was pushed.
	Thumb StreamThumbInfo `json:"thumb"`
	// Warning carries a non-fatal problem (e.g. the thumbnail upload failed
	// after the title and description already landed).
	Warning string `json:"warning"`
}

// stripLivePrefix removes the configured YouTube live marker (and the
// default, in case the setting changed since the broadcast) from a title.
func (a *App) stripLivePrefix(title string) string {
	t := strings.TrimSpace(title)
	for _, p := range []string{a.youtubeLivePrefix(), defaultYouTubeLivePrefix} {
		for _, prefix := range []string{p, strings.TrimSpace(p)} {
			if prefix != "" && strings.HasPrefix(t, prefix) {
				t = strings.TrimSpace(strings.TrimPrefix(t, prefix))
			}
		}
	}
	return t
}

// UpdateYouTubeStreamInfo writes the past stream's title, description, and
// custom thumbnail onto its YouTube VOD(s) in one action. videoURLs are the
// stream's YouTube watch URLs (usually one; multi-sitting streams may have
// several, and all are updated). The stream's stored state is the source of
// truth: the effective title (rename → plan → platform) with the live prefix
// stripped, the effective description (custom, else the concluded plan's),
// and the custom thumbnail when one is set.
func (a *App) UpdateYouTubeStreamInfo(startedAt string, videoURLs []string) (YouTubePushResult, error) {
	var out YouTubePushResult

	ids := []string{}
	for _, raw := range videoURLs {
		if id := youtubeVideoID(raw); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return out, fmt.Errorf("no YouTube video found for this stream")
	}

	// The aggregated stream carries the effective title/description; match by
	// its exact startedAt key.
	var stream *PastStream
	for _, s := range a.GetPastStreams(false) {
		if s.StartedAt == startedAt {
			s := s
			stream = &s
			break
		}
	}
	if stream == nil {
		return out, fmt.Errorf("this stream is no longer listed — refresh Past Streams and try again")
	}

	title := a.stripLivePrefix(stream.Title)
	if title == "" {
		return out, fmt.Errorf("this stream has no title to push — rename it first")
	}
	// YouTube caps titles at 100 characters.
	if r := []rune(title); len(r) > 100 {
		title = strings.TrimSpace(string(r[:100]))
	}
	description := strings.TrimSpace(stream.Description)

	conn, ok := a.freshConn("youtube")
	if !ok {
		return out, fmt.Errorf("connect YouTube in Settings → Services first")
	}
	headers := map[string]string{"Authorization": "Bearer " + conn.token}

	for _, id := range ids {
		// videos.update replaces the whole snippet, so read the current one
		// and change only the title and description — the category and tags
		// set elsewhere survive. One update carries both fields.
		var videos struct {
			Items []struct {
				Snippet map[string]any `json:"snippet"`
			} `json:"items"`
		}
		if _, err := getJSON(
			"https://www.googleapis.com/youtube/v3/videos?part=snippet&id="+id,
			headers, &videos,
		); err != nil {
			return out, fmt.Errorf("the YouTube video's details could not be read: %v", err)
		}
		if len(videos.Items) == 0 {
			return out, fmt.Errorf("the YouTube video was not found — it may have been deleted")
		}
		snippet := videos.Items[0].Snippet
		snippet["title"] = title
		if description != "" {
			snippet["description"] = description
		}

		status, err := sendJSON(http.MethodPut,
			"https://www.googleapis.com/youtube/v3/videos?part=snippet",
			headers, map[string]any{"id": id, "snippet": snippet}, nil)
		if err != nil {
			if status == 401 || status == 403 {
				return out, fmt.Errorf("YouTube: reconnect in Settings → Services to grant the update permission")
			}
			return out, fmt.Errorf("YouTube rejected the update: %v", err)
		}
	}
	out.Title = title
	out.DescriptionPushed = description != ""

	// Thumbnail rides along when a custom one is set. Its failure is a
	// warning, not an error — the title and description already landed.
	thumbRec := a.streamThumbs()[startedAt]
	if thumbRec.File != "" {
		thumbErr := ""
		for _, id := range ids {
			if err := a.pushThumbToVideo(conn.token, id, thumbRec.File); err != nil {
				thumbErr = err.Error()
				break
			}
		}
		if thumbErr != "" {
			out.Warning = fmt.Sprintf("The thumbnail could not be updated: %s", thumbErr)
		} else {
			out.ThumbnailPushed = true
		}
	}

	// Record what landed so the app can tell when YouTube drifts out of date.
	if a.store != nil {
		titles := map[string]string{}
		if _, err := a.store.getJSON(keyStreamTitlePush, &titles); err != nil {
			log.Printf("jax: load title pushes: %v", err)
		}
		if titles == nil {
			titles = map[string]string{}
		}
		titles[startedAt] = title
		if err := a.store.setJSON(keyStreamTitlePush, titles); err != nil {
			log.Printf("jax: record title push: %v", err)
		}
		if out.DescriptionPushed {
			pushes := a.descPushes()
			pushes[startedAt] = description
			if err := a.store.setJSON(keyStreamDescPush, pushes); err != nil {
				log.Printf("jax: record description push: %v", err)
			}
		}
		if out.ThumbnailPushed {
			pushes := a.thumbPushes()
			pushes[startedAt] = thumbRec.File
			if err := a.store.setJSON(keyStreamThumbPush, pushes); err != nil {
				log.Printf("jax: record thumbnail push: %v", err)
			}
		}
	}
	if out.ThumbnailPushed {
		out.Thumb = a.thumbInfo(thumbRec, thumbRec.File)
	}
	return out, nil
}

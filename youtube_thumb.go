package main

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------------------
// Pushing a stream's custom thumbnail to YouTube
//
// A past stream's custom thumbnail (see stream_thumbs.go) only lives locally
// until it is pushed to the VOD via thumbnails.set. Which file each stream
// last pushed is recorded, so the UI can tell when YouTube is showing an
// older image and offer to update it. YouTube re-encodes uploads, so byte
// comparison against its CDN can never confirm sync — the push record is the
// source of truth.
// ---------------------------------------------------------------------------

// keyStreamThumbPush stores the startedAt → last-pushed-file map.
const keyStreamThumbPush = "past_stream_thumb_push"

// thumbPushes loads the saved startedAt → pushed-file map. Never nil.
func (a *App) thumbPushes() map[string]string {
	m := map[string]string{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamThumbPush, &m); err != nil {
			log.Printf("jax: load thumbnail pushes: %v", err)
		}
	}
	if m == nil {
		return map[string]string{}
	}
	return m
}

// youtubeThumbSetURL is the thumbnails.set upload endpoint; the video id is
// appended as a query parameter.
const youtubeThumbSetURL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId="

// youtubeMaxThumbBytes is YouTube's thumbnail upload limit (2 MB).
const youtubeMaxThumbBytes = 2 * 1024 * 1024

// youtubeVideoID extracts the video id from a watch URL
// (youtube.com/watch?v=ID or youtu.be/ID).
func youtubeVideoID(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if id := u.Query().Get("v"); id != "" {
		return id
	}
	if strings.Contains(u.Host, "youtu.be") {
		return strings.Trim(u.Path, "/")
	}
	return ""
}

// youtubeThumbPayload prepares an image file for thumbnails.set: files within
// the size limit upload as-is; larger ones (generated PNGs routinely exceed
// 2 MB) are re-encoded as a high-quality JPEG.
func youtubeThumbPayload(path string) (data []byte, contentType string, err error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("the thumbnail file could not be read: %v", err)
	}
	types := map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".webp": "image/webp", ".gif": "image/gif",
	}
	ct := types[strings.ToLower(filepath.Ext(path))]
	if ct == "" {
		ct = "application/octet-stream"
	}
	if len(raw) <= youtubeMaxThumbBytes {
		return raw, ct, nil
	}

	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", fmt.Errorf("the thumbnail is over YouTube's 2 MB limit and could not be converted: %v", err)
	}
	for _, quality := range []int{90, 80, 70} {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
			return nil, "", err
		}
		if buf.Len() <= youtubeMaxThumbBytes {
			return buf.Bytes(), "image/jpeg", nil
		}
	}
	return nil, "", fmt.Errorf("the thumbnail is over YouTube's 2 MB limit even after conversion — use a smaller image")
}

// UpdateYouTubeThumbnail pushes the stream's current custom thumbnail to its
// YouTube VOD(s) via thumbnails.set and records the push. videoURLs are the
// stream's YouTube broadcast watch URLs (usually one; multi-sitting streams
// may have several, and all are updated). Returns the refreshed thumbnail
// info so the frontend can drop its update CTA.
func (a *App) UpdateYouTubeThumbnail(startedAt string, videoURLs []string) (StreamThumbInfo, error) {
	rec := a.streamThumbs()[startedAt]
	if rec.File == "" {
		return StreamThumbInfo{}, fmt.Errorf("this stream has no custom thumbnail to push")
	}
	dir, err := planThumbsDir()
	if err != nil {
		return StreamThumbInfo{}, err
	}
	data, contentType, err := youtubeThumbPayload(filepath.Join(dir, rec.File))
	if err != nil {
		return StreamThumbInfo{}, err
	}

	ids := []string{}
	for _, raw := range videoURLs {
		if id := youtubeVideoID(raw); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return StreamThumbInfo{}, fmt.Errorf("no YouTube video found for this stream")
	}

	conn, ok := a.freshConn("youtube")
	if !ok {
		return StreamThumbInfo{}, fmt.Errorf("connect YouTube in Settings → Services first")
	}

	for _, id := range ids {
		req, err := http.NewRequest(http.MethodPost, youtubeThumbSetURL+url.QueryEscape(id), bytes.NewReader(data))
		if err != nil {
			return StreamThumbInfo{}, err
		}
		req.Header.Set("Authorization", "Bearer "+conn.token)
		req.Header.Set("Content-Type", contentType)
		resp, err := httpClient.Do(req)
		if err != nil {
			return StreamThumbInfo{}, err
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			msg := string(body)
			if len(msg) > 300 {
				msg = msg[:300]
			}
			return StreamThumbInfo{}, fmt.Errorf("YouTube rejected the thumbnail (%d): %s", resp.StatusCode, msg)
		}
	}

	if a.store != nil {
		pushes := a.thumbPushes()
		pushes[startedAt] = rec.File
		if err := a.store.setJSON(keyStreamThumbPush, pushes); err != nil {
			return StreamThumbInfo{}, err
		}
	}
	return a.thumbInfo(rec, rec.File), nil
}

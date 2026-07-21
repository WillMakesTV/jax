package main

import (
	"bp-temp/internal/httpx"
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Publishing a produced video to TikTok
//
// The Publish tab's second destination. TikTok's Content Posting API takes the
// same direct-post shape the go-live announcement uses (init, then upload the
// bytes, then the post is processed asynchronously) — but a produced video is
// not a few hundred KB, so it cannot be slurped into memory and PUT in one go
// like the announcement card is. It is streamed up in chunks instead, which is
// what TikTok wants for anything sizeable:
//
//   - chunks are 5MB–64MB, and the last one absorbs the remainder (so it can
//     run up to 128MB); a file under 5MB goes as a single chunk.
//   - each chunk is a PUT with a Content-Range naming the byte span.
//
// AUDIT CAVEAT: an unaudited TikTok client may only post SELF_ONLY (private)
// content. The app posts at the most public level the creator-info endpoint
// offers and reports what it actually got, rather than pretending the video is
// live to the world when it is not.
// ---------------------------------------------------------------------------

const (
	// keyTikTokPublish stores the planID → TikTok publish record map.
	keyTikTokPublish = "video_plan_publish_tiktok"

	// TikTok's chunking rules, which are strict and unforgiving:
	//
	//   - chunk_size must be between 5MB and 64MB — EXCEPT for a whole file
	//     under 5MB, which goes as one chunk of exactly its own size.
	//   - total_chunk_count must equal floor(video_size / chunk_size). Not
	//     ceil. Anything else is rejected as "The chunk size is invalid".
	//   - the final chunk absorbs the remainder, so it can exceed chunk_size,
	//     but must stay under 128MB.
	//
	// The floor rule is the trap: a chunk_size larger than the file gives a
	// count of zero, so a chunk_size must never exceed the video it is cutting.
	tiktokChunkMin = 5 << 20   // 5MB
	tiktokChunkMax = 64 << 20  // 64MB
	tiktokLastMax  = 128 << 20 // 128MB — the ceiling on the remainder-bearing chunk

	// TikTok caps the caption; leave room rather than have it truncated for us.
	tiktokCaptionMax = 2100
)

// TikTokPublishRecord is one completed TikTok post.
type TikTokPublishRecord struct {
	PublishID   string `json:"publishId"`
	URL         string `json:"url"` // "" until TikTok reports the posted video
	Title       string `json:"title"`
	File        string `json:"file"`        // the render that went up
	PublishedAt string `json:"publishedAt"` // RFC3339
	// Privacy is the level the video actually posted at. An unaudited client
	// only gets SELF_ONLY, and the producer needs to know that.
	Privacy string `json:"privacy"`
	// Warning carries a non-fatal follow-up (a private post, a status TikTok
	// hadn't finished processing); transient, never persisted.
	Warning string `json:"warning"`
}

// tiktokPublishRecords loads the planID → TikTok publish record map. Never nil.
func (a *App) tiktokPublishRecords() map[string]TikTokPublishRecord {
	m := map[string]TikTokPublishRecord{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyTikTokPublish, &m); err != nil {
			log.Printf("jax: load tiktok publishes: %v", err)
		}
	}
	if m == nil {
		return map[string]TikTokPublishRecord{}
	}
	return m
}

// GetTikTokPublish reports a plan's TikTok post (nil when it hasn't been
// posted).
func (a *App) GetTikTokPublish(planID string) *TikTokPublishRecord {
	if r, ok := a.tiktokPublishRecords()[planID]; ok {
		return &r
	}
	return nil
}

// tiktokCaption builds the post's caption: the title, then as much of the
// description as fits. TikTok has no separate description field — the caption
// is the whole of the text.
func tiktokCaption(title, description string) string {
	title = strings.TrimSpace(title)
	description = strings.TrimSpace(description)
	if description == "" {
		return truncateRunes(title, tiktokCaptionMax)
	}
	caption := title + "\n\n" + description
	return truncateRunes(caption, tiktokCaptionMax)
}

// truncateRunes cuts a string to at most n runes (never mid-rune).
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// tiktokChunkPlan works out the chunking TikTok's init call has to be told
// about up front, and that the upload then has to match exactly.
//
// Anything up to 64MB goes as a single chunk of exactly the file's size — which
// covers both the under-5MB rule and every short-form video worth posting. Only
// past 64MB is the file actually cut up, and then the chunk is the maximum size
// so the count stays small and the remainder rides on the last chunk (under
// 64MB of overflow, so the last chunk can never reach TikTok's 128MB ceiling).
//
// The one thing this must never do is name a chunk_size bigger than the video:
// TikTok derives the count as floor(video_size / chunk_size), so that gives
// zero and the upload is refused.
func tiktokChunkPlan(size int64) (chunkSize int64, chunks int) {
	if size <= tiktokChunkMax {
		return size, 1
	}
	chunkSize = tiktokChunkMax
	chunks = int(size / chunkSize) // floor, exactly as TikTok computes it
	return chunkSize, chunks
}

// PublishPlanVideoToTikTok posts one of the plan's rendered outputs to the
// connected TikTok account and records the post. Progress arrives as
// "publish:progress" events; one publish (to any destination) runs at a time.
func (a *App) PublishPlanVideoToTikTok(planID, output, title, description string) (TikTokPublishRecord, error) {
	var rec TikTokPublishRecord
	title = strings.TrimSpace(title)
	if title == "" {
		return rec, fmt.Errorf("give the video a title first — it becomes the TikTok caption")
	}
	if _, err := a.findVideoPlan(planID); err != nil {
		return rec, err
	}

	output = filepath.Base(strings.TrimSpace(output))
	path := filepath.Join(a.editWorkspaceDir(planID), "edit", output)
	fi, err := os.Stat(path)
	if err != nil || fi.IsDir() {
		return rec, fmt.Errorf("no rendered %q in the plan's workspace — produce the video first", output)
	}

	conn, ok := a.freshConn("tiktok")
	if !ok {
		return rec, fmt.Errorf("connect TikTok in Settings → Services first")
	}

	a.mu.Lock()
	if a.publishingPlan != "" {
		busy := a.publishingPlan
		a.mu.Unlock()
		return rec, fmt.Errorf("another publish is already uploading (plan %s) — wait for it to finish", busy)
	}
	a.publishingPlan = planID
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.publishingPlan = ""
		a.mu.Unlock()
	}()

	// The most public level this creator can actually post at right now.
	privacy, err := tiktokPrivacyLevel(conn)
	if err != nil {
		return rec, fmt.Errorf("TikTok would not say how this account may post (%v) — reconnect it in Settings → Services", err)
	}

	size := fi.Size()
	chunkSize, chunks := tiktokChunkPlan(size)

	a.emitPublishProgress(planID, "Starting the TikTok upload…")
	var initResp struct {
		Data struct {
			PublishID string `json:"publish_id"`
			UploadURL string `json:"upload_url"`
		} `json:"data"`
		Error tiktokError `json:"error"`
	}
	_, err = httpx.PostJSON(tiktokVideoInitURL,
		map[string]string{"Authorization": "Bearer " + conn.token},
		map[string]any{
			"post_info": map[string]any{
				"title":           tiktokCaption(title, description),
				"privacy_level":   privacy,
				"disable_duet":    false,
				"disable_comment": false,
				"disable_stitch":  false,
			},
			"source_info": map[string]any{
				"source":            "FILE_UPLOAD",
				"video_size":        size,
				"chunk_size":        chunkSize,
				"total_chunk_count": chunks,
			},
		}, &initResp)
	if err != nil || !initResp.Error.ok() {
		detail := ""
		if err != nil {
			detail = err.Error()
		} else {
			detail = firstNonEmpty(initResp.Error.Message, initResp.Error.Code)
		}
		a.emitPublishProgress(planID, "")
		if strings.Contains(detail, "unaudited") || strings.Contains(detail, "reached_active_user_cap") {
			return rec, fmt.Errorf("TikTok: posting is limited until your TikTok app passes its audit (%s)", detail)
		}
		return rec, fmt.Errorf("TikTok rejected the upload: %s", detail)
	}

	if err := a.uploadTikTokChunks(planID, initResp.Data.UploadURL, path, size, chunkSize, chunks); err != nil {
		a.emitPublishProgress(planID, "")
		return rec, err
	}

	rec = TikTokPublishRecord{
		PublishID:   initResp.Data.PublishID,
		Title:       title,
		File:        output,
		PublishedAt: time.Now().UTC().Format(time.RFC3339),
		Privacy:     privacy,
	}
	if privacy == "SELF_ONLY" {
		rec.Warning = "TikTok posted this privately (SELF_ONLY) — that is the only level an unaudited TikTok app may post at. Once your app passes TikTok's audit it can post publicly; until then, change the video's visibility in the TikTok app."
	}

	// TikTok processes the post after the bytes land, so the share URL is not
	// available immediately. Give it a little while; a video that is still
	// processing is a note, not a failure — it is already on its way.
	a.emitPublishProgress(planID, "TikTok is processing the video…")
	if url, err := a.awaitTikTokPost(conn, initResp.Data.PublishID); err != nil {
		if rec.Warning == "" {
			rec.Warning = fmt.Sprintf("The video uploaded, but TikTok hasn't confirmed the post yet (%v) — check the TikTok app.", err)
		}
	} else {
		rec.URL = url
	}

	if a.store != nil {
		records := a.tiktokPublishRecords()
		persisted := rec
		persisted.Warning = ""
		records[planID] = persisted
		if err := a.store.setJSON(keyTikTokPublish, records); err != nil {
			log.Printf("jax: record tiktok publish: %v", err)
		}
	}
	a.emitPublishProgress(planID, "")
	return rec, nil
}

// uploadTikTokChunks streams the render up in the chunks the init call
// promised. The file is read a chunk at a time rather than held in memory — a
// produced video can be hundreds of megabytes.
func (a *App) uploadTikTokChunks(planID, uploadURL, path string, size, chunkSize int64, chunks int) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	for i := 0; i < chunks; i++ {
		start := int64(i) * chunkSize
		end := start + chunkSize - 1
		if i == chunks-1 {
			end = size - 1 // the last chunk takes whatever is left
		}
		length := end - start + 1

		buf := make([]byte, length)
		if _, err := io.ReadFull(io.NewSectionReader(f, start, length), buf); err != nil {
			return fmt.Errorf("the video could not be read for upload: %v", err)
		}

		req, err := http.NewRequest(http.MethodPut, uploadURL, bytes.NewReader(buf))
		if err != nil {
			return err
		}
		req.ContentLength = length
		req.Header.Set("Content-Type", "video/mp4")
		req.Header.Set("Content-Range",
			fmt.Sprintf("bytes %d-%d/%d", start, end, size))

		resp, err := videoUploadHTTP.Do(req)
		if err != nil {
			return fmt.Errorf("the TikTok upload failed: %v", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return fmt.Errorf("TikTok rejected the upload (%d): %s",
				resp.StatusCode, truncateErr(string(body)))
		}

		a.emitPublishProgress(planID, fmt.Sprintf(
			"Uploading to TikTok — %d%%", int((end+1)*100/size)))
	}
	return nil
}

// awaitTikTokPost polls the publish status until TikTok says the post is up,
// and returns its URL. A post still processing after the wait is not an error —
// it is on its way — so the caller reports it as a note.
func (a *App) awaitTikTokPost(conn serviceConn, publishID string) (string, error) {
	deadline := time.Now().Add(2 * time.Minute)
	for {
		var r struct {
			Data struct {
				Status         string   `json:"status"`
				PublicalyAvail []string `json:"publicaly_available_post_id"`
				FailReason     string   `json:"fail_reason"`
			} `json:"data"`
			Error tiktokError `json:"error"`
		}
		if _, err := httpx.PostJSON(tiktokPublishStatus,
			map[string]string{"Authorization": "Bearer " + conn.token},
			map[string]any{"publish_id": publishID}, &r); err != nil {
			return "", err
		}
		if !r.Error.ok() {
			return "", fmt.Errorf("%s", firstNonEmpty(r.Error.Message, r.Error.Code))
		}

		switch r.Data.Status {
		case "PUBLISH_COMPLETE":
			// The watch URL needs the @handle, which no scope hands over
			// directly — it comes from the profile link (see tiktokHandle).
			// Without it the post still succeeded; there is just no link to
			// offer, so say nothing rather than build a broken one.
			if handle := a.tiktokHandle(); handle != "" && len(r.Data.PublicalyAvail) > 0 {
				return "https://www.tiktok.com/@" + handle +
					"/video/" + r.Data.PublicalyAvail[0], nil
			}
			// Posted, but privately (an unaudited client) — there is no public
			// URL to hand back, and that is expected, not a failure.
			return "", nil
		case "FAILED":
			return "", fmt.Errorf("TikTok could not publish the video: %s",
				firstNonEmpty(r.Data.FailReason, "no reason given"))
		}

		if time.Now().After(deadline) {
			return "", fmt.Errorf("still processing")
		}
		time.Sleep(5 * time.Second)
	}
}

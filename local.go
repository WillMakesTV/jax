package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------------------
// Long-term retention of downloaded broadcasts
//
// Platforms remove past broadcasts over time (Twitch expires archive VODs),
// but once a broadcast has been downloaded its past stream should stay
// listed. While a downloaded broadcast is still returned by its platform,
// its PastBroadcast is snapshotted into the local_broadcasts table; once the
// platform drops it, the snapshot (or, for downloads that predate
// snapshotting, the download's manifest.json) is replayed into the past
// stream list marked Local. Per-broadcast assignments (series, episode,
// manual groups) key on "platform|url", so they reattach unchanged.
// ---------------------------------------------------------------------------

// urlPlatform infers a VOD URL's platform. A download can stitch VODs from
// several platforms, so the manifest's platform field is only a fallback.
func urlPlatform(u, fallback string) string {
	switch {
	case strings.Contains(u, "twitch.tv"):
		return "twitch"
	case strings.Contains(u, "youtube.com"), strings.Contains(u, "youtu.be"):
		return "youtube"
	}
	return fallback
}

// broadcastFromManifest shapes a download's manifest metadata into the
// broadcast for one of its VOD URLs. The manifest only carries stream-level
// aggregates, so this is only meaningful for a download's primary URL.
func broadcastFromManifest(dv DownloadedVideo, url string) PastBroadcast {
	return PastBroadcast{
		Platform:     urlPlatform(url, dv.Platform),
		Title:        dv.Title,
		URL:          url,
		ThumbnailURL: dv.ThumbnailURL,
		StartedAt:    dv.StartedAt,
		Duration:     compactDuration(dv.DurationSecs),
		DurationSecs: dv.DurationSecs,
		ViewCount:    dv.ViewCount,
	}
}

// compactDuration renders seconds in the "3h8m33s" style the platforms use.
func compactDuration(secs int) string {
	if secs <= 0 {
		return ""
	}
	var b strings.Builder
	if h := secs / 3600; h > 0 {
		fmt.Fprintf(&b, "%dh", h)
	}
	if m := secs % 3600 / 60; m > 0 {
		fmt.Fprintf(&b, "%dm", m)
	}
	if s := secs % 60; s > 0 {
		fmt.Fprintf(&b, "%ds", s)
	}
	return b.String()
}

// mergeLocalBroadcasts reconciles the platform-fetched broadcasts with the
// downloaded videos: broadcasts still listed get their snapshot refreshed,
// and downloaded broadcasts the platforms no longer return are appended from
// their snapshot (or manifest) marked Local, so they keep flowing through the
// usual grouping / series / episode pipeline.
func (a *App) mergeLocalBroadcasts(all []PastBroadcast) []PastBroadcast {
	if a.store == nil {
		return all
	}
	downloads := a.GetDownloads()
	if len(downloads) == 0 {
		return all
	}
	stored, err := a.store.getLocalBroadcasts()
	if err != nil {
		log.Printf("jax: load local broadcasts: %v", err)
		stored = map[string]localBroadcastRow{}
	}

	fetched := map[string]PastBroadcast{}
	for _, b := range all {
		fetched[broadcastKey(b)] = b
	}

	// Snapshots hold platform data as fetched; Local is stamped on replay.
	save := func(key, subfolder string, b PastBroadcast) {
		b.Local = false
		raw, err := json.Marshal(b)
		if err != nil {
			return
		}
		if prev, ok := stored[key]; ok && prev.data == string(raw) && prev.subfolder == subfolder {
			return
		}
		if err := a.store.upsertLocalBroadcast(key, subfolder, string(raw)); err != nil {
			log.Printf("jax: save local broadcast: %v", err)
		}
	}

	seen := map[string]bool{}
	for _, dv := range downloads {
		for i, u := range dv.URLs {
			key := urlPlatform(u, dv.Platform) + "|" + u
			if seen[key] {
				continue
			}
			seen[key] = true

			if b, ok := fetched[key]; ok {
				// Still listed by the platform; keep the snapshot fresh for
				// the day it no longer is.
				save(key, dv.Subfolder, b)
				continue
			}

			// Gone from the platform (or its service is disconnected): the
			// downloaded copy keeps the broadcast alive.
			var b PastBroadcast
			if row, ok := stored[key]; ok {
				if err := json.Unmarshal([]byte(row.data), &b); err != nil {
					log.Printf("jax: decode local broadcast %s: %v", key, err)
					continue
				}
			} else if i == 0 {
				// Downloaded before snapshotting existed; the manifest can
				// stand in for the primary URL.
				b = broadcastFromManifest(dv, u)
				save(key, dv.Subfolder, b)
			} else {
				continue
			}
			b.Local = true
			// A locally extracted poster frame beats the snapshot's platform
			// thumbnail: the platform dropped the VOD, so its URL is dead or
			// dying. GetDownloads already points dv.ThumbnailURL at the
			// generated frame when one exists (see thumbnails.go).
			if fileExists(filepath.Join(a.resolveDownloadDir(), dv.Subfolder, generatedThumbName)) {
				b.ThumbnailURL = dv.ThumbnailURL
			}
			all = append(all, b)
		}
	}
	return all
}

// DeleteLocalStream permanently deletes a downloaded broadcast: the download
// subfolder (video + manifest) is removed from disk along with its broadcast
// snapshots and any staged transcription work. Meant for local-only streams —
// the past stream disappears from the list once its last copy is gone. The
// confirmation lives in the frontend.
func (a *App) DeleteLocalStream(subfolder string) error {
	sub := strings.TrimSpace(subfolder)
	// The subfolder must be a plain directory name inside the download dir.
	if sub == "" || sub != filepath.Base(sub) || sub == "." || sub == ".." {
		return fmt.Errorf("invalid download folder %q", subfolder)
	}
	folder := filepath.Join(a.resolveDownloadDir(), sub)
	if !fileExists(filepath.Join(folder, "manifest.json")) {
		return fmt.Errorf("no downloaded video at %q", sub)
	}
	if err := os.RemoveAll(folder); err != nil {
		return fmt.Errorf("could not delete the download: %w", err)
	}
	if a.store != nil {
		if err := a.store.deleteLocalBroadcastsBySubfolder(sub); err != nil {
			log.Printf("jax: delete local broadcasts: %v", err)
		}
		if err := a.store.deleteTranscribeJob(sub); err != nil {
			log.Printf("jax: delete transcribe job: %v", err)
		}
	}
	return nil
}

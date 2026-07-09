package main

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// Downloaded videos
//
// Each completed download leaves a manifest.json in its subfolder (see
// download_videos.py) carrying the broadcast metadata plus the local video
// filename. Scanning those manifests tells the app which broadcasts have been
// downloaded and where the playable file lives (served under /media/, see
// media.go).
// ---------------------------------------------------------------------------

// DownloadedVideo is one downloaded broadcast, read from its manifest.json.
type DownloadedVideo struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Platform     string   `json:"platform"`
	ChannelName  string   `json:"channelName"`
	StartedAt    string   `json:"startedAt"`
	DurationSecs int      `json:"durationSecs"`
	ViewCount    int      `json:"viewCount"`
	ThumbnailURL string   `json:"thumbnailUrl"`
	URLs         []string `json:"urls"`
	// Filled in by the downloader / this scan.
	Subfolder    string `json:"subfolder"`
	VideoFile    string `json:"videoFile"`
	DownloadedAt string `json:"downloadedAt"`
	// MediaURL is the app-served path to the playable file ("/media/...").
	MediaURL string `json:"mediaUrl"`
}

// videoExts are the container extensions a downloaded file might use.
var videoExts = map[string]bool{
	".mp4": true, ".mkv": true, ".webm": true, ".mov": true, ".m4v": true,
}

// GetDownloads scans the download directory for manifests and returns the
// downloaded videos, newest first. Never returns nil.
func (a *App) GetDownloads() []DownloadedVideo {
	dir := a.resolveDownloadDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []DownloadedVideo{}
	}

	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()

	out := []DownloadedVideo{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		folder := filepath.Join(dir, e.Name())
		raw, err := os.ReadFile(filepath.Join(folder, "manifest.json"))
		if err != nil {
			continue
		}
		var dv DownloadedVideo
		if err := json.Unmarshal(raw, &dv); err != nil {
			continue
		}
		if dv.Subfolder == "" {
			dv.Subfolder = e.Name()
		}
		if dv.VideoFile == "" || !fileExists(filepath.Join(folder, dv.VideoFile)) {
			dv.VideoFile = findVideoFile(folder)
		}
		if dv.VideoFile == "" {
			continue // nothing playable
		}
		dv.MediaURL = base + "/media/" + url.PathEscape(dv.Subfolder) + "/" + url.PathEscape(dv.VideoFile)
		// A locally extracted poster frame (see thumbnails.go) overrides the
		// manifest's platform thumbnail — it is only ever generated because
		// that URL was missing or dead.
		if fileExists(filepath.Join(folder, generatedThumbName)) {
			dv.ThumbnailURL = base + "/media/" + url.PathEscape(dv.Subfolder) + "/" + generatedThumbName
		}
		out = append(out, dv)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].DownloadedAt > out[j].DownloadedAt
	})
	return out
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// findVideoFile returns the first video-container file in a folder, if any.
func findVideoFile(folder string) string {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if videoExts[strings.ToLower(filepath.Ext(e.Name()))] {
			return e.Name()
		}
	}
	return ""
}

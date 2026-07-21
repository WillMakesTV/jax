package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"bp-temp/internal/mediakit"
)

// ---------------------------------------------------------------------------
// Generated download thumbnails
//
// The platform thumbnail URL stored in a download's manifest can be missing
// or die over time (Twitch VOD thumbnails disappear with the VOD; YouTube's
// 404 once a video is removed). When the frontend finds one missing or broken
// it asks for a local replacement: a frame extracted from the downloaded
// video file with ffmpeg, written next to the video as thumbnail.jpg and
// served under /media/ like the video itself. GetDownloads prefers the
// generated file once it exists, so the fix sticks everywhere the download is
// shown.
// ---------------------------------------------------------------------------

// generatedThumbName is the extracted frame's filename inside a download's
// subfolder.
const generatedThumbName = "thumbnail.jpg"

// thumbGenMu serializes ffmpeg runs: several thumbnails erroring at once
// (e.g. a list of downloads with expired platform URLs) must not race on the
// same output file or stack up ffmpeg processes.
var thumbGenMu sync.Mutex

// GenerateDownloadThumbnail extracts a poster frame from the downloaded video
// in the given subfolder and returns the frame's /media URL. The frame lands
// a tenth into the video (clamped to 1s–5min), stepping back to the first
// frame when that seek yields nothing (very short or misreported videos). An
// already generated frame is reused.
func (a *App) GenerateDownloadThumbnail(subfolder string) (string, error) {
	dir := filepath.Clean(a.resolveDownloadDir())
	folder := filepath.Clean(filepath.Join(dir, subfolder))
	if folder == dir || !strings.HasPrefix(folder, dir+string(os.PathSeparator)) {
		return "", fmt.Errorf("invalid download subfolder")
	}

	thumbGenMu.Lock()
	defer thumbGenMu.Unlock()

	thumb := filepath.Join(folder, generatedThumbName)
	if !fileExists(thumb) {
		video, seek := downloadVideoAndSeek(folder)
		if video == "" {
			return "", fmt.Errorf("no downloaded video in %q to extract a thumbnail from", subfolder)
		}
		ffmpeg, err := mediakit.FFmpeg("it is needed to extract a thumbnail")
		if err != nil {
			return "", err
		}
		if err := mediakit.ExtractFrame(ffmpeg, video, thumb, seek); err != nil {
			// The seek may sit past the end of a short or misreported video;
			// the first frame always exists.
			if err = mediakit.ExtractFrame(ffmpeg, video, thumb, 0); err != nil {
				return "", fmt.Errorf("could not extract a thumbnail: %w", err)
			}
		}
	}

	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()
	return base + "/media/" + url.PathEscape(filepath.Base(folder)) + "/" + generatedThumbName, nil
}

// downloadVideoAndSeek locates the folder's playable video file and picks the
// frame-extraction seek point from the manifest's duration: a tenth in, but
// at least 1s (skips black lead-ins) and at most 5 minutes (fast even on
// long VODs). Returns ("", 0) when there is no video.
func downloadVideoAndSeek(folder string) (video string, seekSecs int) {
	seekSecs = 30
	var dv DownloadedVideo
	if raw, err := os.ReadFile(filepath.Join(folder, "manifest.json")); err == nil {
		if err := json.Unmarshal(raw, &dv); err == nil && dv.DurationSecs > 0 {
			seekSecs = dv.DurationSecs / 10
			if seekSecs < 1 {
				seekSecs = 1
			}
			if seekSecs > 300 {
				seekSecs = 300
			}
		}
	}
	video = dv.VideoFile
	if video == "" || !fileExists(filepath.Join(folder, video)) {
		video = findVideoFile(folder)
	}
	if video == "" {
		return "", 0
	}
	return filepath.Join(folder, video), seekSecs
}

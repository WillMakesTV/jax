package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed download/download_videos.py
var downloadScript []byte

// ---------------------------------------------------------------------------
// Past-stream download location
//
// The frontend (Settings → Streams) stores whether to download past streams
// and, optionally, a target directory. When none is chosen the default is a
// "jax" folder inside the user's Videos directory; a chosen directory
// overrides it. The download engine itself is future work — this wires the
// configuration and the native folder picker.
// ---------------------------------------------------------------------------

// DefaultDownloadDir is where downloads land when no directory is configured:
// a "jax" folder inside the user's Videos directory.
func (a *App) DefaultDownloadDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "jax"
	}
	return filepath.Join(home, "Videos", "jax")
}

// SelectDirectory opens a native folder picker and returns the chosen path
// (empty when the user cancels).
func (a *App) SelectDirectory(title string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("no window context")
	}
	if title == "" {
		title = "Choose a folder"
	}
	return wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: title,
	})
}

// resolveDownloadDir returns the configured download directory, falling back
// to the Videos/jax default when none is set.
func (a *App) resolveDownloadDir() string {
	if a.store != nil {
		if dir, err := a.store.getSetting("download_dir"); err == nil {
			if trimmed := strings.TrimSpace(dir); trimmed != "" {
				return trimmed
			}
		}
	}
	return a.DefaultDownloadDir()
}

// StartDownload downloads the given VOD URLs (all from one platform, ordered
// by broadcast time) into a per-stream subfolder (timestamp + channel name)
// of the configured folder, stitching them into one file when there is more
// than one. manifestJSON (may be empty) is metadata written alongside the
// video as manifest.json so the app can track and play it. fresh re-downloads
// into an existing subfolder, replacing its video files (a plain run would
// let yt-dlp skip files that already exist). Progress is reported via
// "download:line" events; the process exit via "download:exit" (empty detail
// = success). Only one download runs at a time.
func (a *App) StartDownload(name, subfolder, manifestJSON string, fresh bool, urls []string) error {
	if len(urls) == 0 {
		return fmt.Errorf("no videos to download for this stream")
	}

	a.mu.Lock()
	running := a.downloadCmd != nil
	moving := a.movingDownloads
	a.mu.Unlock()
	if moving {
		return fmt.Errorf("the download folder is being moved — try again once it finishes")
	}
	if running {
		return fmt.Errorf("a download is already in progress")
	}

	dir, err := dataDir()
	if err != nil {
		return fmt.Errorf("no data directory: %w", err)
	}
	script := filepath.Join(dir, "download_videos.py")
	if err := os.WriteFile(script, downloadScript, 0o600); err != nil {
		return fmt.Errorf("could not write the downloader script: %w", err)
	}

	target := a.resolveDownloadDir()
	if err := os.MkdirAll(target, 0o755); err != nil {
		return fmt.Errorf("could not create the download folder: %w", err)
	}

	python, pyArgs, err := findPython()
	if err != nil {
		return err
	}
	args := append(pyArgs, script, "--dir", target, "--name", name)
	if strings.TrimSpace(subfolder) != "" {
		args = append(args, "--subdir", subfolder)
	}
	if fresh {
		args = append(args, "--fresh")
	}
	// Persist the caller's metadata to a temp file for the downloader to embed
	// as manifest.json (only one download runs at a time, so a fixed name is
	// safe). Failures here are non-fatal — the video still downloads.
	if strings.TrimSpace(manifestJSON) != "" {
		manifestPath := filepath.Join(dir, "download_manifest.json")
		if err := os.WriteFile(manifestPath, []byte(manifestJSON), 0o600); err == nil {
			args = append(args, "--manifest", manifestPath)
		}
	}
	args = append(args, urls...)
	cmd := exec.Command(python, args...)
	hideWindow(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start the downloader: %w", err)
	}

	a.mu.Lock()
	a.downloadCmd = cmd
	a.downloadSub = strings.TrimSpace(subfolder)
	a.mu.Unlock()

	// Forward each JSON progress line to the frontend.
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" && a.ctx != nil {
				wruntime.EventsEmit(a.ctx, "download:line", line)
			}
		}
	}()

	errTail := make(chan string, 1)
	go func() {
		raw, _ := io.ReadAll(stderr)
		tail := strings.TrimSpace(string(raw))
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		errTail <- tail
	}()

	go func() {
		waitErr := cmd.Wait()
		tail := <-errTail

		a.mu.Lock()
		current := a.downloadCmd == cmd
		if current {
			a.downloadCmd = nil
			a.downloadSub = ""
		}
		a.mu.Unlock()

		if current {
			detail := ""
			if waitErr != nil {
				detail = firstNonEmpty(tail, waitErr.Error())
			}
			if a.ctx != nil {
				wruntime.EventsEmit(a.ctx, "download:exit", detail)
			}
			// The post-stream pipeline may be waiting on this download.
			a.notifyDownloadExit(detail)
		}
	}()

	return nil
}

// ---------------------------------------------------------------------------
// Stream download planning
//
// The Stream page's "Download videos" CTA resolves which VOD to fetch for
// each broadcast segment in the frontend (StreamDetails.tsx). The MCP
// download_stream tool needs the same resolution server-side, so the logic is
// ported here: cluster the stream's broadcasts into segments by go-live time,
// pick the preferred platform's VOD per segment, and download the ordered
// URLs into the same subfolder layout the UI would use.
// ---------------------------------------------------------------------------

// downloadStamp formats a stream's go-live time for the subfolder prefix,
// mirroring the frontend's downloadStamp ("2026-07-05 1900", local time).
func downloadStamp(iso string) string {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return "stream"
	}
	return t.Local().Format("2006-01-02 1504")
}

// clusterPastBroadcasts groups a stream's broadcasts into distinct broadcast
// segments by go-live time: a simulcast starts within the margin on every
// channel, so those cluster together; a multi-sitting stream forms one
// cluster per sitting. Mirrors the frontend's clusterBroadcasts.
func clusterPastBroadcasts(broadcasts []PastBroadcast, margin time.Duration) [][]PastBroadcast {
	sorted := append([]PastBroadcast(nil), broadcasts...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].StartedAt < sorted[j].StartedAt
	})

	type cluster struct {
		anchor time.Time
		items  []PastBroadcast
	}
	var clusters []*cluster
	for _, b := range sorted {
		t, terr := time.Parse(time.RFC3339, b.StartedAt)
		placed := false
		if terr == nil {
			for _, c := range clusters {
				if !c.anchor.IsZero() && absDuration(t.Sub(c.anchor)) <= margin {
					c.items = append(c.items, b)
					placed = true
					break
				}
			}
		}
		if !placed {
			var anchor time.Time
			if terr == nil {
				anchor = t
			}
			clusters = append(clusters, &cluster{anchor: anchor, items: []PastBroadcast{b}})
		}
	}
	out := make([][]PastBroadcast, 0, len(clusters))
	for _, c := range clusters {
		out = append(out, c.items)
	}
	return out
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// streamDownloadPlan is a resolved download: the ordered VOD URLs, the
// broadcasts they came from, and the representative platform for naming.
type streamDownloadPlan struct {
	platform string
	urls     []string
	picks    []PastBroadcast
}

// resolveStreamDownload picks the preferred platform's VOD per broadcast
// segment when present, falling back to whatever channel is available, so a
// segment that aired on only one channel is still captured. Mirrors the
// frontend's resolveDownload. Returns nil when nothing is downloadable.
func resolveStreamDownload(clusters [][]PastBroadcast, source string) *streamDownloadPlan {
	// Auto and YouTube both prefer YouTube; a named source moves to the front.
	order := []string{"youtube", "twitch", "kick", "facebook"}
	switch source {
	case "twitch":
		order = []string{"twitch", "youtube", "kick", "facebook"}
	case "kick":
		order = []string{"kick", "youtube", "twitch", "facebook"}
	case "facebook":
		order = []string{"facebook", "youtube", "twitch", "kick"}
	}

	var picks []PastBroadcast
	for _, cluster := range clusters {
		var pick *PastBroadcast
		for _, p := range order {
			for i := range cluster {
				if cluster[i].Platform == p && cluster[i].URL != "" {
					pick = &cluster[i]
					break
				}
			}
			if pick != nil {
				break
			}
		}
		if pick == nil {
			for i := range cluster {
				if cluster[i].URL != "" {
					pick = &cluster[i]
					break
				}
			}
		}
		if pick != nil {
			picks = append(picks, *pick)
		}
	}
	if len(picks) == 0 {
		return nil
	}
	sort.SliceStable(picks, func(i, j int) bool {
		return picks[i].StartedAt < picks[j].StartedAt
	})

	urls := make([]string, len(picks))
	for i, b := range picks {
		urls[i] = b.URL
	}
	platform := picks[0].Platform
	for _, p := range order {
		used := false
		for _, b := range picks {
			if b.Platform == p {
				used = true
				break
			}
		}
		if used {
			platform = p
			break
		}
	}
	return &streamDownloadPlan{platform: platform, urls: urls, picks: picks}
}

// keyDownloadSource is the Settings → Streams source preference ("auto",
// "twitch", or "youtube"); shared with the frontend's SETTING_KEYS.
const keyDownloadSource = "download_source"

// downloadPastStream resolves and starts a download of the past stream that
// began at startedAt — the server-side twin of the Stream page's "Download
// videos" CTA. source overrides the configured platform preference; force
// re-downloads a stream that already has a local copy. Progress is reported
// through the usual download events, so the app's status bar reflects it.
func (a *App) downloadPastStream(startedAt, source string, force bool) (map[string]any, error) {
	var stream *PastStream
	for _, s := range a.GetPastStreams(false) {
		if s.StartedAt == startedAt {
			stream = &s
			break
		}
	}
	if stream == nil {
		return nil, fmt.Errorf("no past stream starts at %q — use list_past_streams for the exact startedAt", startedAt)
	}

	// An existing download of this stream: without force it refuses; with
	// force its subfolder is reused so the fresh copy replaces it in place
	// (transcripts and broadcast snapshots key on the subfolder).
	existingSubfolder := ""
scan:
	for _, d := range a.GetDownloads() {
		for _, u := range d.URLs {
			for _, b := range stream.Broadcasts {
				if u != "" && u == b.URL {
					if !force {
						return nil, fmt.Errorf(
							"this stream is already downloaded (subfolder %q) — pass force=true to download it again", d.Subfolder)
					}
					existingSubfolder = d.Subfolder
					break scan
				}
			}
		}
	}

	switch source {
	case "", "auto", "twitch", "youtube", "kick", "facebook":
	default:
		return nil, fmt.Errorf(`source must be "auto", "twitch", "youtube", "kick", or "facebook"`)
	}
	if source == "" {
		source = "auto"
		if a.store != nil {
			if v, err := a.store.getSetting(keyDownloadSource); err == nil && strings.TrimSpace(v) != "" {
				source = strings.TrimSpace(v)
			}
		}
	}

	clusters := clusterPastBroadcasts(stream.Broadcasts, a.pastMatchMargin())
	plan := resolveStreamDownload(clusters, source)
	if plan == nil {
		return nil, fmt.Errorf("this stream has no downloadable VODs — the platforms may have expired them")
	}

	name := strings.TrimSpace(stream.Title)
	if name == "" {
		name = "Stream " + downloadStamp(stream.StartedAt)
	}
	// Per-stream subfolder: timestamp + stream title + source channel name.
	a.mu.Lock()
	channel := a.statuses[plan.platform].Account
	a.mu.Unlock()
	if channel == "" {
		switch plan.platform {
		case "twitch":
			channel = "Twitch"
		case "youtube":
			channel = "YouTube"
		case "kick":
			channel = "Kick"
		case "facebook":
			channel = "Facebook"
		default:
			channel = plan.platform
		}
	}
	subfolder := downloadStamp(stream.StartedAt) + " - " + name + " - " + channel
	if existingSubfolder != "" {
		subfolder = existingSubfolder
	}

	// Metadata written alongside the video as manifest.json so the app can
	// track and play the downloaded broadcast (same shape the UI builds).
	manifestStart := stream.StartedAt
	durationSecs, viewCount := 0, 0
	thumb := stream.ThumbnailURL
	for i, b := range plan.picks {
		if i == 0 || (b.StartedAt != "" && b.StartedAt < manifestStart) {
			manifestStart = b.StartedAt
		}
		durationSecs += b.DurationSecs
		viewCount += b.ViewCount
	}
	for _, b := range plan.picks {
		if b.ThumbnailURL != "" {
			thumb = b.ThumbnailURL
			break
		}
	}
	manifest := map[string]any{
		"id":           plan.platform + "|" + plan.urls[0],
		"title":        name,
		"platform":     plan.platform,
		"channelName":  channel,
		"startedAt":    firstNonEmpty(manifestStart, stream.StartedAt),
		"durationSecs": durationSecs,
		"viewCount":    viewCount,
		"thumbnailUrl": thumb,
		"urls":         plan.urls,
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return nil, err
	}

	if err := a.StartDownload(name, subfolder, string(manifestJSON), existingSubfolder != "", plan.urls); err != nil {
		return nil, err
	}
	return map[string]any{
		"started":   true,
		"title":     name,
		"platform":  plan.platform,
		"urls":      plan.urls,
		"subfolder": subfolder,
		"note":      "The download runs in the background (progress shows in the app's status bar). It appears in list_downloads once finished; only one download runs at a time.",
	}, nil
}

// CancelDownload stops an in-progress download, if any.
func (a *App) CancelDownload() {
	a.mu.Lock()
	cmd := a.downloadCmd
	a.downloadCmd = nil
	a.downloadSub = ""
	a.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		// The exit goroutine no longer reports for a cancelled download; a
		// waiting post-stream pipeline must hear the cancellation from here.
		a.notifyDownloadExit("The download was cancelled.")
	}
}

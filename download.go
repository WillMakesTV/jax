package main

import (
	"bufio"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

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
// video as manifest.json so the app can track and play it. Progress is
// reported via "download:line" events; the process exit via "download:exit"
// (empty detail = success). Only one download runs at a time.
func (a *App) StartDownload(name, subfolder, manifestJSON string, urls []string) error {
	if len(urls) == 0 {
		return fmt.Errorf("no videos to download for this stream")
	}

	a.mu.Lock()
	running := a.downloadCmd != nil
	a.mu.Unlock()
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
		}
		a.mu.Unlock()

		if current && a.ctx != nil {
			detail := ""
			if waitErr != nil {
				detail = firstNonEmpty(tail, waitErr.Error())
			}
			wruntime.EventsEmit(a.ctx, "download:exit", detail)
		}
	}()

	return nil
}

// CancelDownload stops an in-progress download, if any.
func (a *App) CancelDownload() {
	a.mu.Lock()
	cmd := a.downloadCmd
	a.downloadCmd = nil
	a.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

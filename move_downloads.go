package main

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// ---------------------------------------------------------------------------
// Moving the download folder
//
// Every stored reference to a downloaded broadcast is a bare subfolder name:
// the manifest's Subfolder field, the broadcast snapshots
// (local_broadcasts.subfolder), the transcription queue and its staged lines
// all key on it, and the download scanner / media server / sidecars join that
// name onto resolveDownloadDir() at call time. So the safe "move" is:
// relocate the download subfolders on disk, then repoint the download_dir
// setting — every reference follows automatically, with nothing else to
// rewrite.
//
// Only broadcast subfolders (directories carrying a manifest.json) are moved.
// The configured folder may be somewhere shared — a user can point downloads
// at their whole Videos directory — so unrelated files must stay put.
// ---------------------------------------------------------------------------

// MoveDownloadFolder moves the downloaded broadcasts into newDir and repoints
// the download-folder setting there, returning how many were moved. Downloads
// are moved one subfolder at a time (rename on the same volume, copy+delete
// across volumes); any failure rolls the finished ones back so the app never
// points at a half-moved library. Refused while a download or transcription
// is running.
func (a *App) MoveDownloadFolder(newDir string) (int, error) {
	dst := filepath.Clean(strings.TrimSpace(newDir))
	if strings.TrimSpace(newDir) == "" || !filepath.IsAbs(dst) {
		return 0, fmt.Errorf("choose a folder to move the downloads to")
	}
	src := filepath.Clean(a.resolveDownloadDir())
	if samePath(src, dst) {
		return 0, fmt.Errorf("that is already the download folder")
	}
	if isWithin(src, dst) {
		return 0, fmt.Errorf("the new folder cannot be inside the current download folder")
	}
	if a.store == nil {
		return 0, fmt.Errorf("storage is unavailable, so the new location could not be saved")
	}

	// One move at a time, and never while a sidecar is reading or writing the
	// folder. The flag also stops new work from starting mid-move
	// (StartDownload and TranscribeDownload check it).
	a.mu.Lock()
	switch {
	case a.movingDownloads:
		a.mu.Unlock()
		return 0, fmt.Errorf("a folder move is already in progress")
	case a.downloadCmd != nil:
		a.mu.Unlock()
		return 0, fmt.Errorf("a download is in progress — wait for it to finish (or cancel it) first")
	case len(a.vodJobs) > 0:
		a.mu.Unlock()
		return 0, fmt.Errorf("videos are being transcribed — wait for the queue to finish (or cancel it) first")
	}
	a.movingDownloads = true
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.movingDownloads = false
		a.mu.Unlock()
	}()

	subs, err := downloadSubfolders(src)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return 0, fmt.Errorf("could not create the new folder: %w", err)
	}
	for _, name := range subs {
		if _, err := os.Stat(filepath.Join(dst, name)); err == nil {
			return 0, fmt.Errorf("the new folder already contains %q — move or remove it first", name)
		}
	}

	var moved []string
	for _, name := range subs {
		if err := moveTree(filepath.Join(src, name), filepath.Join(dst, name)); err != nil {
			if stuck := moveEntriesBack(dst, src, moved); len(stuck) > 0 {
				return 0, fmt.Errorf(
					"could not move %q: %v — and %s could not be moved back; those downloads are in %s and must be returned by hand",
					name, err, strings.Join(stuck, ", "), dst)
			}
			return 0, fmt.Errorf("could not move %q (close any playing videos and try again): %w", name, err)
		}
		moved = append(moved, name)
	}

	if err := a.store.setSetting("download_dir", dst); err != nil {
		// The files are in the new place but the app still points at the old
		// one; put them back rather than strand them.
		if stuck := moveEntriesBack(dst, src, moved); len(stuck) > 0 {
			return 0, fmt.Errorf(
				"could not save the new location: %v — and %s could not be moved back; those downloads are in %s and must be returned by hand",
				err, strings.Join(stuck, ", "), dst)
		}
		return 0, fmt.Errorf("could not save the new location: %w", err)
	}

	// An emptied old folder is just clutter; one holding anything else (or the
	// user's own files) is left alone — Remove refuses non-empty directories.
	_ = os.Remove(src)
	return len(moved), nil
}

// downloadSubfolders lists the broadcast subfolders — directories holding a
// manifest.json — inside dir. A missing dir is an empty library, not an error.
func downloadSubfolders(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not read the current download folder: %w", err)
	}
	var subs []string
	for _, e := range entries {
		if e.IsDir() && fileExists(filepath.Join(dir, e.Name(), "manifest.json")) {
			subs = append(subs, e.Name())
		}
	}
	return subs, nil
}

// moveEntriesBack best-effort returns already-moved subfolders from dst to
// src, reporting the names it could not bring back.
func moveEntriesBack(dst, src string, names []string) []string {
	var stuck []string
	for _, name := range names {
		if err := moveTree(filepath.Join(dst, name), filepath.Join(src, name)); err != nil {
			stuck = append(stuck, name)
		}
	}
	return stuck
}

// moveTree moves a directory: by rename when the volumes allow it, otherwise
// by copy-then-delete. The source is only removed after a complete copy, and
// a failed copy is cleaned off the destination.
func moveTree(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyTree(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	return os.RemoveAll(src)
}

// copyTree recursively copies the directory src to dst.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// samePath reports whether two cleaned paths name the same location
// (case-insensitively on Windows).
func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// isWithin reports whether child is inside parent (both cleaned).
func isWithin(parent, child string) bool {
	if runtime.GOOS == "windows" {
		parent, child = strings.ToLower(parent), strings.ToLower(child)
	}
	return strings.HasPrefix(child, parent+string(os.PathSeparator))
}

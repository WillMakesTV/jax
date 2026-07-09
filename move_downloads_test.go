package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestMoveDownloadFolder(t *testing.T) {
	a := newTestApp(t)
	src := t.TempDir()
	if err := a.store.setSetting("download_dir", src); err != nil {
		t.Fatalf("set download dir: %v", err)
	}

	writeDownload(t, a, DownloadedVideo{
		ID: "twitch|https://www.twitch.tv/videos/1", Title: "Ep 1",
		Platform: "twitch", StartedAt: "2026-06-28T03:00:00Z",
		URLs:      []string{"https://www.twitch.tv/videos/1"},
		Subfolder: "ep1", VideoFile: "ep1.mp4",
	})
	writeDownload(t, a, DownloadedVideo{
		ID: "twitch|https://www.twitch.tv/videos/2", Title: "Ep 2",
		Platform: "twitch", StartedAt: "2026-06-29T03:00:00Z",
		URLs:      []string{"https://www.twitch.tv/videos/2"},
		Subfolder: "ep2", VideoFile: "ep2.mp4",
	})
	// Non-download content in the old folder must stay put: the configured
	// folder can be somewhere shared.
	if err := os.WriteFile(filepath.Join(src, "notes.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatalf("write stray file: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(src, "unrelated"), 0o755); err != nil {
		t.Fatalf("mkdir unrelated: %v", err)
	}

	dst := filepath.Join(t.TempDir(), "new home")
	n, err := a.MoveDownloadFolder(dst)
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if n != 2 {
		t.Fatalf("moved %d downloads, want 2", n)
	}

	// The setting now points at the new folder and the library scans from it.
	if got := a.resolveDownloadDir(); got != dst {
		t.Fatalf("download dir = %q, want %q", got, dst)
	}
	downloads := a.GetDownloads()
	if len(downloads) != 2 {
		t.Fatalf("want 2 downloads after the move, got %+v", downloads)
	}
	for _, sub := range []string{"ep1", "ep2"} {
		if _, err := os.Stat(filepath.Join(src, sub)); !os.IsNotExist(err) {
			t.Fatalf("%s should be gone from the old folder, stat err %v", sub, err)
		}
		dl, err := a.findDownload(sub)
		if err != nil {
			t.Fatalf("find %s after move: %v", sub, err)
		}
		if !fileExists(filepath.Join(dst, sub, dl.VideoFile)) {
			t.Fatalf("%s video missing from the new folder", sub)
		}
	}
	// Unrelated content stayed behind.
	if !fileExists(filepath.Join(src, "notes.txt")) {
		t.Fatal("stray file should stay in the old folder")
	}
	if info, err := os.Stat(filepath.Join(src, "unrelated")); err != nil || !info.IsDir() {
		t.Fatalf("unrelated dir should stay in the old folder, err %v", err)
	}
}

func TestMoveDownloadFolderRefusals(t *testing.T) {
	a := newTestApp(t)
	src := t.TempDir()
	if err := a.store.setSetting("download_dir", src); err != nil {
		t.Fatalf("set download dir: %v", err)
	}
	writeDownload(t, a, DownloadedVideo{
		ID: "twitch|https://www.twitch.tv/videos/1", Title: "Ep 1",
		Platform: "twitch", StartedAt: "2026-06-28T03:00:00Z",
		URLs:      []string{"https://www.twitch.tv/videos/1"},
		Subfolder: "ep1", VideoFile: "ep1.mp4",
	})

	if _, err := a.MoveDownloadFolder(""); err == nil {
		t.Fatal("want error for an empty target")
	}
	if _, err := a.MoveDownloadFolder(src); err == nil {
		t.Fatal("want error for moving to the same folder")
	}
	if _, err := a.MoveDownloadFolder(filepath.Join(src, "inside")); err == nil {
		t.Fatal("want error for a target inside the download folder")
	}

	// Busy sidecars block the move.
	a.downloadCmd = &exec.Cmd{}
	if _, err := a.MoveDownloadFolder(t.TempDir()); err == nil {
		t.Fatal("want error while a download runs")
	}
	a.downloadCmd = nil
	a.vodJobs = []*vodJob{{sub: "ep1"}}
	if _, err := a.MoveDownloadFolder(t.TempDir()); err == nil {
		t.Fatal("want error while transcriptions are queued")
	}
	a.vodJobs = nil

	// A name collision in the target aborts before anything moves.
	dst := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dst, "ep1"), 0o755); err != nil {
		t.Fatalf("mkdir collision: %v", err)
	}
	if _, err := a.MoveDownloadFolder(dst); err == nil {
		t.Fatal("want error for a colliding subfolder in the target")
	}
	if !fileExists(filepath.Join(src, "ep1", "manifest.json")) {
		t.Fatal("collision refusal must leave the library in place")
	}
}

func TestMoveDownloadFolderEmptyLibrary(t *testing.T) {
	a := newTestApp(t)
	// No download_dir set and the default folder does not exist: the move is
	// just a repoint.
	dst := filepath.Join(t.TempDir(), "downloads")
	n, err := a.MoveDownloadFolder(dst)
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if n != 0 {
		t.Fatalf("moved %d downloads, want 0", n)
	}
	if got := a.resolveDownloadDir(); got != dst {
		t.Fatalf("download dir = %q, want %q", got, dst)
	}
	if info, err := os.Stat(dst); err != nil || !info.IsDir() {
		t.Fatalf("new folder should exist, err %v", err)
	}
}

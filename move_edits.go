package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------------------
// Moving the edit-workspace folder
//
// Edit workspaces (see editor.go) are keyed by bare plan-id subfolder names
// under resolveEditRoot(); the media server's /edits/ route and every
// workspace path join onto the root at call time. So, like the download
// folder, the safe "move" is: relocate the subfolders, then repoint the
// edit_workspace_dir setting.
//
// One wrinkle: each workspace carries a .claude/skills/video-use link
// (junction on Windows) into the vendored library. A cross-volume move
// copies file-by-file and must not traverse that link, so the links are
// removed up front — PrepareEditWorkspace recreates them on the next use.
// ---------------------------------------------------------------------------

// MoveEditWorkspaceFolder moves the edit workspaces into newDir and repoints
// the workspace-folder setting there, returning how many were moved. Any
// failure rolls the finished ones back. Refused while an edit session runs.
func (a *App) MoveEditWorkspaceFolder(newDir string) (int, error) {
	dst := filepath.Clean(strings.TrimSpace(newDir))
	if strings.TrimSpace(newDir) == "" || !filepath.IsAbs(dst) {
		return 0, fmt.Errorf("choose a folder to move the workspaces to")
	}
	src := filepath.Clean(a.resolveEditRoot())
	if samePath(src, dst) {
		return 0, fmt.Errorf("that is already the workspace folder")
	}
	if isWithin(src, dst) {
		return 0, fmt.Errorf("the new folder cannot be inside the current workspace folder")
	}
	if a.store == nil {
		return 0, fmt.Errorf("storage is unavailable, so the new location could not be saved")
	}

	a.mu.Lock()
	switch {
	case a.movingEdits:
		a.mu.Unlock()
		return 0, fmt.Errorf("a workspace-folder move is already in progress")
	case a.editCmd != nil:
		a.mu.Unlock()
		return 0, fmt.Errorf("an edit session is running — wait for it to finish (or stop it) first")
	}
	a.movingEdits = true
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.movingEdits = false
		a.mu.Unlock()
	}()

	subs, err := editWorkspaceSubfolders(src)
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

	// Drop each workspace's skill link before moving: a cross-volume copy
	// walks the tree and must not descend through the junction into the
	// vendored library. The next PrepareEditWorkspace puts the link back.
	for _, name := range subs {
		_ = os.Remove(filepath.Join(src, name, ".claude", "skills", "video-use"))
	}

	var moved []string
	for _, name := range subs {
		if err := moveTree(filepath.Join(src, name), filepath.Join(dst, name)); err != nil {
			if stuck := moveEntriesBack(dst, src, moved); len(stuck) > 0 {
				return 0, fmt.Errorf(
					"could not move %q: %v — and %s could not be moved back; those workspaces are in %s and must be returned by hand",
					name, err, strings.Join(stuck, ", "), dst)
			}
			return 0, fmt.Errorf("could not move %q (close any playing videos and try again): %w", name, err)
		}
		moved = append(moved, name)
	}

	if err := a.store.setSetting(keyEditWorkspaceDir, dst); err != nil {
		if stuck := moveEntriesBack(dst, src, moved); len(stuck) > 0 {
			return 0, fmt.Errorf(
				"could not save the new location: %v — and %s could not be moved back; those workspaces are in %s and must be returned by hand",
				err, strings.Join(stuck, ", "), dst)
		}
		return 0, fmt.Errorf("could not save the new location: %w", err)
	}

	_ = os.Remove(src) // clears an emptied old folder; refuses non-empty
	return len(moved), nil
}

// editWorkspaceSubfolders lists the workspace directories inside the root.
// The root is dedicated to workspaces, so every directory counts; a missing
// root is an empty library, not an error.
func editWorkspaceSubfolders(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not read the current workspace folder: %w", err)
	}
	var subs []string
	for _, e := range entries {
		if e.IsDir() {
			subs = append(subs, e.Name())
		}
	}
	return subs, nil
}

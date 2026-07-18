package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureVideoPlanWorkspace(t *testing.T) {
	a := newTestApp(t)
	root := t.TempDir()
	if err := a.SetSetting(keyEditWorkspaceDir, root); err != nil {
		t.Fatalf("set workspace root: %v", err)
	}
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Top 5 moments", Format: "long"})
	if err != nil {
		t.Fatalf("save plan: %v", err)
	}

	dirs, err := a.EnsureVideoPlanWorkspace(plan.ID)
	if err != nil {
		t.Fatalf("ensure workspace: %v", err)
	}
	if !isDir(dirs.Dir) {
		t.Fatalf("workspace dir not created: %s", dirs.Dir)
	}
	if !isDir(dirs.Sources) || filepath.Dir(dirs.Sources) != dirs.Dir {
		t.Fatalf("sources dir wrong: %s", dirs.Sources)
	}
	if rel, err := filepath.Rel(root, dirs.Dir); err != nil || rel == ".." {
		t.Fatalf("workspace %s should live under the configured root %s", dirs.Dir, root)
	}

	// Idempotent, and unknown plans are refused.
	if _, err := a.EnsureVideoPlanWorkspace(plan.ID); err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if _, err := a.EnsureVideoPlanWorkspace("vplan_missing"); err == nil {
		t.Fatal("want error for an unknown plan")
	}
}

func TestImportMovesRecordingsFromSources(t *testing.T) {
	a := newTestApp(t)
	root := t.TempDir()
	if err := a.SetSetting(keyEditWorkspaceDir, root); err != nil {
		t.Fatalf("set workspace root: %v", err)
	}
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Capture test", Format: "long"})
	if err != nil {
		t.Fatalf("save plan: %v", err)
	}
	dirs, err := a.EnsureVideoPlanWorkspace(plan.ID)
	if err != nil {
		t.Fatalf("ensure workspace: %v", err)
	}

	// An OBS recording that landed in sources/ is moved into the workspace
	// root, not duplicated.
	rec := filepath.Join(dirs.Sources, "capture.mp4")
	if err := os.WriteFile(rec, []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	updated, err := a.ImportVideoPlanFootage(plan.ID, []string{rec})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if fileExists(rec) {
		t.Fatal("in-workspace file should be moved, not copied")
	}
	if !fileExists(filepath.Join(dirs.Dir, "capture.mp4")) {
		t.Fatal("moved recording missing from the workspace root")
	}
	if len(updated.Files) != 1 || updated.Files[0] != "capture.mp4" {
		t.Fatalf("plan files = %v, want [capture.mp4]", updated.Files)
	}

	// A file from anywhere else is still copied — the original stays.
	ext := filepath.Join(t.TempDir(), "broll.mp4")
	if err := os.WriteFile(ext, []byte("broll"), 0o644); err != nil {
		t.Fatal(err)
	}
	updated, err = a.ImportVideoPlanFootage(plan.ID, []string{ext})
	if err != nil {
		t.Fatalf("import external: %v", err)
	}
	if !fileExists(ext) {
		t.Fatal("external file should be copied, keeping the original")
	}
	if len(updated.Files) != 2 || updated.Files[1] != "broll.mp4" {
		t.Fatalf("plan files = %v, want capture.mp4 + broll.mp4", updated.Files)
	}
}

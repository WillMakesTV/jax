package main

import (
	"os"
	"path/filepath"
	"testing"
)

// newTestApp returns an App with a fresh store, with the user home directory
// (and thus ~/.jax/projects) redirected into a temp dir so on-disk asset
// operations never touch the real data directory.
func newTestApp(t *testing.T) *App {
	t.Helper()
	t.Setenv("USERPROFILE", t.TempDir()) // Windows
	t.Setenv("HOME", t.TempDir())        // POSIX
	return &App{store: openTestStore(t)}
}

func TestProjectRoundTrip(t *testing.T) {
	a := newTestApp(t)

	if _, err := a.SaveProject(Project{Title: "  "}); err == nil {
		t.Fatal("want error for a blank title")
	}

	p, err := a.SaveProject(Project{Title: "Launch", Description: "# Plan"})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if p.ID == "" || p.CreatedAt == "" {
		t.Fatalf("id/createdAt not assigned: %+v", p)
	}

	// An edit keeps stored assets/docs even when the caller sends stale ones.
	p2, err := a.SaveProjectDoc(p.ID, ProjectDoc{Title: "Root"})
	if err != nil {
		t.Fatalf("save doc: %v", err)
	}
	edited, err := a.SaveProject(Project{ID: p.ID, Title: "Launch v2", Docs: nil})
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if len(edited.Docs) != 1 || edited.Docs[0].ID != p2.Docs[0].ID {
		t.Fatalf("edit dropped docs: %+v", edited.Docs)
	}

	all := a.GetProjects()
	if len(all) != 1 || all[0].Title != "Launch v2" {
		t.Fatalf("want the edited project, got %+v", all)
	}

	if err := a.DeleteProject(p.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := a.GetProjects(); len(got) != 0 {
		t.Fatalf("project not deleted: %+v", got)
	}
}

func TestProjectDocTree(t *testing.T) {
	a := newTestApp(t)
	p, err := a.SaveProject(Project{Title: "Docs"})
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	p, err = a.SaveProjectDoc(p.ID, ProjectDoc{Title: "Guide"})
	if err != nil {
		t.Fatalf("root doc: %v", err)
	}
	guide := p.Docs[0]

	p, err = a.SaveProjectDoc(p.ID, ProjectDoc{Title: "Install", ParentID: guide.ID})
	if err != nil {
		t.Fatalf("child doc: %v", err)
	}
	install := p.Docs[1]

	p, err = a.SaveProjectDoc(p.ID, ProjectDoc{Title: "Windows", ParentID: install.ID})
	if err != nil {
		t.Fatalf("grandchild doc: %v", err)
	}

	// A missing parent and a cycle are both rejected.
	if _, err := a.SaveProjectDoc(p.ID, ProjectDoc{Title: "x", ParentID: "nope"}); err == nil {
		t.Fatal("want error for a missing parent")
	}
	cycle := guide
	cycle.ParentID = install.ID
	if _, err := a.SaveProjectDoc(p.ID, cycle); err == nil {
		t.Fatal("want error for a cycle")
	}

	// Deleting the middle doc promotes its child to the deleted doc's parent.
	p, err = a.DeleteProjectDoc(p.ID, install.ID)
	if err != nil {
		t.Fatalf("delete doc: %v", err)
	}
	if len(p.Docs) != 2 {
		t.Fatalf("want 2 docs after delete, got %+v", p.Docs)
	}
	for _, d := range p.Docs {
		if d.Title == "Windows" && d.ParentID != guide.ID {
			t.Fatalf("child not promoted: %+v", d)
		}
	}
}

func TestActiveProjectIsExclusive(t *testing.T) {
	a := newTestApp(t)

	first, err := a.SaveProject(Project{Title: "First"})
	if err != nil {
		t.Fatalf("save first: %v", err)
	}
	if !first.Active {
		t.Fatal("the first project should start active")
	}
	second, err := a.SaveProject(Project{Title: "Second"})
	if err != nil {
		t.Fatalf("save second: %v", err)
	}
	if second.Active {
		t.Fatal("a later project should not steal the active flag")
	}

	all, err := a.SetActiveProject(second.ID)
	if err != nil {
		t.Fatalf("set active: %v", err)
	}
	for _, p := range all {
		if want := p.ID == second.ID; p.Active != want {
			t.Fatalf("active flag on %s = %v, want %v", p.Title, p.Active, want)
		}
	}
	if got := a.GetActiveProject(); got.ID != second.ID {
		t.Fatalf("active project = %+v, want %s", got, second.ID)
	}

	// An edit leaves the flag where SetActiveProject put it.
	if edited, err := a.SaveProject(Project{ID: second.ID, Title: "Second v2"}); err != nil {
		t.Fatalf("edit: %v", err)
	} else if !edited.Active {
		t.Fatal("editing dropped the active flag")
	}

	if _, err := a.SetActiveProject("nope"); err == nil {
		t.Fatal("want error for a missing project")
	}

	// Deleting the active project promotes the newest survivor.
	if err := a.DeleteProject(second.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := a.GetActiveProject(); got.ID != first.ID {
		t.Fatalf("active project after delete = %+v, want %s", got, first.ID)
	}

	// Nothing has to be active.
	if _, err := a.SetActiveProject(""); err != nil {
		t.Fatalf("clear active: %v", err)
	}
	if got := a.GetActiveProject(); got.ID != "" {
		t.Fatalf("want no active project, got %+v", got)
	}
}

func TestProjectAssetMetadata(t *testing.T) {
	a := newTestApp(t)
	p, err := a.SaveProject(Project{Title: "Assets"})
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	// Simulate the copy step AddProjectAssets performs (the native file
	// dialog cannot run in tests), then exercise the metadata methods.
	dir, err := projectAssetsDir(p.ID)
	if err != nil {
		t.Fatalf("assets dir: %v", err)
	}
	src := filepath.Join(t.TempDir(), "logo.png")
	if err := os.WriteFile(src, []byte("png"), 0o600); err != nil {
		t.Fatalf("write src: %v", err)
	}
	name, size, err := copyIntoDir(src, dir)
	if err != nil {
		t.Fatalf("copy: %v", err)
	}
	if name != "logo.png" || size != 3 {
		t.Fatalf("copy result: %q %d", name, size)
	}
	// A second copy of the same file gets a deduplicated name.
	if name2, _, _ := copyIntoDir(src, dir); name2 != "logo (2).png" {
		t.Fatalf("dedupe: %q", name2)
	}

	p, err = a.mutateProject(p.ID, func(p *Project) error {
		p.Assets = append(p.Assets, ProjectAsset{ID: "asset_1", Name: name, SizeBytes: size})
		return nil
	})
	if err != nil {
		t.Fatalf("record asset: %v", err)
	}

	p, err = a.UpdateProjectAsset(p.ID, "asset_1", "the logo")
	if err != nil {
		t.Fatalf("describe: %v", err)
	}
	if p.Assets[0].Description != "the logo" {
		t.Fatalf("description not saved: %+v", p.Assets[0])
	}
	if _, err := a.UpdateProjectAsset(p.ID, "missing", "x"); err == nil {
		t.Fatal("want error for a missing asset")
	}

	p, err = a.DeleteProjectAsset(p.ID, "asset_1")
	if err != nil {
		t.Fatalf("delete asset: %v", err)
	}
	if len(p.Assets) != 0 {
		t.Fatalf("asset metadata not removed: %+v", p.Assets)
	}
	if _, err := os.Stat(filepath.Join(dir, "logo.png")); !os.IsNotExist(err) {
		t.Fatal("asset file not removed from disk")
	}

	// Deleting the project removes its whole folder.
	if err := a.DeleteProject(p.ID); err != nil {
		t.Fatalf("delete project: %v", err)
	}
	root, _ := projectsDir()
	if _, err := os.Stat(filepath.Join(root, p.ID)); !os.IsNotExist(err) {
		t.Fatal("project folder not removed")
	}
}

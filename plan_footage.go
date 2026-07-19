package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Imported plan footage
//
// A video plan's sources are usually past broadcasts, but a video can also
// draw from footage that never aired — screen captures, b-roll, phone clips.
// Imported files are copied into the plan's edit workspace root next to the
// downloaded broadcasts, so the edit session and the manual timeline pick
// them up like any other source video. The plan records them in Files.
// ---------------------------------------------------------------------------

// PickFootageFiles opens the native file dialog for video files and returns
// the chosen absolute paths (empty when cancelled). Picking is separate from
// importing so the "Plan a video" form can collect files before the plan
// exists; ImportVideoPlanFootage copies them in once it does.
func (a *App) PickFootageFiles() ([]string, error) {
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Add footage",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Videos", Pattern: "*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v"},
		},
	})
	if err != nil {
		return nil, err
	}
	if paths == nil {
		paths = []string{}
	}
	return paths, nil
}

// PlanWorkspaceDirs are a plan's workspace folders on disk.
type PlanWorkspaceDirs struct {
	Dir string `json:"dir"`
	// Sources is the workspace's landing zone for fresh captures — the
	// Record-from-OBS panel points OBS's record output here.
	Sources string `json:"sources"`
}

// EnsureVideoPlanWorkspace creates the plan's workspace folder inside the
// configured workspace root (Settings → Videos), along with its sources
// subfolder for fresh recordings, and returns the absolute paths. Called as
// the "Plan a video" form advances past the idea step, so the plan has a home
// on disk from the start.
func (a *App) EnsureVideoPlanWorkspace(planID string) (PlanWorkspaceDirs, error) {
	if _, err := a.findVideoPlan(planID); err != nil {
		return PlanWorkspaceDirs{}, err
	}
	dir := a.editWorkspaceDir(planID)
	sources := filepath.Join(dir, "sources")
	if err := os.MkdirAll(sources, 0o755); err != nil {
		return PlanWorkspaceDirs{}, fmt.Errorf("could not create the workspace: %w", err)
	}
	return PlanWorkspaceDirs{Dir: dir, Sources: sources}, nil
}

// ImportVideoPlanFootage brings picked video files into the plan's edit
// workspace root and records them on the plan. Files from elsewhere are
// copied; a file already inside the plan's workspace (an OBS recording landed
// in sources/) is moved instead, so imports never duplicate gigabytes. A name
// that collides with a file already in the workspace gets a numbered suffix,
// so imports never overwrite a downloaded broadcast or each other. Returns
// the updated plan.
func (a *App) ImportVideoPlanFootage(planID string, paths []string) (VideoPlan, error) {
	if _, err := a.findVideoPlan(planID); err != nil {
		return VideoPlan{}, err
	}
	dir := a.editWorkspaceDir(planID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return VideoPlan{}, fmt.Errorf("could not create the workspace: %w", err)
	}

	var imported []string
	for _, src := range paths {
		if strings.TrimSpace(src) == "" {
			continue
		}
		name := uniqueWorkspaceName(dir, filepath.Base(src))
		dst := filepath.Join(dir, name)
		if err := importFile(dir, src, dst); err != nil {
			return VideoPlan{}, fmt.Errorf("could not import %s (is it still being written?): %w",
				filepath.Base(src), err)
		}
		imported = append(imported, name)
	}
	if len(imported) == 0 {
		return a.findVideoPlan(planID)
	}
	return a.mutateVideoPlan(planID, func(p *VideoPlan) error {
		p.Files = append(p.Files, imported...)
		return nil
	})
}

// importFile lands src at dst: a file already inside the workspace is moved,
// anything else is copied. An OBS recording is handed over the moment
// StopRecord returns, while OBS may still be finalizing the file — on
// Windows that surfaces as a sharing violation — so failures retry briefly
// before giving up.
func importFile(dir, src, dst string) error {
	attempt := func() error {
		if insideDir(dir, src) {
			return os.Rename(src, dst)
		}
		return copyFile(src, dst)
	}
	var err error
	for tries := 0; tries < 10; tries++ {
		if err = attempt(); err == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return err
}

// insideDir reports whether path sits inside dir (at any depth).
func insideDir(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// RemoveVideoPlanFootage deletes one imported footage file from the plan's
// workspace and drops it from the plan. Returns the updated plan.
func (a *App) RemoveVideoPlanFootage(planID, name string) (VideoPlan, error) {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." {
		return VideoPlan{}, fmt.Errorf("no footage file named")
	}
	plan, err := a.mutateVideoPlan(planID, func(p *VideoPlan) error {
		kept := make([]string, 0, len(p.Files))
		for _, f := range p.Files {
			if f != name {
				kept = append(kept, f)
			}
		}
		p.Files = kept
		return nil
	})
	if err != nil {
		return VideoPlan{}, err
	}
	// Best-effort: the plan no longer references it; a leftover file is
	// harmless and visible in the workspace folder.
	if err := os.Remove(filepath.Join(a.editWorkspaceDir(planID), name)); err != nil && !os.IsNotExist(err) {
		log.Printf("jax: remove footage %s: %v", name, err)
	}
	return plan, nil
}

// uniqueWorkspaceName returns name, or a "name (2).ext"-style variant when a
// file with that name already exists in dir.
func uniqueWorkspaceName(dir, name string) string {
	if !fileExists(filepath.Join(dir, name)) {
		return name
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", stem, i, ext)
		if !fileExists(filepath.Join(dir, candidate)) {
			return candidate
		}
	}
}

// mutateVideoPlan loads the stored plans, applies fn to the one matching id,
// and persists the set. Works on the raw stored records so derived fields
// (thumbnail URLs) are never written back.
func (a *App) mutateVideoPlan(id string, fn func(p *VideoPlan) error) (VideoPlan, error) {
	if a.store == nil {
		return VideoPlan{}, fmt.Errorf("storage unavailable")
	}
	var plans []VideoPlan
	if _, err := a.store.getJSON(keyVideoPlans, &plans); err != nil {
		return VideoPlan{}, err
	}
	for i := range plans {
		if plans[i].ID != id {
			continue
		}
		if err := fn(&plans[i]); err != nil {
			return VideoPlan{}, err
		}
		if err := a.store.setJSON(keyVideoPlans, plans); err != nil {
			return VideoPlan{}, err
		}
		out := plans[i]
		out.ThumbnailURL = a.planThumbURL(out.ThumbnailFile)
		out.ThumbnailHistoryURLs = a.planThumbHistoryURLs(out.ThumbnailHistory)
		return out, nil
	}
	return VideoPlan{}, fmt.Errorf("that video plan no longer exists")
}

package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

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

// ImportVideoPlanFootage copies picked video files into the plan's edit
// workspace root and records them on the plan. A name that collides with a
// file already in the workspace gets a numbered suffix, so imports never
// overwrite a downloaded broadcast or each other. Returns the updated plan.
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
		if err := copyFile(src, filepath.Join(dir, name)); err != nil {
			return VideoPlan{}, fmt.Errorf("could not copy %s: %w", filepath.Base(src), err)
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

package main

import (
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Projects
//
// A Project is a creatable body of work (a launch, a build, a campaign) with a
// title and a markdown description. It carries uploaded files/assets (each
// with its own description) and a tree of markdown docs (each doc may nest
// under a parent). Metadata is stored as a single JSON blob in the settings
// table; asset files live on disk under ~/.jax/projects/<id>/assets and are
// served by the loopback media server (see media.go).
// ---------------------------------------------------------------------------

// ProjectAsset is one uploaded file belonging to a project.
type ProjectAsset struct {
	ID string `json:"id"`
	// Name is the file's name on disk inside the project's assets folder.
	Name        string `json:"name"`
	Description string `json:"description"`
	SizeBytes   int64  `json:"sizeBytes"`
	AddedAt     string `json:"addedAt"`
	// MediaURL is the app-served URL of the file ("/projectfiles/...");
	// computed on read, never persisted.
	MediaURL string `json:"mediaUrl"`
}

// ProjectDoc is one markdown document in a project's documentation tree.
// ParentID references another doc in the same project ("" = top level).
type ProjectDoc struct {
	ID        string `json:"id"`
	ParentID  string `json:"parentId"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

// Project is a creatable body of work that stream plans can reference.
type Project struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Repository is the project's code home ("owner/repo" or a full URL);
	// optional, shown as a link on the Overview.
	Repository string `json:"repository"`
	// ThumbnailFile is the project's cover image, stored as a bare file name
	// in the shared plan-thumbs folder (uploaded or AI-generated);
	// ThumbnailURL is derived per launch, never persisted.
	ThumbnailFile string `json:"thumbnailFile"`
	ThumbnailURL  string `json:"thumbnailUrl"`
	// Active marks the project currently being worked on. At most one project
	// is active at a time; set it with SetActiveProject, which clears the flag
	// everywhere else. SaveProject preserves the stored value.
	Active    bool           `json:"active"`
	CreatedAt string         `json:"createdAt"`
	Assets    []ProjectAsset `json:"assets"`
	Docs      []ProjectDoc   `json:"docs"`
}

// projectsDir returns the root directory holding per-project files
// (~/.jax/projects), creating it if necessary.
func projectsDir() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(dir, "projects")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	return root, nil
}

// projectAssetsDir returns a project's asset directory, creating it if needed.
func projectAssetsDir(projectID string) (string, error) {
	root, err := projectsDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, projectID, "assets")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// fillAssetURLs stamps each asset's app-served URL. Slices are also
// normalised so the Wails bindings marshal arrays rather than null.
func (a *App) fillAssetURLs(p *Project) {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()

	if p.Assets == nil {
		p.Assets = []ProjectAsset{}
	}
	if p.Docs == nil {
		p.Docs = []ProjectDoc{}
	}
	for i := range p.Assets {
		p.Assets[i].MediaURL = base + projectFilesPrefix +
			url.PathEscape(p.ID) + "/assets/" + url.PathEscape(p.Assets[i].Name)
	}
	p.ThumbnailURL = a.planThumbURL(p.ThumbnailFile)
}

// getProjects reads the raw stored project list (no URL filling). Never nil.
func (a *App) getProjects() []Project {
	if a.store == nil {
		return []Project{}
	}
	var projects []Project
	if _, err := a.store.getJSON(keyProjects, &projects); err != nil {
		log.Printf("jax: getProjects: %v", err)
	}
	if projects == nil {
		return []Project{}
	}
	return projects
}

// GetProjects returns the saved projects, newest first. Never nil.
func (a *App) GetProjects() []Project {
	projects := a.getProjects()
	for i := range projects {
		a.fillAssetURLs(&projects[i])
	}
	return projects
}

// SaveProject upserts a project's title and description (matched by ID),
// assigning an ID and creation time on first save, and returns the stored
// value. Assets, docs, and the active flag are managed by their own methods
// and are preserved as stored — the supplied copies are ignored.
func (a *App) SaveProject(p Project) (Project, error) {
	if a.store == nil {
		return p, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(p.Title) == "" {
		return p, fmt.Errorf("a title is required")
	}
	// Stored as a bare file name in the plan-thumbs folder; the URL is
	// derived per launch, never persisted.
	p.ThumbnailFile = sanitizeThumbFile(p.ThumbnailFile)
	p.ThumbnailURL = ""

	all := a.getProjects()
	if p.ID == "" {
		p.ID = fmt.Sprintf("project_%d", time.Now().UnixNano())
	}
	if p.CreatedAt == "" {
		p.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, existing := range all {
		if existing.ID == p.ID {
			p.Assets = existing.Assets
			p.Docs = existing.Docs
			p.Active = existing.Active
			all[i] = p
			replaced = true
			break
		}
	}
	if !replaced {
		p.Assets = []ProjectAsset{}
		p.Docs = []ProjectDoc{}
		// A new project is only active once it is chosen, except when it is
		// the first one — there is nothing else it could be.
		p.Active = len(all) == 0
		all = append([]Project{p}, all...)
	}

	if err := a.store.setJSON(keyProjects, all); err != nil {
		return p, err
	}
	a.fillAssetURLs(&p)
	return p, nil
}

// DeleteProject removes a project and its on-disk files.
func (a *App) DeleteProject(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.getProjects()
	out := make([]Project, 0, len(all))
	active := false
	for _, p := range all {
		if p.ID != id {
			active = active || p.Active
			out = append(out, p)
		}
	}
	// Deleting the active project hands the flag to the newest survivor, so
	// there is always an active project while any exist.
	if !active && len(out) > 0 {
		out[0].Active = true
	}
	if err := a.store.setJSON(keyProjects, out); err != nil {
		return err
	}
	// Best-effort: the metadata is already gone; orphaned files are harmless.
	if root, err := projectsDir(); err == nil && id != "" {
		_ = os.RemoveAll(filepath.Join(root, id))
	}
	return nil
}

// mutateProject loads the stored projects, applies fn to the one matching id,
// and persists the set. fn returns an error to abort without saving.
func (a *App) mutateProject(id string, fn func(p *Project) error) (Project, error) {
	if a.store == nil {
		return Project{}, fmt.Errorf("storage unavailable")
	}
	all := a.getProjects()
	for i := range all {
		if all[i].ID != id {
			continue
		}
		if err := fn(&all[i]); err != nil {
			return Project{}, err
		}
		if err := a.store.setJSON(keyProjects, all); err != nil {
			return Project{}, err
		}
		p := all[i]
		a.fillAssetURLs(&p)
		return p, nil
	}
	return Project{}, fmt.Errorf("that project no longer exists")
}

// SetProjectThumbnail records a project's cover image (a bare file name in
// the shared plan-thumbs folder) and returns the updated project. Split out
// from SaveProject so a background generation can land its result without
// racing edits to the other fields.
func (a *App) SetProjectThumbnail(projectID, file string) (Project, error) {
	return a.mutateProject(projectID, func(p *Project) error {
		p.ThumbnailFile = sanitizeThumbFile(file)
		return nil
	})
}

// SetActiveProject marks one project as the active one and clears the flag on
// every other project, so exactly one is ever active. An empty id leaves no
// project active. Returns the projects as stored, newest first.
func (a *App) SetActiveProject(id string) ([]Project, error) {
	if a.store == nil {
		return nil, fmt.Errorf("storage unavailable")
	}
	all := a.getProjects()
	found := id == ""
	for i := range all {
		active := all[i].ID == id
		if active {
			found = true
		}
		all[i].Active = active
	}
	if !found {
		return nil, fmt.Errorf("that project no longer exists")
	}
	if err := a.store.setJSON(keyProjects, all); err != nil {
		return nil, err
	}
	for i := range all {
		a.fillAssetURLs(&all[i])
	}
	return all, nil
}

// GetActiveProject returns the active project, or a zero Project when none is
// active. Callers that need the whole set use GetProjects.
func (a *App) GetActiveProject() Project {
	for _, p := range a.GetProjects() {
		if p.Active {
			return p
		}
	}
	return Project{}
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

// AddProjectAssets opens a native multi-file picker and copies the chosen
// files into the project's assets folder, recording one asset per file. It
// returns the updated project (unchanged when the picker is cancelled).
func (a *App) AddProjectAssets(projectID string) (Project, error) {
	if a.ctx == nil {
		return Project{}, fmt.Errorf("no window context")
	}
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Add files to this project",
	})
	if err != nil {
		return Project{}, err
	}
	if len(paths) == 0 {
		// Cancelled; hand back the current state so the frontend can no-op.
		return a.mutateProject(projectID, func(*Project) error { return nil })
	}

	dir, err := projectAssetsDir(projectID)
	if err != nil {
		return Project{}, err
	}

	return a.mutateProject(projectID, func(p *Project) error {
		for _, src := range paths {
			name, size, err := copyIntoDir(src, dir)
			if err != nil {
				return fmt.Errorf("could not copy %s: %w", filepath.Base(src), err)
			}
			p.Assets = append(p.Assets, ProjectAsset{
				ID:        fmt.Sprintf("asset_%d", time.Now().UnixNano()),
				Name:      name,
				SizeBytes: size,
				AddedAt:   time.Now().UTC().Format(time.RFC3339),
			})
		}
		return nil
	})
}

// copyIntoDir copies src into dir, deduplicating the filename with a numeric
// suffix on collision, and returns the final name and size.
func copyIntoDir(src, dir string) (string, int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return "", 0, err
	}
	defer in.Close()

	base := filepath.Base(src)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	name := base
	for n := 2; ; n++ {
		if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
			break
		}
		name = fmt.Sprintf("%s (%d)%s", stem, n, ext)
	}

	out, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return "", 0, err
	}
	size, err := io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(filepath.Join(dir, name))
		return "", 0, err
	}
	return name, size, nil
}

// UpdateProjectAsset sets an asset's description and returns the updated
// project.
func (a *App) UpdateProjectAsset(projectID, assetID, description string) (Project, error) {
	return a.mutateProject(projectID, func(p *Project) error {
		for i := range p.Assets {
			if p.Assets[i].ID == assetID {
				p.Assets[i].Description = description
				return nil
			}
		}
		return fmt.Errorf("that file no longer exists")
	})
}

// DeleteProjectAsset removes an asset's metadata and its file on disk, and
// returns the updated project.
func (a *App) DeleteProjectAsset(projectID, assetID string) (Project, error) {
	var name string
	p, err := a.mutateProject(projectID, func(p *Project) error {
		out := p.Assets[:0]
		for _, asset := range p.Assets {
			if asset.ID == assetID {
				name = asset.Name
				continue
			}
			out = append(out, asset)
		}
		p.Assets = out
		return nil
	})
	if err != nil {
		return p, err
	}
	if name != "" {
		if dir, derr := projectAssetsDir(projectID); derr == nil {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
	return p, nil
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

// SaveProjectDoc upserts a doc (matched by ID) in a project's documentation
// tree, assigning an ID and creation time on first save, and returns the
// updated project. ParentID must reference an existing doc in the same
// project ("" = top level) and must not create a cycle.
func (a *App) SaveProjectDoc(projectID string, doc ProjectDoc) (Project, error) {
	if strings.TrimSpace(doc.Title) == "" {
		return Project{}, fmt.Errorf("give the doc a title")
	}
	return a.mutateProject(projectID, func(p *Project) error {
		if doc.ID == "" {
			doc.ID = fmt.Sprintf("doc_%d", time.Now().UnixNano())
		}
		if doc.CreatedAt == "" {
			doc.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		}
		if doc.ParentID != "" {
			// The parent must exist, and walking up from it must never reach
			// the doc being saved (that would orphan the subtree in a cycle).
			parents := map[string]string{}
			exists := false
			for _, d := range p.Docs {
				parents[d.ID] = d.ParentID
				if d.ID == doc.ParentID {
					exists = true
				}
			}
			if !exists {
				return fmt.Errorf("that parent doc no longer exists")
			}
			for cur := doc.ParentID; cur != ""; cur = parents[cur] {
				if cur == doc.ID {
					return fmt.Errorf("a doc cannot be nested under itself")
				}
			}
		}
		for i := range p.Docs {
			if p.Docs[i].ID == doc.ID {
				p.Docs[i] = doc
				return nil
			}
		}
		p.Docs = append(p.Docs, doc)
		return nil
	})
}

// DeleteProjectDoc removes a doc; its children are promoted to the deleted
// doc's parent so no content is lost. Returns the updated project.
func (a *App) DeleteProjectDoc(projectID, docID string) (Project, error) {
	return a.mutateProject(projectID, func(p *Project) error {
		parent := ""
		out := p.Docs[:0]
		for _, d := range p.Docs {
			if d.ID == docID {
				parent = d.ParentID
				continue
			}
			out = append(out, d)
		}
		for i := range out {
			if out[i].ParentID == docID {
				out[i].ParentID = parent
			}
		}
		p.Docs = out
		return nil
	})
}

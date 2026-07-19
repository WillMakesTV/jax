package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Video plans
//
// A video plan is the Planning-side counterpart of a planned stream, for
// produced (non-live) content: a short-form or long-form video being worked
// towards. Plans are stored as a JSON blob in the settings table (like
// planned streams) and surface at the top of the Videos page.
// ---------------------------------------------------------------------------

// VideoPlanStream references one past stream a planned video draws from.
// Streams are identified by their start time (the identity chat, transcript,
// and episode assignments already key off); the title is snapshotted for
// display so the reference stays readable even if the VOD later disappears.
type VideoPlanStream struct {
	StartedAt string `json:"startedAt"` // RFC3339
	Title     string `json:"title"`
}

// VideoPlan is one planned video.
type VideoPlan struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Format distinguishes short-form (Shorts, clips) from long-form videos.
	Format string   `json:"format"` // "short" | "long"
	Tags   []string `json:"tags"`
	// Streams are the past streams this video is sourced from.
	Streams []VideoPlanStream `json:"streams"`
	// Files are imported footage files (bare names) in the plan's edit
	// workspace root — source material that never aired as a broadcast.
	// Owned by ImportVideoPlanFootage/RemoveVideoPlanFootage (see
	// plan_footage.go); preserved across SaveVideoPlan.
	Files []string `json:"files"`
	// FileURLs are the media-server addresses of Files, index-aligned;
	// recomputed on every read, never persisted.
	FileURLs []string `json:"fileUrls"`
	// ThumbnailFile names the plan's thumbnail image in ~/.jax/plan_thumbs
	// ("" = none; shared with stream-plan thumbnails, see plan_thumbs.go).
	// ThumbnailURL is the served address, recomputed on every read.
	ThumbnailFile string `json:"thumbnailFile"`
	ThumbnailURL  string `json:"thumbnailUrl"`
	// ThumbnailHistory: previous thumbnails (newest first, capped), for
	// restoring an earlier version; maintained server-side on save.
	ThumbnailHistory     []string `json:"thumbnailHistory"`
	ThumbnailHistoryURLs []string `json:"thumbnailHistoryUrls"`
	CreatedAt            string   `json:"createdAt"` // RFC3339
	// Status is where the plan is in its life: "" (or "planned") while it is
	// being produced, "completed" once the video is out. A completed plan
	// leaves the planned list and becomes a Tracked Video — the same plan, now
	// followed for how the published video is doing rather than for what still
	// has to be done to it. Completing is reversible.
	Status      string `json:"status"`
	CompletedAt string `json:"completedAt"` // RFC3339; "" until completed
	// ShareURLs are the other places the finished video was posted (TikTok,
	// Instagram, Facebook, ...), added by hand on the Tracked Videos list.
	// They resolve to live listings and aggregate views in GetTrackedVideos;
	// owned by SetVideoPlanShares (see video_shares.go), not the edit form.
	ShareURLs []string `json:"shareUrls"`
}

// Plan lifecycle values for VideoPlan.Status.
const (
	planStatusPlanned   = "planned"
	planStatusCompleted = "completed"
)

// completed reports whether the plan has been published and put to bed.
func (p VideoPlan) completed() bool { return p.Status == planStatusCompleted }

// keyVideoPlans stores the video-plan list.
const keyVideoPlans = "video_plans"

// GetVideoPlans returns the saved video plans, newest first. Never nil.
func (a *App) GetVideoPlans() []VideoPlan {
	if a.store == nil {
		return []VideoPlan{}
	}
	var plans []VideoPlan
	if _, err := a.store.getJSON(keyVideoPlans, &plans); err != nil {
		log.Printf("jax: GetVideoPlans: %v", err)
	}
	if plans == nil {
		return []VideoPlan{}
	}
	for i := range plans {
		plans[i].ThumbnailURL = a.planThumbURL(plans[i].ThumbnailFile)
		plans[i].ThumbnailHistoryURLs = a.planThumbHistoryURLs(plans[i].ThumbnailHistory)
		plans[i].FileURLs = a.planFileURLs(plans[i].ID, plans[i].Files)
	}
	return plans
}

// SaveVideoPlan upserts a video plan (matched by ID), assigning an ID and
// creation time on first save, and returns the stored value.
func (a *App) SaveVideoPlan(plan VideoPlan) (VideoPlan, error) {
	if a.store == nil {
		return plan, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(plan.Title) == "" {
		return plan, fmt.Errorf("a title is required")
	}
	if plan.Format != "short" {
		plan.Format = "long"
	}
	if plan.Tags == nil {
		plan.Tags = []string{}
	}
	if plan.Streams == nil {
		plan.Streams = []VideoPlanStream{}
	}
	if plan.Files == nil {
		plan.Files = []string{}
	}
	if plan.ShareURLs == nil {
		plan.ShareURLs = []string{}
	}
	// Stored as a bare file name in the plan-thumbs folder; the URL is
	// derived per launch, never persisted. The history is authoritative
	// server-side, recomputed from the stored plan on every save.
	plan.ThumbnailFile = sanitizeThumbFile(plan.ThumbnailFile)
	plan.ThumbnailURL = ""
	plan.ThumbnailHistory = []string{}
	plan.ThumbnailHistoryURLs = nil
	plan.FileURLs = nil

	plans := a.GetVideoPlans()
	if plan.ID == "" {
		plan.ID = fmt.Sprintf("vplan_%d", time.Now().UnixNano())
	}
	if plan.CreatedAt == "" {
		plan.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, p := range plans {
		if p.ID == plan.ID {
			plan.ThumbnailHistory = updateThumbHistory(
				p.ThumbnailHistory, p.ThumbnailFile, plan.ThumbnailFile,
			)
			// The lifecycle belongs to CompleteVideoPlan/ReopenVideoPlan, not
			// to the edit form — editing a completed plan's tags must not
			// quietly drag it back into the planned list.
			plan.Status = p.Status
			plan.CompletedAt = p.CompletedAt
			// Share links belong to SetVideoPlanShares; the edit form never
			// carries them and must not wipe them.
			plan.ShareURLs = p.ShareURLs
			// Imported footage belongs to Import/RemoveVideoPlanFootage.
			plan.Files = p.Files
			plans[i] = plan
			replaced = true
			break
		}
	}
	if !replaced {
		// Newest first.
		plans = append([]VideoPlan{plan}, plans...)
	}

	if err := a.store.setJSON(keyVideoPlans, plans); err != nil {
		return plan, err
	}
	// The plan's sources decide its season, and the season decides which folder
	// its edit workspace lives in — so changing the sources can re-file it (see
	// relocateEditWorkspaces in editor.go).
	go a.relocateEditWorkspaces()
	plan.ThumbnailURL = a.planThumbURL(plan.ThumbnailFile)
	plan.ThumbnailHistoryURLs = a.planThumbHistoryURLs(plan.ThumbnailHistory)
	plan.FileURLs = a.planFileURLs(plan.ID, plan.Files)
	return plan, nil
}

// setPlanStatus moves a plan along its lifecycle and returns the stored value.
func (a *App) setPlanStatus(id, status string) (VideoPlan, error) {
	if a.store == nil {
		return VideoPlan{}, fmt.Errorf("storage unavailable")
	}
	plans := a.GetVideoPlans()
	for i := range plans {
		if plans[i].ID != id {
			continue
		}
		plans[i].Status = status
		if status == planStatusCompleted {
			plans[i].CompletedAt = time.Now().UTC().Format(time.RFC3339)
		} else {
			plans[i].CompletedAt = ""
		}
		// The stored form carries file names, not the URLs derived per launch.
		stored := make([]VideoPlan, len(plans))
		copy(stored, plans)
		for j := range stored {
			stored[j].ThumbnailURL = ""
			stored[j].ThumbnailHistoryURLs = nil
			stored[j].FileURLs = nil
		}
		if err := a.store.setJSON(keyVideoPlans, stored); err != nil {
			return VideoPlan{}, err
		}
		return plans[i], nil
	}
	return VideoPlan{}, fmt.Errorf("that video plan no longer exists")
}

// CompleteVideoPlan puts a published plan to bed: it leaves the planned list
// and becomes a Tracked Video. Nothing is thrown away — the workspace, the
// renders, and the revision history all stay — so reopening it is just as
// cheap.
func (a *App) CompleteVideoPlan(id string) (VideoPlan, error) {
	return a.setPlanStatus(id, planStatusCompleted)
}

// ReopenVideoPlan pulls a completed plan back into production.
func (a *App) ReopenVideoPlan(id string) (VideoPlan, error) {
	return a.setPlanStatus(id, planStatusPlanned)
}

// TrackedVideo is a completed plan: the video that came out of it, and how it
// is doing now. The plan keeps everything it always had (sources, script,
// workspace); what changes is the question being asked of it — no longer "what
// is left to do" but "how did it land".
type TrackedVideo struct {
	Plan VideoPlan `json:"plan"`
	// Record is the publish this plan produced (nil when the video went out
	// some other way — the plan can still be completed by hand).
	Record *VideoPublishRecord `json:"record"`
	// Live is the published video as the platform reports it now: title,
	// thumbnail, and view count. Nil until the platform lists it (a fresh
	// upload can take a while) or when YouTube isn't connected.
	Live *Video `json:"live"`
	// Shares is every place the video lives: the publish records (YouTube,
	// TikTok) plus the plan's hand-added ShareURLs, each resolved to the live
	// listing when one of the connected channels carries it. Never nil.
	Shares []TrackedShare `json:"shares"`
	// TotalViews sums the resolved shares' view counts, each video counted
	// once however many URLs point at it.
	TotalViews int64 `json:"totalViews"`
}

// GetTrackedVideos returns the completed plans, newest first, each joined to
// the video it produced, that video's current platform stats, and every
// share of it across the connected channels.
func (a *App) GetTrackedVideos() []TrackedVideo {
	records := a.videoPublishRecords()
	tiktok := a.tiktokPublishRecords()

	// The platform's own view of the published videos — served from the same
	// 1-hour cache the Videos page reads, so this costs nothing extra. Keyed
	// two ways: "platform|id" (ids collide across platforms — Facebook and
	// Instagram both use long numerics), and by normalized URL for platforms
	// whose public URL doesn't carry the API id (Instagram permalinks).
	byKey := map[string]*Video{}
	byURL := map[string]*Video{}
	if videos, _, _, err := a.allVideos(false); err == nil {
		for i := range videos {
			v := &videos[i]
			byKey[v.Platform+"|"+v.ID] = v
			if n := normalizeVideoURL(v.URL); n != "" {
				byURL[n] = v
			}
		}
	}

	out := []TrackedVideo{}
	for _, plan := range a.GetVideoPlans() {
		if !plan.completed() {
			continue
		}
		tracked := TrackedVideo{Plan: plan}
		if rec, ok := records[plan.ID]; ok {
			tracked.Record = &rec
			if v, ok := byKey["youtube|"+rec.VideoID]; ok {
				tracked.Live = v
			}
		}
		var tik *TikTokPublishRecord
		if rec, ok := tiktok[plan.ID]; ok {
			tik = &rec
		}
		tracked.Shares, tracked.TotalViews = resolveTrackedShares(
			plan, tracked.Record, tik, byKey, byURL)
		out = append(out, tracked)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Plan.CompletedAt > out[j].Plan.CompletedAt
	})
	return out
}

// DeleteVideoPlan removes a video plan by ID, along with everything the app
// kept for it: the edit script, the manual timeline, the publish draft and
// record, and the edit workspace on disk (renders, revision history, and the
// linked source footage).
//
// A running edit session on the plan blocks the delete — pulling the workspace
// out from under it would leave a headless Claude Code session writing into a
// folder that no longer exists.
func (a *App) DeleteVideoPlan(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	a.mu.Lock()
	busy := (a.editCmd != nil && a.editPlanID == id) ||
		a.exportingPlan == id || a.publishingPlan == id || a.movingEdits
	a.mu.Unlock()
	if busy {
		return fmt.Errorf("this plan is being worked on right now — stop the session (or wait for it to finish) before deleting it")
	}

	// The workspace goes first: if it can't be removed, the plan stays and the
	// producer can act on the message, rather than losing the plan and being
	// left with an orphaned folder nothing points at any more.
	if err := a.removeEditWorkspace(id); err != nil {
		return err
	}

	plans := a.GetVideoPlans()
	out := make([]VideoPlan, 0, len(plans))
	for _, p := range plans {
		if p.ID != id {
			out = append(out, p)
		}
	}
	if err := a.store.setJSON(keyVideoPlans, out); err != nil {
		return err
	}

	a.forgetPlanState(id)
	return nil
}

// forgetPlanState drops the per-plan entries every other feature keeps in the
// settings table. Best-effort: the plan itself is already gone, and a stranded
// draft is dead weight, not a failure worth reporting.
func (a *App) forgetPlanState(planID string) {
	drop := func(key string) {
		m := map[string]json.RawMessage{}
		if _, err := a.store.getJSON(key, &m); err != nil {
			return
		}
		if _, ok := m[planID]; !ok {
			return
		}
		delete(m, planID)
		if err := a.store.setJSON(key, m); err != nil {
			log.Printf("jax: clearing %s for %s: %v", key, planID, err)
		}
	}
	drop(keyEditScripts)
	drop(keyPlanTimelines)
	drop(keyVideoPublish)
	drop(keyVideoPublishDrafts)
}

// removeEditWorkspace deletes a plan's edit workspace.
//
// The skill link inside it (a junction on Windows) points at the vendored
// video-use library, and a recursive remove that follows it would empty the
// real thing — so the link is dropped first, exactly as a workspace move does.
func (a *App) removeEditWorkspace(planID string) error {
	dir := a.editWorkspaceDir(planID)
	if !isDir(dir) {
		return nil // never prepared, or already gone
	}
	// Remove the junction itself (not what it points at) before anything walks
	// the tree.
	if err := os.Remove(filepath.Join(dir, ".claude", "skills", "video-use")); err != nil &&
		!os.IsNotExist(err) {
		return fmt.Errorf("the workspace's skill link could not be removed (%v) — the plan was not deleted", err)
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("the plan's workspace could not be removed (%v) — close anything using it and try again", err)
	}
	// The season folder it sat in may now be empty; Remove only succeeds on an
	// empty directory, so this can't take a sibling's workspace with it.
	if season := filepath.Dir(dir); season != filepath.Clean(a.resolveEditRoot()) {
		_ = os.Remove(season)
	}
	return nil
}

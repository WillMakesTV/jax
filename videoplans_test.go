package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// planWithWorkspace gives a plan a prepared-looking workspace: a render, a
// revision, and the skill link that makes deleting it dangerous.
func planWithWorkspace(t *testing.T, a *App, title string) VideoPlan {
	t.Helper()
	plan, err := a.SaveVideoPlan(VideoPlan{Title: title, Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	ws := a.editWorkspaceDir(plan.ID)
	for _, dir := range []string{
		filepath.Join(ws, "edit", "versions", "20260709-231601.000"),
		filepath.Join(ws, ".claude", "skills"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(ws, "edit", "final.mp4"), []byte("cut"), 0o644); err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestDeleteVideoPlanRemovesItsStateAndWorkspace(t *testing.T) {
	a := newTestApp(t)
	plan := planWithWorkspace(t, a, "Boss fight")
	other := planWithWorkspace(t, a, "Keep me")

	// Everything the app keeps per plan.
	if err := a.SaveEditScript(plan.ID, "the script"); err != nil {
		t.Fatal(err)
	}
	if err := a.SavePlanTimeline(plan.ID, PlanTimeline{
		File: "final.mp4", Segments: []TimelineSegment{{Start: 0, End: 5}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.SaveVideoPublishDraft(plan.ID, VideoPublishDraft{Title: "draft"}); err != nil {
		t.Fatal(err)
	}
	// The neighbouring plan's state must survive the delete untouched.
	if err := a.SaveEditScript(other.ID, "keep this script"); err != nil {
		t.Fatal(err)
	}

	ws := a.editWorkspaceDir(plan.ID)
	if err := a.DeleteVideoPlan(plan.ID); err != nil {
		t.Fatalf("DeleteVideoPlan: %v", err)
	}

	for _, p := range a.GetVideoPlans() {
		if p.ID == plan.ID {
			t.Fatal("the plan is still listed")
		}
	}
	if isDir(ws) {
		t.Errorf("the workspace was left behind at %s", ws)
	}
	if got := a.GetEditScript(plan.ID); got != "" {
		t.Errorf("the edit script outlived the plan: %q", got)
	}
	if got := a.GetPlanTimeline(plan.ID); len(got.Segments) != 0 {
		t.Errorf("the timeline outlived the plan: %+v", got)
	}
	if st := a.GetVideoPublish(plan.ID); st.Draft != nil {
		t.Errorf("the publish draft outlived the plan: %+v", st.Draft)
	}

	// The other plan is entirely unharmed.
	if got := a.GetEditScript(other.ID); got != "keep this script" {
		t.Errorf("deleting one plan clobbered another's script: %q", got)
	}
	if !isDir(a.editWorkspaceDir(other.ID)) {
		t.Error("deleting one plan removed another's workspace")
	}
}

// The workspace's .claude/skills/video-use is a junction into the vendored
// video-use library. A recursive delete that followed it would empty the real
// library — so the link has to be dropped before anything walks the tree.
func TestDeleteVideoPlanDoesNotFollowTheSkillJunction(t *testing.T) {
	a := newTestApp(t)
	plan := planWithWorkspace(t, a, "Boss fight")

	// The vendored library, standing in for ~/.jax/tools/video-use.
	library := t.TempDir()
	if err := os.WriteFile(filepath.Join(library, "SKILL.md"), []byte("the library"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(a.editWorkspaceDir(plan.ID), ".claude", "skills", "video-use")
	if err := linkDir(link, library); err != nil {
		t.Skipf("this platform won't link directories without privileges: %v", err)
	}

	if err := a.DeleteVideoPlan(plan.ID); err != nil {
		t.Fatalf("DeleteVideoPlan: %v", err)
	}

	// The library is the thing that must not have been touched.
	raw, err := os.ReadFile(filepath.Join(library, "SKILL.md"))
	if err != nil {
		t.Fatalf("the delete followed the junction and destroyed the vendored library: %v", err)
	}
	if string(raw) != "the library" {
		t.Errorf("the vendored library was modified: %q", raw)
	}
}

func TestDeleteVideoPlanRefusesWhileASessionIsRunning(t *testing.T) {
	a := newTestApp(t)
	plan := planWithWorkspace(t, a, "Boss fight")

	// Stand in for a running edit session on this plan.
	a.mu.Lock()
	a.editPlanID = plan.ID
	a.editCmd = &exec.Cmd{}
	a.mu.Unlock()

	if err := a.DeleteVideoPlan(plan.ID); err == nil {
		t.Fatal("want an error deleting a plan with a session running on it")
	}
	if !isDir(a.editWorkspaceDir(plan.ID)) {
		t.Error("the workspace was removed out from under the running session")
	}
	found := false
	for _, p := range a.GetVideoPlans() {
		if p.ID == plan.ID {
			found = true
		}
	}
	if !found {
		t.Error("the plan was deleted despite the running session")
	}
}

// ---------------------------------------------------------------------------
// Completing a plan into a Tracked Video
// ---------------------------------------------------------------------------

func TestCompleteMovesAPlanOutOfProductionAndBack(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	if plan.completed() {
		t.Fatal("a new plan should not read as completed")
	}
	if len(a.GetTrackedVideos()) != 0 {
		t.Fatal("a plan still in production must not be tracked")
	}

	done, err := a.CompleteVideoPlan(plan.ID)
	if err != nil {
		t.Fatalf("CompleteVideoPlan: %v", err)
	}
	if !done.completed() || done.CompletedAt == "" {
		t.Fatalf("the plan was not completed: %+v", done)
	}

	tracked := a.GetTrackedVideos()
	if len(tracked) != 1 || tracked[0].Plan.ID != plan.ID {
		t.Fatalf("the completed plan is not tracked: %+v", tracked)
	}

	// Reopening puts it back into production and out of the tracked list.
	back, err := a.ReopenVideoPlan(plan.ID)
	if err != nil {
		t.Fatalf("ReopenVideoPlan: %v", err)
	}
	if back.completed() || back.CompletedAt != "" {
		t.Fatalf("the plan was not reopened: %+v", back)
	}
	if len(a.GetTrackedVideos()) != 0 {
		t.Error("a reopened plan is still being tracked")
	}
}

// Editing a completed plan (its tags, its title) must not drag it back into the
// planned list — the lifecycle belongs to Complete/Reopen, not the edit form.
func TestEditingACompletedPlanKeepsItCompleted(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.CompleteVideoPlan(plan.ID); err != nil {
		t.Fatal(err)
	}

	// The edit form round-trips a plan without a status, exactly like this.
	edited, err := a.SaveVideoPlan(VideoPlan{
		ID:     plan.ID,
		Title:  "Boss fight (final)",
		Format: "long",
		Tags:   []string{"soulslike"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !edited.completed() {
		t.Fatalf("editing a completed plan reopened it: %+v", edited)
	}
	if edited.CompletedAt == "" {
		t.Error("the completion time was lost on save")
	}
	if edited.Title != "Boss fight (final)" {
		t.Errorf("the edit didn't stick: %q", edited.Title)
	}
}

// A tracked video carries the publish it produced, so the page can link to it.
func TestTrackedVideoCarriesItsPublishRecord(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	records := a.videoPublishRecords()
	records[plan.ID] = VideoPublishRecord{
		VideoID:     "abc123",
		URL:         youtubeWatchURL + "abc123",
		Title:       "Boss fight",
		File:        "final.mp4",
		PublishedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := a.store.setJSON(keyVideoPublish, records); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CompleteVideoPlan(plan.ID); err != nil {
		t.Fatal(err)
	}

	tracked := a.GetTrackedVideos()
	if len(tracked) != 1 {
		t.Fatalf("want one tracked video, got %d", len(tracked))
	}
	if tracked[0].Record == nil || tracked[0].Record.VideoID != "abc123" {
		t.Errorf("the tracked video lost its publish record: %+v", tracked[0].Record)
	}
}

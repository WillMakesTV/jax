package main

import (
	"strings"
	"testing"
)

func TestDebugReportRoundTrip(t *testing.T) {
	a := newTestApp(t)

	if _, err := a.SaveDebugReport(DebugReport{Title: "no body"}); err == nil {
		t.Fatal("want error for a blank description")
	}

	r, err := a.SaveDebugReport(DebugReport{
		Title:       "Thumbnail button dead",
		Description: "Clicking Generate on the plan page does nothing.",
		Route:       "planning",
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if r.ID == 0 || r.CreatedAt == "" || r.UpdatedAt == "" {
		t.Fatalf("id/timestamps not assigned: %+v", r)
	}

	got, err := a.GetDebugReport(r.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != r.Title || got.Route != "planning" || got.Global {
		t.Fatalf("round trip mismatch: %+v", got)
	}

	// Update keeps the id and CreatedAt, rewrites the rest.
	r.Description = "Repro: only fails when the plan has no series."
	r.Global = true
	upd, err := a.SaveDebugReport(r)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if upd.ID != r.ID || upd.CreatedAt != got.CreatedAt {
		t.Fatalf("update changed identity: %+v vs %+v", upd, got)
	}
	if !upd.Global || !strings.Contains(upd.Description, "Repro:") {
		t.Fatalf("update not applied: %+v", upd)
	}

	// Updating a report that does not exist is an error, not an insert.
	if _, err := a.SaveDebugReport(DebugReport{ID: 9999, Description: "ghost"}); err == nil {
		t.Fatal("want error updating a missing report")
	}
}

func TestDebugReportListCountDelete(t *testing.T) {
	a := newTestApp(t)

	first, _ := a.SaveDebugReport(DebugReport{Description: "first"})
	second, _ := a.SaveDebugReport(DebugReport{Description: "second"})

	reports := a.ListDebugReports()
	if len(reports) != 2 || reports[0].ID != second.ID {
		t.Fatalf("want 2 reports newest first, got %+v", reports)
	}
	if n, _ := a.CountDebugReports(); n != 2 {
		t.Fatalf("count = %d, want 2", n)
	}

	if err := a.DeleteDebugReport(first.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := a.DeleteDebugReport(first.ID); err == nil {
		t.Fatal("want error deleting twice")
	}
	if n, _ := a.CountDebugReports(); n != 1 {
		t.Fatalf("count after delete = %d, want 1", n)
	}
}

func TestDebugReportSearch(t *testing.T) {
	a := newTestApp(t)

	_, _ = a.SaveDebugReport(DebugReport{Title: "Dashboard chart gap", Description: "Growth chart skips days."})
	_, _ = a.SaveDebugReport(DebugReport{Title: "Modal focus", Description: "Escape closes the wrong dialog on Dashboard."})
	_, _ = a.SaveDebugReport(DebugReport{Title: "100% CPU", Description: "Spins while idle."})

	// Matches in titles and in descriptions, case-insensitively.
	hits, err := a.SearchDebugReports("dashboard")
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 2 {
		t.Fatalf("dashboard hits = %d, want 2 (title + description match)", len(hits))
	}

	// LIKE wildcards in the query are literals, not patterns.
	hits, err = a.SearchDebugReports("100%")
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 || hits[0].Title != "100% CPU" {
		t.Fatalf(`"100%%" hits = %+v, want the CPU report only`, hits)
	}
	if hits, _ = a.SearchDebugReports("100_"); len(hits) != 0 {
		t.Fatalf(`"100_" should match nothing, got %+v`, hits)
	}

	// A blank query is just a list.
	if hits, _ = a.SearchDebugReports("  "); len(hits) != 3 {
		t.Fatalf("blank query hits = %d, want all 3", len(hits))
	}
}

func TestResolveDebugReportLeavesFixNotice(t *testing.T) {
	a := newTestApp(t)

	r, _ := a.SaveDebugReport(DebugReport{
		Title:       "Thumbnail button dead",
		Description: "Clicking Generate does nothing.",
		Route:       "planning",
	})

	if err := a.ResolveDebugReport(r.ID); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if n, _ := a.CountDebugReports(); n != 0 {
		t.Fatalf("report still open after resolve, count = %d", n)
	}
	if err := a.ResolveDebugReport(r.ID); err == nil {
		t.Fatal("want error resolving a missing report")
	}

	notices := a.ListFixNotices()
	if len(notices) != 1 {
		t.Fatalf("notices = %+v, want 1", notices)
	}
	n := notices[0]
	if n.Title != r.Title || n.Route != "planning" || n.ResolvedAt == "" {
		t.Fatalf("notice mismatch: %+v", n)
	}

	// Read once, gone for good.
	if err := a.DismissFixNotice(n.ID); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	if err := a.DismissFixNotice(n.ID); err == nil {
		t.Fatal("want error dismissing twice")
	}
	if got := a.ListFixNotices(); len(got) != 0 {
		t.Fatalf("notices after dismiss = %+v, want none", got)
	}

	// A withdrawal (plain delete) must not leave a notice behind.
	r2, _ := a.SaveDebugReport(DebugReport{Description: "withdrawn", Route: "videos"})
	if err := a.DeleteDebugReport(r2.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := a.ListFixNotices(); len(got) != 0 {
		t.Fatalf("withdrawal left a notice: %+v", got)
	}
}

// The optional AI Debugging skill only appears while the Development toggle
// is on — both in the Skills tab and over MCP, which share ListAppSkills.
func TestAIDebuggingSkillGatedBySetting(t *testing.T) {
	a := newTestApp(t)

	listed := func() bool {
		skills, err := a.ListAppSkills()
		if err != nil {
			t.Fatalf("list skills: %v", err)
		}
		for _, s := range skills {
			if s.ID == skillAIDebugging {
				return true
			}
		}
		return false
	}

	if listed() {
		t.Fatal("ai-debugging listed while disabled")
	}
	if _, err := a.getAppSkill(skillAIDebugging); err == nil {
		t.Fatal("getAppSkill should fail while disabled")
	}

	if err := a.SetSetting(keyDevDebugSkillEnabled, "true"); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !listed() {
		t.Fatal("ai-debugging missing while enabled")
	}
	skill, err := a.getAppSkill(skillAIDebugging)
	if err != nil {
		t.Fatalf("get skill: %v", err)
	}
	if !strings.Contains(skill.Content, "delete_debug_report") {
		t.Fatal("skill content should teach the resolve step")
	}
}

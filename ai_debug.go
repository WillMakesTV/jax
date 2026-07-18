package main

import (
	"fmt"
	"log"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// AI debug reports
//
// Bug reports filed from the discrete debug button in the app's top bar (or
// the Settings → Development tab). They persist in the dev_ai_debug table and
// are exposed over MCP so an AI client can pick up the queue: reproduce, fix,
// verify, then delete the report once resolved. See skills/ai-debugging.md.
// ---------------------------------------------------------------------------

// DebugReport is one filed bug report.
type DebugReport struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`       // short summary line
	Description string `json:"description"` // long-form description of the bug
	Route       string `json:"route"`       // app view id the bug appears on
	Global      bool   `json:"global"`      // applies app-wide, not to one view
	CheckedOut  bool   `json:"checkedOut"`  // an agent has claimed this report
	// IssueURL/IssueNumber reference the GitHub issue the AI-debugging
	// workflow opened for this report (recorded via save_debug_report right
	// after `gh issue create`).
	IssueURL    string `json:"issueUrl"`
	IssueNumber int64  `json:"issueNumber"`
	CreatedAt   string `json:"createdAt"` // RFC3339
	UpdatedAt   string `json:"updatedAt"` // RFC3339
}

// FixNotice is one resolved debug report: a permanent history entry that,
// while unread, doubles as the "your bug was fixed" notification the status
// bar shows. Clicking the notice marks it read; the row stays as history
// (Settings → Development) with its GitHub issue reference.
type FixNotice struct {
	ID          int64  `json:"id"`
	ReportID    int64  `json:"reportId"`    // the resolved report's id
	Title       string `json:"title"`       // the resolved report's title
	Description string `json:"description"` // the report as it was resolved
	Route       string `json:"route"`       // app view id the report was filed on
	IssueURL    string `json:"issueUrl"`    // GitHub issue the fix landed under
	IssueNumber int64  `json:"issueNumber"`
	Read        bool   `json:"read"`       // the notice has been seen
	ResolvedAt  string `json:"resolvedAt"` // RFC3339
}

// --- Store ------------------------------------------------------------------

const debugReportColumns = `id, title, description, route, global, checked_out, issue_url, issue_number, created_at, updated_at`

func scanDebugReport(row interface{ Scan(...any) error }) (DebugReport, error) {
	var r DebugReport
	var global, checkedOut int
	err := row.Scan(&r.ID, &r.Title, &r.Description, &r.Route, &global,
		&checkedOut, &r.IssueURL, &r.IssueNumber, &r.CreatedAt, &r.UpdatedAt)
	r.Global = global != 0
	r.CheckedOut = checkedOut != 0
	return r, err
}

// listDebugReports returns every report, newest first.
func (s *Store) listDebugReports() ([]DebugReport, error) {
	rows, err := s.db.Query(
		`SELECT ` + debugReportColumns + ` FROM dev_ai_debug ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DebugReport{}
	for rows.Next() {
		r, err := scanDebugReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// getDebugReport returns one report by id.
func (s *Store) getDebugReport(id int64) (DebugReport, error) {
	row := s.db.QueryRow(
		`SELECT `+debugReportColumns+` FROM dev_ai_debug WHERE id = ?`, id)
	r, err := scanDebugReport(row)
	if err != nil {
		return DebugReport{}, fmt.Errorf("no debug report with id %d", id)
	}
	return r, nil
}

// insertDebugReport stores a new report and returns it with its assigned id.
func (s *Store) insertDebugReport(r DebugReport) (DebugReport, error) {
	res, err := s.db.Exec(
		`INSERT INTO dev_ai_debug (title, description, route, global, issue_url, issue_number, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Title, r.Description, r.Route, boolToInt(r.Global),
		r.IssueURL, r.IssueNumber, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return DebugReport{}, err
	}
	r.ID, err = res.LastInsertId()
	if err == nil {
		s.changed("dev_ai_debug")
	}
	return r, err
}

// updateDebugReport rewrites an existing report's fields.
func (s *Store) updateDebugReport(r DebugReport) error {
	res, err := s.db.Exec(
		`UPDATE dev_ai_debug
		 SET title = ?, description = ?, route = ?, global = ?,
		     issue_url = ?, issue_number = ?, updated_at = ?
		 WHERE id = ?`,
		r.Title, r.Description, r.Route, boolToInt(r.Global),
		r.IssueURL, r.IssueNumber, r.UpdatedAt, r.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("no debug report with id %d", r.ID)
	}
	s.changed("dev_ai_debug")
	return nil
}

// deleteDebugReport removes a report.
func (s *Store) deleteDebugReport(id int64) error {
	res, err := s.db.Exec(`DELETE FROM dev_ai_debug WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("no debug report with id %d", id)
	}
	s.changed("dev_ai_debug")
	return nil
}

// checkOutDebugReport atomically claims a report for an agent: it sets
// checked_out only if it was still clear, so two agents racing for the same
// report can't both win. It returns the number of rows it changed — 1 on a
// successful claim, 0 when the report was already checked out (or gone).
func (s *Store) checkOutDebugReport(id int64) (int64, error) {
	res, err := s.db.Exec(
		`UPDATE dev_ai_debug SET checked_out = 1, updated_at = ?
		 WHERE id = ? AND checked_out = 0`,
		time.Now().UTC().Format(time.RFC3339), id)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		s.changed("dev_ai_debug")
	}
	return n, nil
}

// countDebugReports returns the number of open reports.
func (s *Store) countDebugReports() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM dev_ai_debug`).Scan(&n)
	return n, err
}

// searchDebugReports returns reports whose title or description contains q
// (case-insensitive for ASCII, per SQLite LIKE), newest first.
func (s *Store) searchDebugReports(q string) ([]DebugReport, error) {
	esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	pattern := "%" + esc + "%"
	rows, err := s.db.Query(
		`SELECT `+debugReportColumns+` FROM dev_ai_debug
		 WHERE title LIKE ? ESCAPE '\' OR description LIKE ? ESCAPE '\'
		 ORDER BY id DESC`, pattern, pattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DebugReport{}
	for rows.Next() {
		r, err := scanDebugReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

const fixNoticeColumns = `id, report_id, title, description, route, issue_url, issue_number, read, resolved_at`

func scanFixNotice(row interface{ Scan(...any) error }) (FixNotice, error) {
	var n FixNotice
	var read int
	err := row.Scan(&n.ID, &n.ReportID, &n.Title, &n.Description, &n.Route,
		&n.IssueURL, &n.IssueNumber, &read, &n.ResolvedAt)
	n.Read = read != 0
	return n, err
}

// insertFixNotice stores a resolved report's history entry and returns it
// with its assigned id.
func (s *Store) insertFixNotice(n FixNotice) (FixNotice, error) {
	res, err := s.db.Exec(
		`INSERT INTO dev_ai_debug_fixed (report_id, title, description, route, issue_url, issue_number, resolved_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		n.ReportID, n.Title, n.Description, n.Route, n.IssueURL, n.IssueNumber, n.ResolvedAt)
	if err != nil {
		return FixNotice{}, err
	}
	n.ID, err = res.LastInsertId()
	if err == nil {
		s.changed("dev_ai_debug_fixed")
	}
	return n, err
}

// listFixNotices returns every unread fix notice, oldest first — the order
// they were resolved in is the order they should be read in.
func (s *Store) listFixNotices() ([]FixNotice, error) {
	rows, err := s.db.Query(
		`SELECT ` + fixNoticeColumns + ` FROM dev_ai_debug_fixed WHERE read = 0 ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FixNotice{}
	for rows.Next() {
		n, err := scanFixNotice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// listResolvedReports returns the whole resolution history, newest first.
func (s *Store) listResolvedReports() ([]FixNotice, error) {
	rows, err := s.db.Query(
		`SELECT ` + fixNoticeColumns + ` FROM dev_ai_debug_fixed ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FixNotice{}
	for rows.Next() {
		n, err := scanFixNotice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// markFixNoticeRead flags a notice as seen. The row stays: it is the
// resolution history entry for its report.
func (s *Store) markFixNoticeRead(id int64) error {
	res, err := s.db.Exec(`UPDATE dev_ai_debug_fixed SET read = 1 WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("no fix notice with id %d", id)
	}
	s.changed("dev_ai_debug_fixed")
	return nil
}

// --- Bound App methods -------------------------------------------------------

// ListDebugReports returns every debug report, newest first.
func (a *App) ListDebugReports() []DebugReport {
	if a.store == nil {
		return []DebugReport{}
	}
	reports, err := a.store.listDebugReports()
	if err != nil {
		log.Printf("jax: ListDebugReports: %v", err)
		return []DebugReport{}
	}
	return reports
}

// GetDebugReport returns one debug report by id.
func (a *App) GetDebugReport(id int64) (DebugReport, error) {
	if a.store == nil {
		return DebugReport{}, fmt.Errorf("store is not open")
	}
	return a.store.getDebugReport(id)
}

// CheckOutDebugReport claims a report for the calling agent so several agents
// can work the same queue without colliding. It fails if the report is already
// checked out (or no longer exists); on success it returns the report with its
// checkedOut flag set.
func (a *App) CheckOutDebugReport(id int64) (DebugReport, error) {
	if a.store == nil {
		return DebugReport{}, fmt.Errorf("store is not open")
	}
	report, err := a.store.getDebugReport(id)
	if err != nil {
		return DebugReport{}, err
	}
	if report.CheckedOut {
		return DebugReport{}, fmt.Errorf(
			"debug report %d is already checked out by another agent", id)
	}
	n, err := a.store.checkOutDebugReport(id)
	if err != nil {
		return DebugReport{}, err
	}
	if n == 0 {
		// Another agent claimed it between the read and the update.
		return DebugReport{}, fmt.Errorf(
			"debug report %d is already checked out by another agent", id)
	}
	report.CheckedOut = true
	return report, nil
}

// SaveDebugReport creates (id 0) or updates a debug report and returns the
// stored value. A description is required; a blank route is fine for global
// reports.
func (a *App) SaveDebugReport(r DebugReport) (DebugReport, error) {
	if a.store == nil {
		return DebugReport{}, fmt.Errorf("store is not open")
	}
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.Route = strings.TrimSpace(r.Route)
	if r.Description == "" {
		return DebugReport{}, fmt.Errorf("a description is required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	r.UpdatedAt = now
	if r.ID == 0 {
		r.CreatedAt = now
		return a.store.insertDebugReport(r)
	}
	existing, err := a.store.getDebugReport(r.ID)
	if err != nil {
		return DebugReport{}, err
	}
	r.CreatedAt = existing.CreatedAt
	// An update that doesn't mention the issue keeps the recorded reference —
	// appending findings must not detach the report from its issue.
	if r.IssueURL == "" {
		r.IssueURL = existing.IssueURL
	}
	if r.IssueNumber == 0 {
		r.IssueNumber = existing.IssueNumber
	}
	if err := a.store.updateDebugReport(r); err != nil {
		return DebugReport{}, err
	}
	return r, nil
}

// DeleteDebugReport removes a debug report without notifying anyone — the
// reporter withdrawing their own report from the Development tab.
func (a *App) DeleteDebugReport(id int64) error {
	if a.store == nil {
		return fmt.Errorf("store is not open")
	}
	return a.store.deleteDebugReport(id)
}

// ResolveDebugReport removes a fixed report and leaves its history entry
// behind — unread, it doubles as the notice so the person who filed it hears
// the bug is resolved; read, it stays as the record of when and under which
// GitHub issue the fix landed. This is the MCP delete path; a withdrawal
// from the Development tab uses DeleteDebugReport and stays silent.
func (a *App) ResolveDebugReport(id int64) error {
	if a.store == nil {
		return fmt.Errorf("store is not open")
	}
	report, err := a.store.getDebugReport(id)
	if err != nil {
		return err
	}
	if err := a.store.deleteDebugReport(id); err != nil {
		return err
	}
	notice, err := a.store.insertFixNotice(FixNotice{
		ReportID:    report.ID,
		Title:       report.Title,
		Description: report.Description,
		Route:       report.Route,
		IssueURL:    report.IssueURL,
		IssueNumber: report.IssueNumber,
		ResolvedAt:  time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		// The resolve itself succeeded; a lost notice is worth a log line,
		// not a failed tool call.
		log.Printf("jax: ResolveDebugReport notice: %v", err)
		return nil
	}
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "debugfix:new", notice)
	}
	return nil
}

// ListFixNotices returns the unread bug-fixed notices, oldest first.
func (a *App) ListFixNotices() []FixNotice {
	if a.store == nil {
		return []FixNotice{}
	}
	notices, err := a.store.listFixNotices()
	if err != nil {
		log.Printf("jax: ListFixNotices: %v", err)
		return []FixNotice{}
	}
	return notices
}

// DismissFixNotice marks a notice read. The entry stays in the resolution
// history (see ListResolvedReports); only the status-bar notification goes.
func (a *App) DismissFixNotice(id int64) error {
	if a.store == nil {
		return fmt.Errorf("store is not open")
	}
	return a.store.markFixNoticeRead(id)
}

// ListResolvedReports returns the full resolution history, newest first —
// every report resolved over MCP, with its GitHub issue reference and when
// the fix landed.
func (a *App) ListResolvedReports() []FixNotice {
	if a.store == nil {
		return []FixNotice{}
	}
	history, err := a.store.listResolvedReports()
	if err != nil {
		log.Printf("jax: ListResolvedReports: %v", err)
		return []FixNotice{}
	}
	return history
}

// CountDebugReports returns how many debug reports are open.
func (a *App) CountDebugReports() (int, error) {
	if a.store == nil {
		return 0, nil
	}
	return a.store.countDebugReports()
}

// SearchDebugReports returns reports whose title or description contains q.
func (a *App) SearchDebugReports(q string) ([]DebugReport, error) {
	if a.store == nil {
		return []DebugReport{}, nil
	}
	if strings.TrimSpace(q) == "" {
		return a.store.listDebugReports()
	}
	return a.store.searchDebugReports(q)
}

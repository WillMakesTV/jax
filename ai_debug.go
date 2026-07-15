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
	CreatedAt   string `json:"createdAt"`   // RFC3339
	UpdatedAt   string `json:"updatedAt"`   // RFC3339
}

// FixNotice is the read-once "your bug was fixed" notification a resolved
// debug report leaves behind, so the person who filed it hears back. The
// status bar shows it with a link to the report's page; clicking dismisses it
// for good.
type FixNotice struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`      // the resolved report's title
	Route      string `json:"route"`      // app view id the report was filed on
	ResolvedAt string `json:"resolvedAt"` // RFC3339
}

// --- Store ------------------------------------------------------------------

const debugReportColumns = `id, title, description, route, global, created_at, updated_at`

func scanDebugReport(row interface{ Scan(...any) error }) (DebugReport, error) {
	var r DebugReport
	var global int
	err := row.Scan(&r.ID, &r.Title, &r.Description, &r.Route, &global,
		&r.CreatedAt, &r.UpdatedAt)
	r.Global = global != 0
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
		`INSERT INTO dev_ai_debug (title, description, route, global, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		r.Title, r.Description, r.Route, boolToInt(r.Global), r.CreatedAt, r.UpdatedAt)
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
		 SET title = ?, description = ?, route = ?, global = ?, updated_at = ?
		 WHERE id = ?`,
		r.Title, r.Description, r.Route, boolToInt(r.Global), r.UpdatedAt, r.ID)
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

// insertFixNotice stores a resolved report's notice and returns it with its
// assigned id.
func (s *Store) insertFixNotice(n FixNotice) (FixNotice, error) {
	res, err := s.db.Exec(
		`INSERT INTO dev_ai_debug_fixed (title, route, resolved_at) VALUES (?, ?, ?)`,
		n.Title, n.Route, n.ResolvedAt)
	if err != nil {
		return FixNotice{}, err
	}
	n.ID, err = res.LastInsertId()
	return n, err
}

// listFixNotices returns every unread fix notice, oldest first — the order
// they were resolved in is the order they should be read in.
func (s *Store) listFixNotices() ([]FixNotice, error) {
	rows, err := s.db.Query(
		`SELECT id, title, route, resolved_at FROM dev_ai_debug_fixed ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FixNotice{}
	for rows.Next() {
		var n FixNotice
		if err := rows.Scan(&n.ID, &n.Title, &n.Route, &n.ResolvedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// deleteFixNotice removes a notice (it was read).
func (s *Store) deleteFixNotice(id int64) error {
	res, err := s.db.Exec(`DELETE FROM dev_ai_debug_fixed WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("no fix notice with id %d", id)
	}
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

// ResolveDebugReport removes a fixed report and leaves a read-once notice
// behind, so the person who filed it hears the bug is resolved and can jump
// to the page to review the fix. This is the MCP delete path; a withdrawal
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
		Title:      report.Title,
		Route:      report.Route,
		ResolvedAt: time.Now().UTC().Format(time.RFC3339),
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

// DismissFixNotice deletes a notice once it has been read.
func (a *App) DismissFixNotice(id int64) error {
	if a.store == nil {
		return fmt.Errorf("store is not open")
	}
	return a.store.deleteFixNotice(id)
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

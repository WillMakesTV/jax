package main

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Setting keys used in the key/value `settings` table.
const (
	keyProfile        = "profile"
	keyServiceConfig  = "service_config"
	keyPlannedStreams = "planned_streams"
	keyContentSeries  = "content_series"
	keySeriesTypes    = "series_types"
	keyRoutines       = "routines"
	keyProjects       = "projects"
	keySponsors       = "sponsors"
	// keyStreamWidgets holds the Stream Widgets managed on the OBS section
	// (see widgets.go).
	keyStreamWidgets = "stream_widgets"
	// keyYouTubeLivePrefix holds the "🔴 LIVE: "-style prefix for YouTube
	// broadcast titles; shared with the frontend's SETTING_KEYS.
	keyYouTubeLivePrefix = "youtube_live_prefix"
	// keyAppSkillOverrides holds the id → markdown map of user-edited
	// Application Skills; ids absent from the map use the embedded default.
	keyAppSkillOverrides = "app_skill_overrides"
	// keyDevDebugSkillEnabled ("true"/"") gates the optional ai-debugging
	// Application Skill; shared with the frontend's SETTING_KEYS.
	keyDevDebugSkillEnabled = "dev_ai_debug_skill_enabled"
	// keyGitHubRepo holds the "owner/repo" the AI-debugging workflow files
	// issues and pushes fixes against (see github.go).
	keyGitHubRepo = "github_repo"
	// keyAppAbout holds the producer-authored description of the app itself
	// (Settings → About; see about.go).
	keyAppAbout = "app_about"
)

// Store wraps the SQLite database that persists all app data. The database
// lives at ~/.jax/jax.db so it is shared across builds and survives reinstalls.
type Store struct {
	db *sql.DB
	// onChange, when set, is called with the storage key after every settings
	// write — how the app tells open pages their data moved underneath them
	// (see startup's "data:changed" emit). Called from whatever goroutine
	// wrote, so the hook must be safe to call concurrently.
	onChange func(key string)
}

// changed reports a write to key through the onChange hook (nil-safe).
func (s *Store) changed(key string) {
	if s.onChange != nil {
		s.onChange(key)
	}
}

// dataDir returns the ~/.jax directory, creating it (0700) if necessary.
func dataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".jax")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// openStore opens (creating if needed) the SQLite database at ~/.jax/jax.db and
// applies the schema.
func openStore() (*Store, error) {
	dir, err := dataDir()
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "jax.db"))
	if err != nil {
		return nil, err
	}
	// SQLite allows a single writer; serialising connections avoids spurious
	// "database is locked" errors under the app's light, bursty write load.
	db.SetMaxOpenConns(1)

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close releases the underlying database handle.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_sources (
	id      INTEGER PRIMARY KEY AUTOINCREMENT,
	title   TEXT NOT NULL DEFAULT '',
	url     TEXT NOT NULL DEFAULT '',
	account TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS streams (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	title       TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	plan        TEXT NOT NULL DEFAULT '',
	cs_title    TEXT NOT NULL DEFAULT '',
	cs_url      TEXT NOT NULL DEFAULT '',
	cs_account  TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS service_conns (
	name          TEXT PRIMARY KEY,
	token         TEXT NOT NULL DEFAULT '',
	refresh_token TEXT NOT NULL DEFAULT '',
	client_id     TEXT NOT NULL DEFAULT '',
	client_secret TEXT NOT NULL DEFAULT '',
	user_id       TEXT NOT NULL DEFAULT '',
	login         TEXT NOT NULL DEFAULT '',
	account       TEXT NOT NULL DEFAULT '',
	expires_at    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stream_groups (
	broadcast_key TEXT PRIMARY KEY,
	group_id      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_cache (
	key        TEXT PRIMARY KEY,
	value      TEXT NOT NULL,
	fetched_at INTEGER NOT NULL
);
-- One row per platform per day: the audience numbers as they stood. The
-- primary key is what makes the day idempotent — reading the Dashboard ten
-- times in a day overwrites the day's row rather than piling up ten points on
-- the growth chart (see metrics.go).
CREATE TABLE IF NOT EXISTS channel_metrics (
	day        TEXT NOT NULL,
	platform   TEXT NOT NULL,
	audience   INTEGER NOT NULL DEFAULT 0,
	supporters INTEGER NOT NULL DEFAULT 0,
	likes      INTEGER NOT NULL DEFAULT 0,
	content    INTEGER NOT NULL DEFAULT 0,
	views      INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, platform)
);
CREATE TABLE IF NOT EXISTS transcript_sessions (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	started_at TEXT NOT NULL,
	title      TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS transcript_lines (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL,
	at         INTEGER NOT NULL,
	end_at     INTEGER NOT NULL,
	text       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcript_lines_session
	ON transcript_lines(session_id, at);
CREATE TABLE IF NOT EXISTS transcribe_jobs (
	subfolder TEXT PRIMARY KEY,
	queued_at TEXT NOT NULL DEFAULT '',
	pos_secs  REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transcribe_staged_lines (
	id        INTEGER PRIMARY KEY AUTOINCREMENT,
	subfolder TEXT NOT NULL,
	at        INTEGER NOT NULL,
	end_at    INTEGER NOT NULL,
	text      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcribe_staged_subfolder
	ON transcribe_staged_lines(subfolder, at);
CREATE TABLE IF NOT EXISTS stream_sessions (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	plan_id    TEXT NOT NULL DEFAULT '',
	title      TEXT NOT NULL DEFAULT '',
	series_id  TEXT NOT NULL DEFAULT '',
	episode    INTEGER NOT NULL DEFAULT 0,
	started_at TEXT NOT NULL,
	ended_at   TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS local_broadcasts (
	broadcast_key TEXT PRIMARY KEY,
	subfolder     TEXT NOT NULL,
	data          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
	platform     TEXT NOT NULL,
	id           TEXT NOT NULL,
	author       TEXT NOT NULL DEFAULT '',
	author_id    TEXT NOT NULL DEFAULT '',
	author_login TEXT NOT NULL DEFAULT '',
	avatar_url   TEXT NOT NULL DEFAULT '',
	badges       TEXT NOT NULL DEFAULT '[]',
	color        TEXT NOT NULL DEFAULT '',
	text         TEXT NOT NULL,
	at           INTEGER NOT NULL,
	read         INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (platform, id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_at ON chat_messages(at);
CREATE TABLE IF NOT EXISTS live_events (
	platform TEXT NOT NULL,
	id       TEXT NOT NULL,
	type     TEXT NOT NULL DEFAULT '',
	author   TEXT NOT NULL DEFAULT '',
	detail   TEXT NOT NULL DEFAULT '',
	at       INTEGER NOT NULL,
	read     INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (platform, id)
);
CREATE INDEX IF NOT EXISTS idx_live_events_at ON live_events(at);
-- Developer debug reports filed from the in-app debug button; an AI client
-- works them over MCP and deletes each once resolved (see ai_debug.go).
CREATE TABLE IF NOT EXISTS dev_ai_debug (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	title        TEXT NOT NULL DEFAULT '',
	description  TEXT NOT NULL DEFAULT '',
	route        TEXT NOT NULL DEFAULT '',
	global       INTEGER NOT NULL DEFAULT 0,
	checked_out  INTEGER NOT NULL DEFAULT 0,
	issue_url    TEXT NOT NULL DEFAULT '',
	issue_number INTEGER NOT NULL DEFAULT 0,
	created_at   TEXT NOT NULL,
	updated_at   TEXT NOT NULL
);
-- Resolved-report history: one row per resolved debug report, kept for good.
-- Unread rows double as the "your bug was fixed" notices the status bar
-- shows; a click marks them read (see ai_debug.go).
CREATE TABLE IF NOT EXISTS dev_ai_debug_fixed (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	report_id    INTEGER NOT NULL DEFAULT 0,
	title        TEXT NOT NULL DEFAULT '',
	description  TEXT NOT NULL DEFAULT '',
	route        TEXT NOT NULL DEFAULT '',
	issue_url    TEXT NOT NULL DEFAULT '',
	issue_number INTEGER NOT NULL DEFAULT 0,
	read         INTEGER NOT NULL DEFAULT 0,
	resolved_at  TEXT NOT NULL
);`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Columns added after these tables shipped; CREATE TABLE IF NOT EXISTS
	// leaves existing tables untouched, so add them here. A duplicate-column
	// error just means an up-to-date database — ignore it.
	for _, stmt := range []string{
		`ALTER TABLE dev_ai_debug ADD COLUMN checked_out INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE dev_ai_debug ADD COLUMN issue_url TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE dev_ai_debug ADD COLUMN issue_number INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE dev_ai_debug_fixed ADD COLUMN report_id INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE dev_ai_debug_fixed ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE dev_ai_debug_fixed ADD COLUMN issue_url TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE dev_ai_debug_fixed ADD COLUMN issue_number INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE dev_ai_debug_fixed ADD COLUMN read INTEGER NOT NULL DEFAULT 0`,
	} {
		if _, err := s.db.Exec(stmt); err != nil &&
			!strings.Contains(err.Error(), "duplicate column name") {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Generic key/value settings
// ---------------------------------------------------------------------------

// getSetting returns the stored value for key, or "" if it has never been set.
func (s *Store) getSetting(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

// setSetting upserts a value for key.
func (s *Store) setSetting(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value,
	)
	if err == nil {
		s.changed(key)
	}
	return err
}

// getJSON reads a JSON-encoded setting into out. ok is false when the key has
// never been set, so callers can fall back to their defaults.
func (s *Store) getJSON(key string, out any) (ok bool, err error) {
	raw, err := s.getSetting(key)
	if err != nil || raw == "" {
		return false, err
	}
	if err := json.Unmarshal([]byte(raw), out); err != nil {
		return false, err
	}
	return true, nil
}

// setJSON stores value as a JSON-encoded setting.
func (s *Store) setJSON(key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.setSetting(key, string(raw))
}

// ---------------------------------------------------------------------------
// API response cache
//
// Platform API responses that are not live/real-time (video lists, past
// broadcasts, per-video analytics) are cached here so browsing the app does
// not burn API quota. Freshness policy lives in cache.go.
// ---------------------------------------------------------------------------

// getCacheEntry returns the cached payload for key and when it was fetched.
// ok is false when the key has never been cached.
func (s *Store) getCacheEntry(key string) (raw string, fetchedAt time.Time, ok bool, err error) {
	var at int64
	err = s.db.QueryRow(
		`SELECT value, fetched_at FROM api_cache WHERE key = ?`, key,
	).Scan(&raw, &at)
	if err == sql.ErrNoRows {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, err
	}
	return raw, time.Unix(at, 0), true, nil
}

// deleteCacheEntry drops a cached payload so the next read refetches.
func (s *Store) deleteCacheEntry(key string) error {
	_, err := s.db.Exec(`DELETE FROM api_cache WHERE key = ?`, key)
	return err
}

// recordChannelMetrics files one platform's numbers for a day, replacing any
// earlier reading from the same day — the last read of a day is the one that
// stands (see metrics.go).
func (s *Store) recordChannelMetrics(day string, m ChannelMetrics) error {
	_, err := s.db.Exec(
		`INSERT INTO channel_metrics (day, platform, audience, supporters, likes, content, views)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(day, platform) DO UPDATE SET
		   audience   = excluded.audience,
		   supporters = excluded.supporters,
		   likes      = excluded.likes,
		   content    = excluded.content,
		   views      = excluded.views`,
		day, m.Platform, m.Audience, m.Supporters, m.Likes, m.Content, m.Views,
	)
	return err
}

// channelMetricsSince reads every recorded day from `from` (inclusive),
// grouped by day.
func (s *Store) channelMetricsSince(from string) (map[string][]ChannelMetrics, error) {
	rows, err := s.db.Query(
		`SELECT day, platform, audience, supporters, likes, content, views
		   FROM channel_metrics
		  WHERE day >= ?
		  ORDER BY day ASC`, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]ChannelMetrics{}
	for rows.Next() {
		var day string
		var m ChannelMetrics
		if err := rows.Scan(&day, &m.Platform, &m.Audience, &m.Supporters,
			&m.Likes, &m.Content, &m.Views); err != nil {
			return nil, err
		}
		out[day] = append(out[day], m)
	}
	return out, rows.Err()
}

// setCacheEntry upserts a cached payload for key, stamped now.
func (s *Store) setCacheEntry(key, raw string) error {
	_, err := s.db.Exec(
		`INSERT INTO api_cache (key, value, fetched_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
		key, raw, time.Now().Unix(),
	)
	return err
}

// ---------------------------------------------------------------------------
// Streams & channel sources
// ---------------------------------------------------------------------------

// getStreams returns every stored stream. The result is never nil so the Wails
// binding marshals an empty array rather than null.
func (s *Store) getStreams() ([]Stream, error) {
	rows, err := s.db.Query(
		`SELECT title, description, plan, cs_title, cs_url, cs_account
		 FROM streams ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	streams := []Stream{}
	for rows.Next() {
		var st Stream
		if err := rows.Scan(
			&st.Title, &st.Description, &st.Plan,
			&st.ChannelSource.Title, &st.ChannelSource.URL, &st.ChannelSource.Account,
		); err != nil {
			return nil, err
		}
		streams = append(streams, st)
	}
	return streams, rows.Err()
}

// saveStreams replaces the stored stream set with the supplied slice.
func (s *Store) saveStreams(streams []Stream) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM streams`); err != nil {
		return err
	}
	for _, st := range streams {
		if _, err := tx.Exec(
			`INSERT INTO streams (title, description, plan, cs_title, cs_url, cs_account)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			st.Title, st.Description, st.Plan,
			st.ChannelSource.Title, st.ChannelSource.URL, st.ChannelSource.Account,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------------------------------------------------------------------------
// Service connections (OAuth sessions)
//
// Tokens are stored in plaintext in the local, per-user database — the same
// trade-off already made for the client secret / OBS password in the service
// config. A future version should move these to the OS keychain.
// ---------------------------------------------------------------------------

// saveServiceConn upserts a platform's OAuth session so it survives restarts.
func (s *Store) saveServiceConn(name string, conn serviceConn) error {
	var expiresAt int64
	if !conn.expiresAt.IsZero() {
		expiresAt = conn.expiresAt.Unix()
	}
	_, err := s.db.Exec(
		`INSERT INTO service_conns
			(name, token, refresh_token, client_id, client_secret, user_id, login, account, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(name) DO UPDATE SET
			token = excluded.token,
			refresh_token = excluded.refresh_token,
			client_id = excluded.client_id,
			client_secret = excluded.client_secret,
			user_id = excluded.user_id,
			login = excluded.login,
			account = excluded.account,
			expires_at = excluded.expires_at`,
		name, conn.token, conn.refreshToken, conn.clientID, conn.clientSecret,
		conn.userID, conn.login, conn.account, expiresAt,
	)
	return err
}

// deleteServiceConn removes a platform's stored OAuth session.
func (s *Store) deleteServiceConn(name string) error {
	_, err := s.db.Exec(`DELETE FROM service_conns WHERE name = ?`, name)
	return err
}

// getServiceConns loads every stored OAuth session, keyed by service name.
func (s *Store) getServiceConns() (map[string]serviceConn, error) {
	rows, err := s.db.Query(
		`SELECT name, token, refresh_token, client_id, client_secret, user_id, login, account, expires_at
		 FROM service_conns`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	conns := map[string]serviceConn{}
	for rows.Next() {
		var name string
		var conn serviceConn
		var expiresAt int64
		if err := rows.Scan(
			&name, &conn.token, &conn.refreshToken, &conn.clientID, &conn.clientSecret,
			&conn.userID, &conn.login, &conn.account, &expiresAt,
		); err != nil {
			return nil, err
		}
		if expiresAt > 0 {
			conn.expiresAt = time.Unix(expiresAt, 0)
		}
		conns[name] = conn
	}
	return conns, rows.Err()
}

// ---------------------------------------------------------------------------
// Manual stream groups
//
// Time-based aggregation of past broadcasts occasionally misses (see past.go),
// so the user can group streams by hand. Assignments are keyed by a stable
// broadcast identity ("platform|url") and survive refetches.
// ---------------------------------------------------------------------------

// getStreamGroups returns every manual broadcast→group assignment.
func (s *Store) getStreamGroups() (map[string]int64, error) {
	rows, err := s.db.Query(`SELECT broadcast_key, group_id FROM stream_groups`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := map[string]int64{}
	for rows.Next() {
		var key string
		var gid int64
		if err := rows.Scan(&key, &gid); err != nil {
			return nil, err
		}
		groups[key] = gid
	}
	return groups, rows.Err()
}

// groupBroadcasts places all given broadcast keys into one manual group. Any
// existing groups the keys belong to are merged into the new one.
func (s *Store) groupBroadcasts(keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Next free group id.
	var newGid int64
	if err := tx.QueryRow(
		`SELECT COALESCE(MAX(group_id), 0) + 1 FROM stream_groups`,
	).Scan(&newGid); err != nil {
		return err
	}

	// Merge any groups the keys already belong to into the new group, so
	// grouping an already-grouped stream pulls its whole group along.
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")
	args := make([]any, len(keys))
	for i, k := range keys {
		args[i] = k
	}
	if _, err := tx.Exec(
		`UPDATE stream_groups SET group_id = ?
		 WHERE group_id IN (
			SELECT DISTINCT group_id FROM stream_groups WHERE broadcast_key IN (`+placeholders+`)
		 )`,
		append([]any{newGid}, args...)...,
	); err != nil {
		return err
	}

	for _, key := range keys {
		if _, err := tx.Exec(
			`INSERT INTO stream_groups (broadcast_key, group_id) VALUES (?, ?)
			 ON CONFLICT(broadcast_key) DO UPDATE SET group_id = excluded.group_id`,
			key, newGid,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ungroupBroadcasts dissolves one manual group; its broadcasts fall back to
// time-based aggregation.
func (s *Store) ungroupBroadcasts(groupID int64) error {
	_, err := s.db.Exec(`DELETE FROM stream_groups WHERE group_id = ?`, groupID)
	return err
}

// ---------------------------------------------------------------------------
// Local broadcast snapshots
//
// Platforms eventually remove past broadcasts (Twitch expires archive VODs),
// but a downloaded copy should keep its past stream listed forever. While a
// downloaded broadcast is still listed by its platform, its PastBroadcast is
// snapshotted here (keyed by the same "platform|url" identity every other
// per-broadcast assignment uses); once the platform drops it, the snapshot is
// replayed as a local-only broadcast (see local.go).
// ---------------------------------------------------------------------------

// localBroadcastRow is one stored snapshot: the download subfolder holding the
// video plus the broadcast's PastBroadcast JSON.
type localBroadcastRow struct {
	subfolder string
	data      string
}

// getLocalBroadcasts returns every snapshot, keyed by broadcast key.
func (s *Store) getLocalBroadcasts() (map[string]localBroadcastRow, error) {
	rows, err := s.db.Query(`SELECT broadcast_key, subfolder, data FROM local_broadcasts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]localBroadcastRow{}
	for rows.Next() {
		var key string
		var row localBroadcastRow
		if err := rows.Scan(&key, &row.subfolder, &row.data); err != nil {
			return nil, err
		}
		out[key] = row
	}
	return out, rows.Err()
}

// upsertLocalBroadcast stores (or refreshes) one broadcast snapshot.
func (s *Store) upsertLocalBroadcast(key, subfolder, data string) error {
	_, err := s.db.Exec(
		`INSERT INTO local_broadcasts (broadcast_key, subfolder, data) VALUES (?, ?, ?)
		 ON CONFLICT(broadcast_key) DO UPDATE SET
			subfolder = excluded.subfolder, data = excluded.data`,
		key, subfolder, data,
	)
	return err
}

// deleteLocalBroadcastsBySubfolder drops every snapshot backed by a download
// subfolder (the download was deleted).
func (s *Store) deleteLocalBroadcastsBySubfolder(subfolder string) error {
	_, err := s.db.Exec(`DELETE FROM local_broadcasts WHERE subfolder = ?`, subfolder)
	return err
}

// ---------------------------------------------------------------------------
// Transcript logs
//
// One session per stream (keyed by the stream's start timestamp, the same
// identity past-stream aggregation uses), holding the raw transcribed
// utterances with their spoken-at times.
// ---------------------------------------------------------------------------

// beginTranscriptSession returns the session id for a stream start, creating
// the session on first use so capture restarts within one stream append to
// the same log.
func (s *Store) beginTranscriptSession(startedAt, title string) (int64, error) {
	var id int64
	err := s.db.QueryRow(
		`SELECT id FROM transcript_sessions WHERE started_at = ?`, startedAt,
	).Scan(&id)
	if err == nil {
		if title != "" {
			// Backfill the title (e.g. the first capture began before the
			// platform reported one).
			_, _ = s.db.Exec(
				`UPDATE transcript_sessions SET title = ? WHERE id = ? AND title = ''`,
				title, id,
			)
		}
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	res, err := s.db.Exec(
		`INSERT INTO transcript_sessions (started_at, title) VALUES (?, ?)`,
		startedAt, title,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// addTranscriptLine appends one utterance to a session's log.
func (s *Store) addTranscriptLine(sessionID, at, endAt int64, text string) error {
	_, err := s.db.Exec(
		`INSERT INTO transcript_lines (session_id, at, end_at, text) VALUES (?, ?, ?, ?)`,
		sessionID, at, endAt, text,
	)
	return err
}

// transcriptSessionRef is a session's identity for time-window matching.
type transcriptSessionRef struct {
	id        int64
	startedAt string
}

// getTranscriptSessions returns every session's id and stream start.
func (s *Store) getTranscriptSessions() ([]transcriptSessionRef, error) {
	rows, err := s.db.Query(`SELECT id, started_at FROM transcript_sessions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := []transcriptSessionRef{}
	for rows.Next() {
		var ref transcriptSessionRef
		if err := rows.Scan(&ref.id, &ref.startedAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, ref)
	}
	return sessions, rows.Err()
}

// getTranscriptLines returns the lines of the given sessions in spoken order.
func (s *Store) getTranscriptLines(sessionIDs []int64) ([]TranscriptLineRec, error) {
	if len(sessionIDs) == 0 {
		return []TranscriptLineRec{}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(sessionIDs)), ",")
	args := make([]any, len(sessionIDs))
	for i, id := range sessionIDs {
		args[i] = id
	}
	rows, err := s.db.Query(
		`SELECT at, end_at, text FROM transcript_lines
		 WHERE session_id IN (`+placeholders+`) ORDER BY at`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	lines := []TranscriptLineRec{}
	for rows.Next() {
		var l TranscriptLineRec
		if err := rows.Scan(&l.At, &l.EndAt, &l.Text); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, rows.Err()
}

// replaceTranscript atomically swaps a stream's transcript: the given old
// sessions (and their lines) are removed and one new session holding the
// supplied lines takes their place. Used when re-producing a transcript from
// a downloaded video, replacing whatever was captured live.
func (s *Store) replaceTranscript(oldSessionIDs []int64, startedAt, title string, lines []TranscriptLineRec) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if len(oldSessionIDs) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(oldSessionIDs)), ",")
		args := make([]any, len(oldSessionIDs))
		for i, id := range oldSessionIDs {
			args[i] = id
		}
		if _, err := tx.Exec(
			`DELETE FROM transcript_lines WHERE session_id IN (`+placeholders+`)`, args...,
		); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`DELETE FROM transcript_sessions WHERE id IN (`+placeholders+`)`, args...,
		); err != nil {
			return err
		}
	}

	res, err := tx.Exec(
		`INSERT INTO transcript_sessions (started_at, title) VALUES (?, ?)`,
		startedAt, title,
	)
	if err != nil {
		return err
	}
	sessionID, err := res.LastInsertId()
	if err != nil {
		return err
	}
	for _, l := range lines {
		if _, err := tx.Exec(
			`INSERT INTO transcript_lines (session_id, at, end_at, text) VALUES (?, ?, ?, ?)`,
			sessionID, l.At, l.EndAt, l.Text,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------------------------------------------------------------------------
// Transcription queue persistence
//
// Queued and running video-transcription jobs survive an app restart: the
// queue order and each job's media checkpoint live in transcribe_jobs, and
// utterances land in transcribe_staged_lines as they arrive. On relaunch the
// job resumes from its checkpoint; only on completion does the staged text
// replace the stream's transcript (see transcribe_video.go).
// ---------------------------------------------------------------------------

// upsertTranscribeJob records a queued job; an existing row (a resumed job)
// keeps its checkpoint.
func (s *Store) upsertTranscribeJob(subfolder, queuedAt string) error {
	_, err := s.db.Exec(
		`INSERT INTO transcribe_jobs (subfolder, queued_at, pos_secs) VALUES (?, ?, 0)
		 ON CONFLICT(subfolder) DO NOTHING`,
		subfolder, queuedAt,
	)
	return err
}

// setTranscribeJobPos advances a job's media checkpoint (seconds into the video).
func (s *Store) setTranscribeJobPos(subfolder string, pos float64) error {
	_, err := s.db.Exec(
		`UPDATE transcribe_jobs SET pos_secs = ? WHERE subfolder = ?`,
		pos, subfolder,
	)
	return err
}

// getTranscribeJobPos returns a job's checkpoint, 0 when it never ran.
func (s *Store) getTranscribeJobPos(subfolder string) (float64, error) {
	var pos float64
	err := s.db.QueryRow(
		`SELECT pos_secs FROM transcribe_jobs WHERE subfolder = ?`, subfolder,
	).Scan(&pos)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return pos, err
}

// getTranscribeJobSubfolders returns the persisted queue in enqueue order.
func (s *Store) getTranscribeJobSubfolders() ([]string, error) {
	rows, err := s.db.Query(
		`SELECT subfolder FROM transcribe_jobs ORDER BY queued_at, subfolder`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	subs := []string{}
	for rows.Next() {
		var sub string
		if err := rows.Scan(&sub); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	return subs, rows.Err()
}

// deleteTranscribeJob removes a job and its staged lines (job finished,
// failed, or was cancelled).
func (s *Store) deleteTranscribeJob(subfolder string) error {
	if _, err := s.db.Exec(
		`DELETE FROM transcribe_staged_lines WHERE subfolder = ?`, subfolder,
	); err != nil {
		return err
	}
	_, err := s.db.Exec(
		`DELETE FROM transcribe_jobs WHERE subfolder = ?`, subfolder,
	)
	return err
}

// addTranscribeStagedLine stages one transcribed utterance for a job.
func (s *Store) addTranscribeStagedLine(subfolder string, l TranscriptLineRec) error {
	_, err := s.db.Exec(
		`INSERT INTO transcribe_staged_lines (subfolder, at, end_at, text) VALUES (?, ?, ?, ?)`,
		subfolder, l.At, l.EndAt, l.Text,
	)
	return err
}

// getTranscribeStagedLines returns a job's staged utterances in spoken order.
func (s *Store) getTranscribeStagedLines(subfolder string) ([]TranscriptLineRec, error) {
	rows, err := s.db.Query(
		`SELECT at, end_at, text FROM transcribe_staged_lines
		 WHERE subfolder = ? ORDER BY at`,
		subfolder,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	lines := []TranscriptLineRec{}
	for rows.Next() {
		var l TranscriptLineRec
		if err := rows.Scan(&l.At, &l.EndAt, &l.Text); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, rows.Err()
}

// deleteTranscribeStagedFrom drops staged lines at or after a timestamp — the
// stretch a resumed job is about to replay.
func (s *Store) deleteTranscribeStagedFrom(subfolder string, at int64) error {
	_, err := s.db.Exec(
		`DELETE FROM transcribe_staged_lines WHERE subfolder = ? AND at >= ?`,
		subfolder, at,
	)
	return err
}

// ---------------------------------------------------------------------------
// Chat log
//
// Every chat message the app sees is kept locally so history is available
// instantly on launch (and offline) without replaying the platform APIs.
// ---------------------------------------------------------------------------

// chatLogKeep bounds the rolling chat log; the oldest rows beyond it are
// pruned unless they fall inside a stream session's window (see protect).
const chatLogKeep = 5000

// saveChatMessages inserts new messages (existing platform+id rows are left
// untouched, preserving their read state) and prunes the log. protect lists
// [lo, hi] unix-milli windows — chat captured during a stream session — whose
// messages are kept forever so a past stream's chat survives the rolling cap.
func (s *Store) saveChatMessages(items []StoredChatMessage, protect [][2]int64) error {
	if len(items) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, m := range items {
		badges, err := json.Marshal(m.Badges)
		if err != nil {
			badges = []byte("[]")
		}
		if _, err := tx.Exec(
			`INSERT INTO chat_messages
				(platform, id, author, author_id, author_login, avatar_url, badges, color, text, at, read)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(platform, id) DO NOTHING`,
			m.Platform, m.ID, m.Author, m.AuthorID, m.AuthorLogin,
			m.AvatarURL, string(badges), m.Color, m.Text, m.At, boolToInt(m.Read),
		); err != nil {
			return err
		}
	}

	prune := `DELETE FROM chat_messages WHERE rowid NOT IN (
		SELECT rowid FROM chat_messages ORDER BY at DESC LIMIT ?
	)`
	args := []any{chatLogKeep}
	for _, w := range protect {
		prune += ` AND NOT (at BETWEEN ? AND ?)`
		args = append(args, w[0], w[1])
	}
	if _, err := tx.Exec(prune, args...); err != nil {
		return err
	}
	return tx.Commit()
}

// getChatBetween returns the stored messages inside [lo, hi] (unix millis) in
// chronological order — including session-protected messages far older than
// the rolling log's cap.
func (s *Store) getChatBetween(lo, hi int64) ([]StoredChatMessage, error) {
	rows, err := s.db.Query(
		`SELECT platform, id, author, author_id, author_login, avatar_url, badges, color, text, at, read
		 FROM chat_messages WHERE at BETWEEN ? AND ? ORDER BY at ASC`, lo, hi,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := []StoredChatMessage{}
	for rows.Next() {
		var m StoredChatMessage
		var badges string
		var read int
		if err := rows.Scan(
			&m.Platform, &m.ID, &m.Author, &m.AuthorID, &m.AuthorLogin,
			&m.AvatarURL, &badges, &m.Color, &m.Text, &m.At, &read,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(badges), &m.Badges); err != nil || m.Badges == nil {
			m.Badges = []string{}
		}
		m.Read = read != 0
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

// ---------------------------------------------------------------------------
// Stream sessions
//
// One row per broadcast started from Jax with a planned stream: the stream's
// identity (plan, series, episode) plus its live window. Chat inside the
// window is exempt from the rolling log's prune, and the plan's series and
// episode ride the live-assignment mechanism onto the finished past stream
// (see stream_session.go).
// ---------------------------------------------------------------------------

// beginStreamSession records a new session, closing any still-open ones first
// (a crash or an OBS-side stop can leave one behind).
func (s *Store) beginStreamSession(planID, title, seriesID string, episode int, startedAt string) error {
	if err := s.endOpenStreamSessions(startedAt); err != nil {
		return err
	}
	_, err := s.db.Exec(
		`INSERT INTO stream_sessions (plan_id, title, series_id, episode, started_at)
		 VALUES (?, ?, ?, ?, ?)`,
		planID, title, seriesID, episode, startedAt,
	)
	return err
}

// endOpenStreamSessions stamps every open session as ended at endedAt.
func (s *Store) endOpenStreamSessions(endedAt string) error {
	_, err := s.db.Exec(
		`UPDATE stream_sessions SET ended_at = ? WHERE ended_at = ''`, endedAt,
	)
	return err
}

// latestSessionForPlan returns the newest session opened for a plan, ok false
// when the plan has never gone live.
func (s *Store) latestSessionForPlan(planID string) (startedAt, endedAt string, ok bool, err error) {
	err = s.db.QueryRow(
		`SELECT started_at, ended_at FROM stream_sessions
		 WHERE plan_id = ? ORDER BY id DESC LIMIT 1`, planID,
	).Scan(&startedAt, &endedAt)
	if err == sql.ErrNoRows {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	return startedAt, endedAt, true, nil
}

// deletePlanSessions removes every stream session opened for a plan and
// returns the deleted sessions' start times so the caller can unwind what
// each go-live registered.
func (s *Store) deletePlanSessions(planID string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT started_at FROM stream_sessions WHERE plan_id = ?`, planID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var starts []string
	for rows.Next() {
		var at string
		if err := rows.Scan(&at); err != nil {
			return nil, err
		}
		starts = append(starts, at)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	_, err = s.db.Exec(`DELETE FROM stream_sessions WHERE plan_id = ?`, planID)
	return starts, err
}

// planSessions returns each plan's newest [started_at, ended_at] session
// window, keyed by plan id.
func (s *Store) planSessions() (map[string][2]string, error) {
	rows, err := s.db.Query(
		`SELECT plan_id, started_at, ended_at FROM stream_sessions
		 WHERE plan_id != '' ORDER BY id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][2]string{}
	for rows.Next() {
		var id string
		var w [2]string
		if err := rows.Scan(&id, &w[0], &w[1]); err != nil {
			return nil, err
		}
		out[id] = w // ascending scan: the last row per plan wins
	}
	return out, rows.Err()
}

// streamSessionWindows returns every session's [started_at, ended_at] pair
// (ended_at is "" while the session is open).
func (s *Store) streamSessionWindows() ([][2]string, error) {
	rows, err := s.db.Query(`SELECT started_at, ended_at FROM stream_sessions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	windows := [][2]string{}
	for rows.Next() {
		var w [2]string
		if err := rows.Scan(&w[0], &w[1]); err != nil {
			return nil, err
		}
		windows = append(windows, w)
	}
	return windows, rows.Err()
}

// getChatHistory returns the newest limit messages in chronological order.
func (s *Store) getChatHistory(limit int) ([]StoredChatMessage, error) {
	rows, err := s.db.Query(
		`SELECT platform, id, author, author_id, author_login, avatar_url, badges, color, text, at, read
		 FROM (
			SELECT * FROM chat_messages ORDER BY at DESC LIMIT ?
		 ) ORDER BY at ASC`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := []StoredChatMessage{}
	for rows.Next() {
		var m StoredChatMessage
		var badges string
		var read int
		if err := rows.Scan(
			&m.Platform, &m.ID, &m.Author, &m.AuthorID, &m.AuthorLogin,
			&m.AvatarURL, &badges, &m.Color, &m.Text, &m.At, &read,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(badges), &m.Badges); err != nil || m.Badges == nil {
			m.Badges = []string{}
		}
		m.Read = read != 0
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

// markAllChatRead flips every stored message to read.
func (s *Store) markAllChatRead() error {
	_, err := s.db.Exec(`UPDATE chat_messages SET read = 1 WHERE read = 0`)
	return err
}

// ---------------------------------------------------------------------------
// Live-events log
//
// Every channel event the app sees (follows, subs, cheers, raids, members,
// Super Chats, new YouTube subscribers) is kept locally — one unified list
// across all streaming destinations — so the feed survives restarts. Unlike
// chat there is no rolling cap: events are rare and small, so all are kept.
// ---------------------------------------------------------------------------

// saveLiveEvents inserts events not yet stored (existing platform+id rows are
// left untouched, preserving their read state) and returns the ones that were
// actually new. Never returns nil.
func (s *Store) saveLiveEvents(items []StoredLiveEvent) ([]StoredLiveEvent, error) {
	fresh := []StoredLiveEvent{}
	if len(items) == 0 {
		return fresh, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fresh, err
	}
	defer tx.Rollback()

	for _, e := range items {
		res, err := tx.Exec(
			`INSERT INTO live_events (platform, id, type, author, detail, at, read)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(platform, id) DO NOTHING`,
			e.Platform, e.ID, e.Type, e.Author, e.Detail, e.At, boolToInt(e.Read),
		)
		if err != nil {
			return fresh, err
		}
		if n, err := res.RowsAffected(); err == nil && n > 0 {
			fresh = append(fresh, e)
		}
	}
	if err := tx.Commit(); err != nil {
		return fresh, err
	}
	return fresh, nil
}

// getLiveEventHistory returns the newest limit events in chronological order.
func (s *Store) getLiveEventHistory(limit int) ([]StoredLiveEvent, error) {
	rows, err := s.db.Query(
		`SELECT platform, id, type, author, detail, at, read
		 FROM (
			SELECT * FROM live_events ORDER BY at DESC LIMIT ?
		 ) ORDER BY at ASC`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []StoredLiveEvent{}
	for rows.Next() {
		var e StoredLiveEvent
		var read int
		if err := rows.Scan(
			&e.Platform, &e.ID, &e.Type, &e.Author, &e.Detail, &e.At, &read,
		); err != nil {
			return nil, err
		}
		e.Read = read != 0
		events = append(events, e)
	}
	return events, rows.Err()
}

// getLiveEventsBefore returns the newest limit events strictly older than
// before (unix millis), in chronological order — one page of the feed's
// lazy-loaded history.
func (s *Store) getLiveEventsBefore(before int64, limit int) ([]StoredLiveEvent, error) {
	rows, err := s.db.Query(
		`SELECT platform, id, type, author, detail, at, read
		 FROM (
			SELECT * FROM live_events WHERE at < ? ORDER BY at DESC LIMIT ?
		 ) ORDER BY at ASC`, before, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []StoredLiveEvent{}
	for rows.Next() {
		var e StoredLiveEvent
		var read int
		if err := rows.Scan(
			&e.Platform, &e.ID, &e.Type, &e.Author, &e.Detail, &e.At, &read,
		); err != nil {
			return nil, err
		}
		e.Read = read != 0
		events = append(events, e)
	}
	return events, rows.Err()
}

// getLiveEventsBetween returns the stored events inside [lo, hi] (unix
// millis) in chronological order.
func (s *Store) getLiveEventsBetween(lo, hi int64) ([]StoredLiveEvent, error) {
	rows, err := s.db.Query(
		`SELECT platform, id, type, author, detail, at, read
		 FROM live_events WHERE at BETWEEN ? AND ? ORDER BY at ASC`, lo, hi,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []StoredLiveEvent{}
	for rows.Next() {
		var e StoredLiveEvent
		var read int
		if err := rows.Scan(
			&e.Platform, &e.ID, &e.Type, &e.Author, &e.Detail, &e.At, &read,
		); err != nil {
			return nil, err
		}
		e.Read = read != 0
		events = append(events, e)
	}
	return events, rows.Err()
}

// latestLiveEventAt returns the newest stored event timestamp (unix millis),
// 0 when no events have ever been stored.
func (s *Store) latestLiveEventAt() (int64, error) {
	var at sql.NullInt64
	err := s.db.QueryRow(`SELECT MAX(at) FROM live_events`).Scan(&at)
	if err != nil {
		return 0, err
	}
	return at.Int64, nil
}

// markAllLiveEventsRead flips every stored event to read.
func (s *Store) markAllLiveEventsRead() error {
	_, err := s.db.Exec(`UPDATE live_events SET read = 1 WHERE read = 0`)
	return err
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// getChannelSources returns every stored channel source (never nil).
func (s *Store) getChannelSources() ([]ChannelSource, error) {
	rows, err := s.db.Query(`SELECT title, url, account FROM channel_sources ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sources := []ChannelSource{}
	for rows.Next() {
		var cs ChannelSource
		if err := rows.Scan(&cs.Title, &cs.URL, &cs.Account); err != nil {
			return nil, err
		}
		sources = append(sources, cs)
	}
	return sources, rows.Err()
}

// saveChannelSources replaces the stored channel-source set.
func (s *Store) saveChannelSources(sources []ChannelSource) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM channel_sources`); err != nil {
		return err
	}
	for _, cs := range sources {
		if _, err := tx.Exec(
			`INSERT INTO channel_sources (title, url, account) VALUES (?, ?, ?)`,
			cs.Title, cs.URL, cs.Account,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

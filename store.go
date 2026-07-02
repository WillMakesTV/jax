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
	keyProfile       = "profile"
	keyServiceConfig = "service_config"
)

// Store wraps the SQLite database that persists all app data. The database
// lives at ~/.jax/jax.db so it is shared across builds and survives reinstalls.
type Store struct {
	db *sql.DB
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
);`
	_, err := s.db.Exec(schema)
	return err
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

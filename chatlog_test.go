package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// openTestStore opens a fresh store in a temp directory.
func openTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestChatLogRoundTrip(t *testing.T) {
	s := openTestStore(t)

	msgs := []StoredChatMessage{
		{Platform: "twitch", ID: "a", Author: "Ann", Badges: []string{"VIP"}, Text: "hi", At: 1000, Read: false},
		{Platform: "youtube", ID: "b", Author: "Bob", Badges: []string{}, Text: "yo", At: 2000, Read: true},
	}
	if err := s.saveChatMessages(msgs); err != nil {
		t.Fatalf("save: %v", err)
	}
	// Saving the same ids again must not error or duplicate.
	if err := s.saveChatMessages(msgs); err != nil {
		t.Fatalf("re-save: %v", err)
	}

	got, err := s.getChatHistory(10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 messages, got %d", len(got))
	}
	if got[0].ID != "a" || got[1].ID != "b" {
		t.Fatalf("wrong order: %v %v", got[0].ID, got[1].ID)
	}
	if got[0].Read || !got[1].Read {
		t.Fatalf("read state lost: %+v", got)
	}
	if len(got[0].Badges) != 1 || got[0].Badges[0] != "VIP" {
		t.Fatalf("badges lost: %+v", got[0].Badges)
	}

	if err := s.markAllChatRead(); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	got, _ = s.getChatHistory(10)
	if !got[0].Read {
		t.Fatalf("markAllChatRead did not stick")
	}
}

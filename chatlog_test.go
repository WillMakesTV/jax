package main

import (
	"database/sql"
	"path/filepath"
	"strconv"
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
	if err := s.saveChatMessages(msgs, nil); err != nil {
		t.Fatalf("save: %v", err)
	}
	// Saving the same ids again must not error or duplicate.
	if err := s.saveChatMessages(msgs, nil); err != nil {
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

// Chat inside a stream session's window survives the rolling cap; everything
// older outside a window is pruned once the log exceeds chatLogKeep.
func TestChatLogSessionRetention(t *testing.T) {
	s := openTestStore(t)

	// A finished session covering at = [1000, 2000].
	if err := s.beginStreamSession("plan_1", "Session", "series_1", 3, "2026-01-01T00:00:00Z"); err != nil {
		t.Fatalf("begin session: %v", err)
	}
	if err := s.endOpenStreamSessions("2026-01-01T02:00:00Z"); err != nil {
		t.Fatalf("end session: %v", err)
	}
	windows, err := s.streamSessionWindows()
	if err != nil || len(windows) != 1 {
		t.Fatalf("windows: %v %v", windows, err)
	}
	if windows[0][0] != "2026-01-01T00:00:00Z" || windows[0][1] != "2026-01-01T02:00:00Z" {
		t.Fatalf("wrong window: %v", windows[0])
	}

	// Two protected messages, then enough newer ones to overflow the cap.
	protectedMsgs := []StoredChatMessage{
		{Platform: "twitch", ID: "s1", Text: "in session", At: 1000, Badges: []string{}},
		{Platform: "twitch", ID: "s2", Text: "also in session", At: 2000, Badges: []string{}},
	}
	filler := make([]StoredChatMessage, 0, chatLogKeep+10)
	for i := 0; i < chatLogKeep+10; i++ {
		filler = append(filler, StoredChatMessage{
			Platform: "twitch", ID: "f" + strconv.Itoa(i),
			Text: "later", At: int64(10_000 + i), Badges: []string{},
		})
	}
	protect := [][2]int64{{500, 2500}}
	if err := s.saveChatMessages(protectedMsgs, protect); err != nil {
		t.Fatalf("save protected: %v", err)
	}
	if err := s.saveChatMessages(filler, protect); err != nil {
		t.Fatalf("save filler: %v", err)
	}

	// The protected pair must still be there, found by time range.
	kept, err := s.getChatBetween(500, 2500)
	if err != nil {
		t.Fatalf("between: %v", err)
	}
	if len(kept) != 2 || kept[0].ID != "s1" || kept[1].ID != "s2" {
		t.Fatalf("protected messages lost: %+v", kept)
	}

	// Without protection they would have been pruned (they are the oldest).
	if err := s.saveChatMessages(filler[:1], nil); err != nil {
		t.Fatalf("save unprotected: %v", err)
	}
	kept, _ = s.getChatBetween(500, 2500)
	if len(kept) != 0 {
		t.Fatalf("expected prune without windows, got %d", len(kept))
	}
}

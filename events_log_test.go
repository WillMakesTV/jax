package main

import "testing"

func TestLiveEventsRoundTrip(t *testing.T) {
	s := openTestStore(t)

	events := []StoredLiveEvent{
		{Platform: "twitch", ID: "follow:1", Type: "follow", Author: "Ann", Detail: "followed the channel", At: 1000},
		{Platform: "youtube", ID: "sub-b", Type: "follow", Author: "Bob", Detail: "subscribed to the channel", At: 2000, Read: true},
	}
	fresh, err := s.saveLiveEvents(events)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if len(fresh) != 2 {
		t.Fatalf("want 2 fresh, got %d", len(fresh))
	}

	// Saving the same ids again must not error, duplicate, or report fresh.
	fresh, err = s.saveLiveEvents(events)
	if err != nil {
		t.Fatalf("re-save: %v", err)
	}
	if len(fresh) != 0 {
		t.Fatalf("re-save reported %d fresh, want 0", len(fresh))
	}

	got, err := s.getLiveEventHistory(10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 events, got %d", len(got))
	}
	if got[0].ID != "follow:1" || got[1].ID != "sub-b" {
		t.Fatalf("wrong order: %v %v", got[0].ID, got[1].ID)
	}
	if got[0].Read || !got[1].Read {
		t.Fatalf("read state lost: %+v", got)
	}

	at, err := s.latestLiveEventAt()
	if err != nil || at != 2000 {
		t.Fatalf("latest at = %d, %v; want 2000", at, err)
	}

	if err := s.markAllLiveEventsRead(); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	got, err = s.getLiveEventHistory(10)
	if err != nil {
		t.Fatalf("history after read: %v", err)
	}
	for _, e := range got {
		if !e.Read {
			t.Fatalf("event %s still unread", e.ID)
		}
	}
}

func TestLiveEventsHistoryLimit(t *testing.T) {
	s := openTestStore(t)

	var events []StoredLiveEvent
	for i := 0; i < 5; i++ {
		events = append(events, StoredLiveEvent{
			Platform: "twitch",
			ID:       string(rune('a' + i)),
			Type:     "follow",
			At:       int64(1000 + i),
		})
	}
	if _, err := s.saveLiveEvents(events); err != nil {
		t.Fatalf("save: %v", err)
	}

	got, err := s.getLiveEventHistory(3)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 events, got %d", len(got))
	}
	// The newest three, in chronological order.
	if got[0].ID != "c" || got[2].ID != "e" {
		t.Fatalf("wrong window: %v .. %v", got[0].ID, got[2].ID)
	}

	empty, err := s.latestLiveEventAt()
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if empty != 1004 {
		t.Fatalf("latest = %d, want 1004", empty)
	}

	// Page older history: the newest 2 strictly before "c" (at=1002).
	older, err := s.getLiveEventsBefore(1002, 2)
	if err != nil {
		t.Fatalf("before: %v", err)
	}
	if len(older) != 2 || older[0].ID != "a" || older[1].ID != "b" {
		t.Fatalf("wrong page: %+v", older)
	}
	none, err := s.getLiveEventsBefore(1000, 2)
	if err != nil {
		t.Fatalf("before oldest: %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("want empty page, got %d", len(none))
	}
}

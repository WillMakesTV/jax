package main

import (
	"log"
	"time"
)

// ---------------------------------------------------------------------------
// Chat log persistence
//
// The frontend's ChatProvider saves every message it appends (Twitch IRC,
// YouTube poll, broadcasts) and seeds itself from the log on launch, so chat
// history renders instantly without replaying the platform APIs. Read state
// lives with the messages and survives restarts.
// ---------------------------------------------------------------------------

// StoredChatMessage is one persisted chat message.
type StoredChatMessage struct {
	Platform    string   `json:"platform"`
	ID          string   `json:"id"`
	Author      string   `json:"author"`
	AuthorID    string   `json:"authorId"`
	AuthorLogin string   `json:"authorLogin"`
	AvatarURL   string   `json:"avatarUrl"`
	Badges      []string `json:"badges"`
	Color       string   `json:"color"`
	Text        string   `json:"text"`
	At          int64    `json:"at"` // unix millis
	Read        bool     `json:"read"`
}

// SaveChatMessages appends new messages to the local chat log. Messages
// already stored (same platform+id) keep their original row and read state.
// Messages inside a stream session's window survive the rolling cap (see
// stream_session.go), so a past stream's chat stays available. Failures are
// logged here — the frontend treats persistence as best-effort.
func (a *App) SaveChatMessages(items []StoredChatMessage) error {
	if a.store == nil {
		return nil
	}
	if err := a.store.saveChatMessages(items, a.sessionChatWindows()); err != nil {
		log.Printf("jax: SaveChatMessages (%d items): %v", len(items), err)
		return err
	}
	return nil
}

// GetChatHistory returns the newest limit stored messages in chronological
// order. Never returns nil.
func (a *App) GetChatHistory(limit int) []StoredChatMessage {
	if a.store == nil {
		return []StoredChatMessage{}
	}
	if limit <= 0 {
		limit = 300
	}
	messages, err := a.store.getChatHistory(limit)
	if err != nil {
		log.Printf("jax: GetChatHistory: %v", err)
		return []StoredChatMessage{}
	}
	return messages
}

// GetSessionChatHistory returns the active stream session's stored chat — the
// newest limit messages in chronological order. The Broadcasting page's live
// feed seeds from this rather than GetChatHistory: the feed shows the
// broadcast on the air, and a finished stream's chat is reached through its
// past-stream page instead (GetChatForStream). Empty when no session is open.
// Never returns nil.
func (a *App) GetSessionChatHistory(limit int) []StoredChatMessage {
	if a.store == nil {
		return []StoredChatMessage{}
	}
	if limit <= 0 {
		limit = 300
	}
	session := a.GetActiveStreamSession()
	if !session.Active {
		return []StoredChatMessage{}
	}
	start, err := time.Parse(time.RFC3339, session.StartedAt)
	if err != nil {
		return []StoredChatMessage{}
	}
	margin := a.pastMatchMargin()
	lo := start.Add(-margin).UnixMilli()
	hi := time.Now().Add(margin).UnixMilli()
	out, err := a.store.getChatBetween(lo, hi)
	if err != nil {
		log.Printf("jax: GetSessionChatHistory: %v", err)
		return []StoredChatMessage{}
	}
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

// GetChatForStream returns stored chat messages that fall within a broadcast's
// window — [startedAt - margin, startedAt + duration + margin] — in
// chronological order. Session-protected messages are found no matter how old,
// so streams started from a plan keep their chat. Never returns nil.
func (a *App) GetChatForStream(startedAt string, durationSecs int) []StoredChatMessage {
	if a.store == nil {
		return []StoredChatMessage{}
	}
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return []StoredChatMessage{}
	}
	margin := a.pastMatchMargin()
	lo := start.Add(-margin).UnixMilli()
	hi := start.Add(time.Duration(durationSecs)*time.Second + margin).UnixMilli()
	out, err := a.store.getChatBetween(lo, hi)
	if err != nil {
		log.Printf("jax: GetChatForStream: %v", err)
		return []StoredChatMessage{}
	}
	return out
}

// MarkAllChatRead persists that every stored message has been seen.
func (a *App) MarkAllChatRead() error {
	if a.store == nil {
		return nil
	}
	return a.store.markAllChatRead()
}

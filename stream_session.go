package main

import (
	"log"
	"time"
)

// ---------------------------------------------------------------------------
// Stream sessions
//
// Going live with a planned stream creates a stream session: the durable
// record of that broadcast inside Jax. It carries the plan's identity (title,
// series, episode) and the live window, and it is what keeps the stream's
// unified chat and transcript attached once the broadcast becomes a past
// stream:
//
//   - Chat: the rolling chat log normally keeps only the newest messages;
//     messages inside a session's window are exempt from pruning, so
//     GetChatForStream still finds them long after the stream ended.
//   - Transcript: transcript sessions already persist keyed by the stream's
//     start time and attach to past streams by the same time-window matching.
//   - Series/episode: the plan's series and episode are registered as live
//     assignments (see past.go), which the finished VODs adopt automatically.
//
// A session opens in ApplyPlannedStream (the "Go Live with Planned Stream"
// action) and closes when the End Stream routine stops the broadcast. If the
// stream is stopped from OBS itself the session stays open until the next
// session begins; retention caps an open session at sessionMaxLength so a
// forgotten one cannot pin the whole log.
// ---------------------------------------------------------------------------

// sessionMaxLength bounds an open session's chat-retention window.
const sessionMaxLength = 12 * time.Hour

// beginPlannedSession opens the stream session for a plan the user is going
// live with and registers the plan's series/episode on the live broadcast.
// Best-effort: a failure only means the old time-window behaviour.
func (a *App) beginPlannedSession(plan PlannedStream) {
	if a.store == nil {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if err := a.store.beginStreamSession(
		plan.ID, plan.Title, plan.SeriesID, plan.EpisodeNumber, now,
	); err != nil {
		log.Printf("jax: begin stream session: %v", err)
	}

	// The plan's series/episode ride the live-assignment keys onto the
	// eventual past stream (adoptLiveAssignments matches by go-live time).
	key := liveMetaKey(now)
	if plan.SeriesID != "" {
		if err := a.SetPastStreamSeries([]string{key}, plan.SeriesID); err != nil {
			log.Printf("jax: assign live series: %v", err)
		}
	}
	if plan.EpisodeNumber > 0 {
		if err := a.SetStreamEpisode([]string{key}, plan.EpisodeNumber, plan.Description); err != nil {
			log.Printf("jax: assign live episode: %v", err)
		}
	}
}

// EndStreamSession closes any open stream session. The frontend calls this
// once the End Stream routine has stopped the broadcast. Stopping is also
// what kicks off the post-stream wrap-up pipeline (download → transcribe →
// outline → thumbnail → description → clip scripts; see poststream.go),
// anchored on the session that was open — or, for a stream without one, on
// the stop time.
func (a *App) EndStreamSession() {
	if a.store == nil {
		return
	}
	session := a.GetActiveStreamSession()
	now := time.Now().UTC().Format(time.RFC3339)
	if err := a.store.endOpenStreamSessions(now); err != nil {
		log.Printf("jax: end stream session: %v", err)
	}
	a.maybeStartPostStream(session)
}

// ActiveStreamSession is the stream session currently on the air (Active
// false when none is open).
type ActiveStreamSession struct {
	Active    bool   `json:"active"`
	PlanID    string `json:"planId"`
	Title     string `json:"title"`
	SeriesID  string `json:"seriesId"`
	Episode   int    `json:"episode"`
	StartedAt string `json:"startedAt"`
}

// GetActiveStreamSession returns the open stream session, if any. Sessions
// older than sessionMaxLength count as abandoned (e.g. the stream was stopped
// from OBS itself) and report inactive.
func (a *App) GetActiveStreamSession() ActiveStreamSession {
	var s ActiveStreamSession
	if a.store == nil {
		return s
	}
	err := a.store.db.QueryRow(
		`SELECT plan_id, title, series_id, episode, started_at
		 FROM stream_sessions WHERE ended_at = '' ORDER BY id DESC LIMIT 1`,
	).Scan(&s.PlanID, &s.Title, &s.SeriesID, &s.Episode, &s.StartedAt)
	if err != nil {
		return ActiveStreamSession{}
	}
	start, err := time.Parse(time.RFC3339, s.StartedAt)
	if err != nil || time.Since(start) > sessionMaxLength {
		return ActiveStreamSession{}
	}
	s.Active = true
	return s
}

// sessionChatWindows returns each session's chat-retention window in unix
// millis, padded by the stream-matching margin so the retained range covers
// what GetChatForStream will ask for. Open sessions are capped at
// sessionMaxLength.
func (a *App) sessionChatWindows() [][2]int64 {
	if a.store == nil {
		return nil
	}
	raw, err := a.store.streamSessionWindows()
	if err != nil {
		log.Printf("jax: session windows: %v", err)
		return nil
	}
	margin := a.pastMatchMargin()
	if margin < 15*time.Minute {
		margin = 15 * time.Minute
	}

	windows := make([][2]int64, 0, len(raw))
	for _, w := range raw {
		start, err := time.Parse(time.RFC3339, w[0])
		if err != nil {
			continue
		}
		end := start.Add(sessionMaxLength)
		if w[1] != "" {
			if t, err := time.Parse(time.RFC3339, w[1]); err == nil && t.Before(end) {
				end = t
			}
		} else if capped := start.Add(sessionMaxLength); time.Now().Before(capped) {
			// Still on the air: protect through "now" (next save extends it).
			end = time.Now()
		}
		windows = append(windows, [2]int64{
			start.Add(-margin).UnixMilli(),
			end.Add(margin).UnixMilli(),
		})
	}
	return windows
}

package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Concluding an episode
//
// Once a plan has gone live and its broadcast has stopped, the user concludes
// it: the plan's whole identity — title, description, channels, series,
// episode, tags — is snapshotted onto the stream through the same
// live-assignment mechanism series/episode already use (keyed by the
// session's go-live time until the VODs appear, then adopted onto broadcast
// keys; see past.go). The stream session is closed if still open, and the
// plan itself is removed from Planning. The chat, transcript, and events the
// app captured during the session stay attached to the past stream by its
// time window, so nothing else needs to move.
// ---------------------------------------------------------------------------

// StreamPlanInfo is the plan snapshot a concluded episode leaves on its past
// stream: the description and custom data the plan carried.
type StreamPlanInfo struct {
	PlanID        string   `json:"planId"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Channels      []string `json:"channels"`
	SeriesID      string   `json:"seriesId"`
	EpisodeNumber int      `json:"episodeNumber"`
	Tags          []string `json:"tags"`
	// ThumbnailFile is the plan's thumbnail (a file in the shared
	// plan-thumbs folder); the finished stream adopts it as its custom
	// thumbnail when it has none of its own (see adoptPlanThumbs).
	// ThumbnailURL is its served address, derived on read (see
	// fillPlanThumbURLs) and never persisted.
	ThumbnailFile string `json:"thumbnailFile"`
	ThumbnailURL  string `json:"thumbnailUrl"`
	ConcludedAt   string `json:"concludedAt"` // RFC3339
}

// keyStreamPlans stores the broadcastKey -> StreamPlanInfo assignments (live
// keys until adoption, like series/episode).
const keyStreamPlans = "past_stream_plans"

// streamPlans loads the saved broadcastKey -> plan-snapshot map. Never nil.
func (a *App) streamPlans() map[string]StreamPlanInfo {
	m := map[string]StreamPlanInfo{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamPlans, &m); err != nil {
			log.Printf("jax: load stream plans: %v", err)
		}
	}
	if m == nil {
		return map[string]StreamPlanInfo{}
	}
	return m
}

// PlanSessionInfo is a plan's most recent go-live window.
type PlanSessionInfo struct {
	PlanID    string `json:"planId"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"` // "" while the session is open
	// Matched marks an entry synthesized from a listed past stream that
	// matches the plan, rather than a recorded go-live session — the stream
	// went live outside the app (OBS, Stream Deck) or the session was lost.
	// Conclude works against the matched stream; there is no session to
	// reset.
	Matched bool `json:"matched"`
}

// GetPlanSessions returns each plan's most recent stream session — how the
// UI knows a plan has gone live (and can be concluded). Plans without a
// session are compared against the listed past streams: a stream matching
// the plan counts as its broadcast, so Conclude is offered for it too.
// Never returns nil.
func (a *App) GetPlanSessions() []PlanSessionInfo {
	out := []PlanSessionInfo{}
	if a.store == nil {
		return out
	}
	sessions, err := a.store.planSessions()
	if err != nil {
		log.Printf("jax: GetPlanSessions: %v", err)
		return out
	}
	for id, w := range sessions {
		out = append(out, PlanSessionInfo{PlanID: id, StartedAt: w[0], EndedAt: w[1]})
	}

	var streams []PastStream
	loaded := false
	for _, p := range a.GetPlannedStreams() {
		if _, ok := sessions[p.ID]; ok {
			continue
		}
		if !loaded {
			streams = a.GetPastStreams(false)
			loaded = true
		}
		if s := a.matchPlanPastStream(p, streams); s != nil {
			out = append(out, PlanSessionInfo{
				PlanID:    p.ID,
				StartedAt: s.StartedAt,
				EndedAt:   pastStreamEndTime(*s),
				Matched:   true,
			})
		}
	}
	return out
}

// matchPlanPastStream finds the listed past stream that carries a plan's
// broadcast, for plans without a stream session. A stream matches when it is
// not already claimed by a concluded plan, it started after the plan was
// created, and either its series+episode equal the plan's or one of its
// titles (live prefix stripped) equals the plan's title or its "Episode N |
// Title" broadcast form.
func (a *App) matchPlanPastStream(plan PlannedStream, streams []PastStream) *PastStream {
	norm := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	want := map[string]bool{}
	if t := norm(plan.Title); t != "" {
		want[t] = true
	}
	if t := norm(broadcastBaseTitle(plan)); t != "" {
		want[t] = true
	}
	created, createdOK := time.Time{}, false
	if t, err := time.Parse(time.RFC3339, plan.CreatedAt); err == nil {
		created, createdOK = t, true
	}

	for i := range streams {
		s := &streams[i]
		if s.Plan != nil {
			continue // already another concluded plan's stream
		}
		if createdOK {
			if st, err := time.Parse(time.RFC3339, s.StartedAt); err == nil && st.Before(created) {
				continue // aired before this plan existed
			}
		}
		if plan.SeriesID != "" && plan.EpisodeNumber > 0 &&
			s.SeriesID == plan.SeriesID && s.EpisodeNumber == plan.EpisodeNumber {
			return s
		}
		titles := []string{s.Title, s.CustomTitle}
		for _, b := range s.Broadcasts {
			titles = append(titles, a.stripLivePrefix(b.Title))
		}
		for _, t := range titles {
			if t != "" && want[norm(t)] {
				return s
			}
		}
	}
	return nil
}

// pastStreamEndTime estimates when a past stream went off the air (its last
// broadcast's start plus duration), falling back to its start time.
func pastStreamEndTime(s PastStream) string {
	var end time.Time
	for _, b := range s.Broadcasts {
		t, err := time.Parse(time.RFC3339, b.StartedAt)
		if err != nil {
			continue
		}
		if e := t.Add(time.Duration(b.DurationSecs) * time.Second); e.After(end) {
			end = e
		}
	}
	if end.IsZero() {
		return s.StartedAt
	}
	return end.UTC().Format(time.RFC3339)
}

// ResetPlannedStream forgets that a plan has been broadcast: its stream
// sessions are deleted (so Conclude stops being offered) and the live-keyed
// series/episode assignments those go-lives registered are cleared. The plan
// itself is untouched and can go live again later. Assignments a finished
// VOD has already adopted stay put — reassign those from the stream's
// details page if needed.
func (a *App) ResetPlannedStream(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	starts, err := a.store.deletePlanSessions(id)
	if err != nil {
		return err
	}
	if len(starts) == 0 {
		return nil // never went live; nothing to forget
	}

	plans := a.streamPlans()
	plansChanged := false
	for _, startedAt := range starts {
		key := liveMetaKey(startedAt)
		if err := a.SetPastStreamSeries([]string{key}, ""); err != nil {
			log.Printf("jax: reset plan series: %v", err)
		}
		if err := a.SetStreamEpisode([]string{key}, 0, ""); err != nil {
			log.Printf("jax: reset plan episode: %v", err)
		}
		if _, ok := plans[key]; ok {
			delete(plans, key)
			plansChanged = true
		}
	}
	if plansChanged {
		if err := a.store.setJSON(keyStreamPlans, plans); err != nil {
			return err
		}
	}
	return nil
}

// ConcludePlannedStream concludes an episode that has been broadcast: the
// plan's snapshot is attached to the stream (adopted by the past stream once
// its VODs are listed), any still-open session is closed, and the plan is
// removed from Planning. The plan must have gone live at least once.
func (a *App) ConcludePlannedStream(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	var plan *PlannedStream
	for _, p := range a.GetPlannedStreams() {
		if p.ID == id {
			p := p
			plan = &p
			break
		}
	}
	if plan == nil {
		return fmt.Errorf("that plan no longer exists")
	}
	startedAt, endedAt, ok, err := a.store.latestSessionForPlan(id)
	if err != nil {
		return err
	}
	if !ok {
		// No session — the stream went live outside the app (OBS, Stream
		// Deck) or the session was lost. The listed past stream matching the
		// plan is its broadcast; conclude straight onto it.
		if s := a.matchPlanPastStream(*plan, a.GetPastStreams(false)); s != nil {
			return a.concludePlanOntoStream(*plan, *s)
		}
		return fmt.Errorf("this plan has not been broadcast yet — no go-live session or matching past stream was found")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	// Stopping the stream from OBS itself leaves the session open; concluding
	// closes it so chat retention and the live page settle. Only one session
	// can be open at a time and the plan's latest is it.
	if endedAt == "" {
		if err := a.store.endOpenStreamSessions(now); err != nil {
			log.Printf("jax: conclude end session: %v", err)
		}
		// The End Stream routine never ran for this broadcast, so neither did
		// the wrap-up pipeline (download → transcribe → outline → thumbnail →
		// description → clip scripts); concluding is the signal to start it,
		// anchored on the session just closed.
		a.maybeStartPostStream(ActiveStreamSession{
			Active:    true,
			PlanID:    plan.ID,
			Title:     plan.Title,
			SeriesID:  plan.SeriesID,
			Episode:   plan.EpisodeNumber,
			StartedAt: startedAt,
		})
	}

	// Snapshot the plan onto the stream, keyed by its go-live time until the
	// finished VODs adopt it (see adoptLiveAssignments).
	key := liveMetaKey(startedAt)
	plans := a.streamPlans()
	if plan.Channels == nil {
		plan.Channels = []string{}
	}
	if plan.Tags == nil {
		plan.Tags = []string{}
	}
	plans[key] = StreamPlanInfo{
		PlanID:        plan.ID,
		Title:         plan.Title,
		Description:   plan.Description,
		Channels:      plan.Channels,
		SeriesID:      plan.SeriesID,
		EpisodeNumber: plan.EpisodeNumber,
		Tags:          plan.Tags,
		ThumbnailFile: sanitizeThumbFile(plan.ThumbnailFile),
		ConcludedAt:   now,
	}
	if err := a.store.setJSON(keyStreamPlans, plans); err != nil {
		return err
	}

	// Re-assert the series/episode assignments made at go-live (idempotent;
	// they share the same key), in case anything cleared them since.
	if plan.SeriesID != "" {
		if err := a.SetPastStreamSeries([]string{key}, plan.SeriesID); err != nil {
			log.Printf("jax: conclude assign series: %v", err)
		}
	}
	if plan.EpisodeNumber > 0 {
		if err := a.SetStreamEpisode([]string{key}, plan.EpisodeNumber, plan.Description); err != nil {
			log.Printf("jax: conclude assign episode: %v", err)
		}
	}

	// Concluding is the user saying "this plan IS this stream", so when the
	// finished stream is already listed the plan's series and episode are
	// written straight onto its broadcast keys too — overriding any stray
	// assignment, so the past stream and the planned broadcast stay one and
	// the same.
	matcher := a.liveKeyMatcher()
	for _, s := range a.GetPastStreams(false) {
		matched := false
		for _, b := range s.Broadcasts {
			if t, err := time.Parse(time.RFC3339, b.StartedAt); err == nil && matcher(key, t) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		keys := make([]string, 0, len(s.Broadcasts))
		for _, b := range s.Broadcasts {
			keys = append(keys, broadcastKey(b))
		}
		if plan.SeriesID != "" {
			if err := a.SetPastStreamSeries(keys, plan.SeriesID); err != nil {
				log.Printf("jax: conclude adopt series: %v", err)
			}
		}
		if plan.EpisodeNumber > 0 {
			if err := a.SetStreamEpisode(keys, plan.EpisodeNumber, plan.Description); err != nil {
				log.Printf("jax: conclude adopt episode: %v", err)
			}
		}
		break
	}

	// The episode is concluded: the plan leaves Planning (and the Broadcast
	// page's plan list with it).
	return a.DeletePlannedStream(id)
}

// concludePlanOntoStream concludes a plan directly against a listed past
// stream — the no-session path (see matchPlanPastStream). The plan's
// snapshot, series, and episode are written onto the stream's broadcast keys
// and the plan leaves Planning.
func (a *App) concludePlanOntoStream(plan PlannedStream, s PastStream) error {
	if plan.Channels == nil {
		plan.Channels = []string{}
	}
	if plan.Tags == nil {
		plan.Tags = []string{}
	}
	info := StreamPlanInfo{
		PlanID:        plan.ID,
		Title:         plan.Title,
		Description:   plan.Description,
		Channels:      plan.Channels,
		SeriesID:      plan.SeriesID,
		EpisodeNumber: plan.EpisodeNumber,
		Tags:          plan.Tags,
		ThumbnailFile: sanitizeThumbFile(plan.ThumbnailFile),
		ConcludedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	plans := a.streamPlans()
	keys := make([]string, 0, len(s.Broadcasts))
	for _, b := range s.Broadcasts {
		keys = append(keys, broadcastKey(b))
		plans[broadcastKey(b)] = info
	}
	if err := a.store.setJSON(keyStreamPlans, plans); err != nil {
		return err
	}
	if plan.SeriesID != "" {
		if err := a.SetPastStreamSeries(keys, plan.SeriesID); err != nil {
			log.Printf("jax: conclude assign series: %v", err)
		}
	}
	if plan.EpisodeNumber > 0 {
		if err := a.SetStreamEpisode(keys, plan.EpisodeNumber, plan.Description); err != nil {
			log.Printf("jax: conclude assign episode: %v", err)
		}
	}
	return a.DeletePlannedStream(plan.ID)
}

package main

import (
	"fmt"
	"log"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Post-stream processing
//
// Stopping a stream (the End Stream routine closing the session — see
// EndStreamSession) kicks off an automatic wrap-up pipeline, gated on the
// Settings → Streams "Download past streams" toggle:
//
//   1. Live   — every connected channel is polled until none still reports
//               the broadcast live, so the VODs the next stages fetch are
//               complete recordings rather than still-growing ones (a
//               platform can keep a stream on the air for a while after the
//               End Stream routine stops the encoder).
//   2. VODs   — the platforms' listings (Twitch, YouTube, Kick, Facebook) are
//               re-fetched until the finished stream appears; it waits a
//               settle period for every connected channel's copy so the
//               aggregated stream's identity (its startedAt key) is stable.
//   3. Download   — the stream's videos are fetched with the usual download
//                   sidecar (downloadPastStream), one download at a time.
//   4. Transcribe — the downloaded video is re-transcribed, replacing the
//                   live-captured transcript (TranscribeDownload).
//   5. Outline    — the stream's outline is generated from the transcript
//                   and chat (GenerateStreamOutline).
//   6. Thumbnail  — a custom thumbnail is generated from the outline and
//                   applied (GenerateStreamThumbnail + SetStreamThumbnail).
//   7. Description — a past-framed description is drafted from the outline
//                    and applied (GenerateStreamDescription).
//   8. Clip scripts — three short-form clip scripts are pitched from the
//                     fresh transcript and outline (GenerateClipIdeas),
//                     waiting on the stream's Clips tab.
//
// Steps that already happened are skipped (an existing download is reused,
// an existing outline/custom thumbnail/custom description is kept), so the
// pipeline is safe to re-run. One pipeline runs at a time and lives only in
// memory: an app restart abandons it (the download and transcription queues
// themselves survive, and the remaining steps stay available manually on the
// stream's page). Progress is reported via "poststream:update" events and
// GetPostStreamStatus, surfaced in the status bar.
// ---------------------------------------------------------------------------

// keyDownloadPastStreams is the Settings → Streams toggle that opts into
// downloading (and, with it, automatically processing) finished streams.
// Shared with the frontend's SETTING_KEYS.downloadPastStreams.
const keyDownloadPastStreams = "download_past_streams"

const (
	// livePollInterval is how often the connected channels are re-checked
	// while any of them still reports the broadcast live.
	livePollInterval = 30 * time.Second
	// liveWaitDeadline bounds the live wait; a channel still live past it is
	// warned about and the pipeline moves on (a 24/7 restream would
	// otherwise stall the wrap-up forever).
	liveWaitDeadline = 30 * time.Minute
	// vodPollInterval is how often the platforms are re-fetched while waiting
	// for the finished stream's VODs to be listed.
	vodPollInterval = time.Minute
	// vodSettleWait is how long after the stop the pipeline keeps waiting for
	// the remaining connected channels' VODs once at least one is listed —
	// starting before every copy exists would key the stream's outline and
	// thumbnail on a startedAt that shifts when the stragglers appear.
	vodSettleWait = 12 * time.Minute
	// vodWaitDeadline bounds the whole VOD wait; past it the pipeline gives
	// up (the platforms likely expired or never produced a VOD).
	vodWaitDeadline = 45 * time.Minute
	// downloadSlotDeadline bounds waiting for the single download slot.
	downloadSlotDeadline = 2 * time.Hour
	// transcribeDeadline bounds waiting for the transcription to finish; the
	// sidecar runs a long stream for hours, so this is generous.
	transcribeDeadline = 24 * time.Hour
)

// PostStreamStatus is the pipeline's state as shown in the status bar.
type PostStreamStatus struct {
	Active bool `json:"active"`
	// Stage: "live" | "vods" | "download" | "transcribe" | "outline" |
	// "thumbnail" | "description" | "clips" while active; "done" | "error" |
	// "cancelled" after; "" when the pipeline has never run.
	Stage  string `json:"stage"`
	Detail string `json:"detail"`
	// StartedAt keys the matched past stream ("" until it is identified), so
	// the status-bar chip can click through to the stream's page.
	StartedAt string   `json:"startedAt"`
	Title     string   `json:"title"`
	Warnings  []string `json:"warnings"`
}

// GetPostStreamStatus returns the pipeline's current state, for the status
// bar's initial render.
func (a *App) GetPostStreamStatus() PostStreamStatus {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.postStream
}

// CancelPostStream stops the running pipeline between stages. A stage already
// in flight (a download, a transcription, an AI call) finishes or keeps
// running on its own queue; nothing after it starts.
func (a *App) CancelPostStream() {
	a.mu.Lock()
	cancel := a.postStreamCancel
	a.postStreamCancel = nil
	a.mu.Unlock()
	if cancel != nil {
		close(cancel)
	}
}

// postStreamUpdate mutates the pipeline status and pushes it to the frontend.
func (a *App) postStreamUpdate(mut func(*PostStreamStatus)) {
	a.mu.Lock()
	mut(&a.postStream)
	st := a.postStream
	a.mu.Unlock()
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "poststream:update", st)
	}
}

// maybeStartPostStream launches the pipeline for the broadcast that just
// stopped, when the download toggle is on and no pipeline is already running.
// session is the stream session that was open at stop time (Active false when
// the stream was not started from a plan).
func (a *App) maybeStartPostStream(session ActiveStreamSession) {
	if a.store == nil {
		return
	}
	if v, err := a.store.getSetting(keyDownloadPastStreams); err != nil || v != "true" {
		return
	}

	a.mu.Lock()
	if a.postStreamCancel != nil {
		a.mu.Unlock()
		log.Printf("jax: post-stream pipeline already running; not starting another")
		return
	}
	cancel := make(chan struct{})
	a.postStreamCancel = cancel
	a.postStream = PostStreamStatus{
		Active:   true,
		Stage:    "live",
		Detail:   "Waiting for every channel to finish streaming…",
		Title:    session.Title,
		Warnings: []string{},
	}
	a.mu.Unlock()
	a.postStreamUpdate(func(*PostStreamStatus) {})

	go a.runPostStream(session, time.Now(), cancel)
}

// postStreamWait sleeps for d, returning false when the pipeline was
// cancelled instead.
func postStreamWait(d time.Duration, cancel <-chan struct{}) bool {
	select {
	case <-time.After(d):
		return true
	case <-cancel:
		return false
	}
}

// runPostStream is the pipeline body. Every stage transition re-checks the
// cancel channel; failures inside optional stages (transcription, thumbnail,
// description) demote to warnings so the rest still lands.
func (a *App) runPostStream(session ActiveStreamSession, stoppedAt time.Time, cancel chan struct{}) {
	// end clears the cancel handle (when still ours) and records the final
	// status.
	end := func(stage, detail string) {
		a.mu.Lock()
		if a.postStreamCancel == cancel {
			a.postStreamCancel = nil
		}
		a.mu.Unlock()
		a.postStreamUpdate(func(st *PostStreamStatus) {
			st.Active = false
			st.Stage = stage
			st.Detail = detail
		})
	}
	cancelled := func() bool {
		select {
		case <-cancel:
			end("cancelled", "Post-stream processing was cancelled.")
			return true
		default:
			return false
		}
	}
	warn := func(w string) {
		log.Printf("jax: post-stream: %s", w)
		a.postStreamUpdate(func(st *PostStreamStatus) {
			st.Warnings = append(st.Warnings, w)
		})
	}

	// -- Stage 1: wait until every connected channel is off the air ---------
	// The encoder stopping does not end the broadcast everywhere at once —
	// platforms finalize on their own clocks — and a VOD downloaded while
	// its channel still streams would be an incomplete recording.
	liveDeadline := stoppedAt.Add(liveWaitDeadline)
	for a.anyChannelStillLive() {
		if cancelled() {
			return
		}
		if time.Now().After(liveDeadline) {
			warn("A channel still reported the stream live past the wait — continuing; its VOD may be incomplete.")
			break
		}
		if !postStreamWait(livePollInterval, cancel) {
			end("cancelled", "Post-stream processing was cancelled.")
			return
		}
	}
	if cancelled() {
		return
	}
	a.postStreamUpdate(func(st *PostStreamStatus) {
		st.Stage = "vods"
		st.Detail = "Waiting for the stream's VODs to appear…"
	})

	// -- Stage 2: refresh the channels until the finished stream is listed --
	// The VOD deadline starts now rather than at the stop, so a long live
	// wait does not eat into it.
	var stream PastStream
	deadline := time.Now().Add(vodWaitDeadline)
	for {
		if cancelled() {
			return
		}
		if s := a.matchEndedStream(a.GetPastStreams(true), session, stoppedAt); s != nil {
			stream = *s
			if a.streamHasAllChannelVODs(stream) || time.Now().After(stoppedAt.Add(vodSettleWait)) {
				break
			}
			a.postStreamUpdate(func(st *PostStreamStatus) {
				st.StartedAt = stream.StartedAt
				st.Title = firstNonEmpty(stream.Title, st.Title)
				st.Detail = "Stream found — waiting for the remaining channels' VODs…"
			})
		}
		if time.Now().After(deadline) {
			end("error", "The finished stream's VODs never appeared on the connected channels — download it manually from its page once they do.")
			return
		}
		if !postStreamWait(vodPollInterval, cancel) {
			end("cancelled", "Post-stream processing was cancelled.")
			return
		}
	}
	title := firstNonEmpty(stream.Title, session.Title, "stream")
	a.postStreamUpdate(func(st *PostStreamStatus) {
		st.StartedAt = stream.StartedAt
		st.Title = title
		st.Stage = "download"
		st.Detail = "Downloading the stream's video…"
	})

	// -- Stage 3: download the videos (reusing an existing download) --------
	subfolder := a.subfolderForStream(stream)
	if subfolder == "" {
		// One download at a time: wait for the slot before claiming it.
		slotDeadline := time.Now().Add(downloadSlotDeadline)
		for {
			if cancelled() {
				return
			}
			a.mu.Lock()
			busy := a.downloadCmd != nil || a.movingDownloads
			a.mu.Unlock()
			if !busy {
				break
			}
			if time.Now().After(slotDeadline) {
				end("error", "Another download kept the slot busy — download the stream manually from its page.")
				return
			}
			if !postStreamWait(30*time.Second, cancel) {
				end("cancelled", "Post-stream processing was cancelled.")
				return
			}
		}

		waiter := make(chan string, 1)
		a.mu.Lock()
		a.downloadWaiter = waiter
		a.mu.Unlock()
		res, err := a.downloadPastStream(stream.StartedAt, "", false)
		if err != nil {
			a.mu.Lock()
			if a.downloadWaiter == waiter {
				a.downloadWaiter = nil
			}
			a.mu.Unlock()
			end("error", fmt.Sprintf("The download could not be started: %v", err))
			return
		}
		subfolder, _ = res["subfolder"].(string)

		select {
		case detail := <-waiter:
			if detail != "" {
				end("error", fmt.Sprintf("The download failed: %s", detail))
				return
			}
		case <-cancel:
			a.mu.Lock()
			if a.downloadWaiter == waiter {
				a.downloadWaiter = nil
			}
			a.mu.Unlock()
			end("cancelled", "Post-stream processing was cancelled — the download keeps running on its own.")
			return
		}
	}

	// -- Stage 4: re-transcribe the transcript from the downloaded video ----
	if cancelled() {
		return
	}
	a.postStreamUpdate(func(st *PostStreamStatus) {
		st.Stage = "transcribe"
		st.Detail = "Transcribing the downloaded video…"
	})
	waiter := make(chan string, 1)
	a.mu.Lock()
	if a.vodWaiters == nil {
		a.vodWaiters = map[string]chan string{}
	}
	a.vodWaiters[subfolder] = waiter
	a.mu.Unlock()
	wait := true
	if err := a.TranscribeDownload(subfolder); err != nil {
		// Already queued means a run is in flight — wait for it like our own.
		if !strings.Contains(err.Error(), "already queued") {
			a.mu.Lock()
			delete(a.vodWaiters, subfolder)
			a.mu.Unlock()
			warn(fmt.Sprintf("The video could not be transcribed (%v) — the outline uses whatever transcript exists.", err))
			wait = false
		}
	}
	if wait {
		select {
		case detail := <-waiter:
			if detail != "" {
				warn(fmt.Sprintf("Transcription: %s", detail))
			}
		case <-time.After(transcribeDeadline):
			warn("Transcription did not finish in time — the outline uses whatever transcript exists.")
		case <-cancel:
			a.mu.Lock()
			if a.vodWaiters[subfolder] == waiter {
				delete(a.vodWaiters, subfolder)
			}
			a.mu.Unlock()
			end("cancelled", "Post-stream processing was cancelled — the transcription keeps running on its own.")
			return
		}
	}

	// -- Stages 5-7 need the AI service ------------------------------------
	if cancelled() {
		return
	}
	if _, _, err := a.aiConn(); err != nil {
		end("done", "Downloaded and transcribed. Connect an AI service (Settings → AI) to also generate the outline, thumbnail, and description.")
		return
	}

	// Re-read the aggregated stream: VODs that appeared during the download
	// may have shifted its identity, and the adopted series/episode ride in.
	if s := a.matchEndedStream(a.GetPastStreams(true), session, stoppedAt); s != nil {
		stream = *s
		title = firstNonEmpty(stream.Title, title)
		a.postStreamUpdate(func(st *PostStreamStatus) {
			st.StartedAt = stream.StartedAt
			st.Title = title
		})
	}

	// -- Stage 5: outline ----------------------------------------------------
	if existing, err := a.GetStreamOutline(stream.StartedAt); err != nil || existing.GeneratedAt == "" {
		a.postStreamUpdate(func(st *PostStreamStatus) {
			st.Stage = "outline"
			st.Detail = "Building the stream's outline…"
		})
		if _, err := a.GenerateStreamOutline(stream.StartedAt, a.streamChatWindowSecs(stream)); err != nil {
			// The thumbnail and description are both briefed from the
			// outline, so nothing further can happen without it.
			end("error", fmt.Sprintf("The outline could not be generated: %v — the thumbnail and description need it, generate them from the stream's page.", err))
			return
		}
	}

	// -- Stage 6: thumbnail --------------------------------------------------
	if cancelled() {
		return
	}
	if stream.CustomThumb == nil || stream.CustomThumb.File == "" {
		a.postStreamUpdate(func(st *PostStreamStatus) {
			st.Stage = "thumbnail"
			st.Detail = "Generating the stream's thumbnail…"
		})
		if thumb, err := a.GenerateStreamThumbnail(stream.StartedAt, title, "", ""); err != nil {
			warn(fmt.Sprintf("The thumbnail could not be generated: %v", err))
		} else if _, err := a.SetStreamThumbnail(stream.StartedAt, thumb.File); err != nil {
			warn(fmt.Sprintf("The generated thumbnail could not be saved: %v", err))
		}
	}

	// -- Stage 7: description -------------------------------------------------
	if cancelled() {
		return
	}
	if strings.TrimSpace(a.streamDescriptions()[stream.StartedAt]) == "" {
		a.postStreamUpdate(func(st *PostStreamStatus) {
			st.Stage = "description"
			st.Detail = "Drafting the stream's description…"
		})
		if desc, err := a.GenerateStreamDescription(
			stream.StartedAt, title, stream.SeriesID, stream.EpisodeNumber,
		); err != nil {
			warn(fmt.Sprintf("The description could not be generated: %v", err))
		} else if err := a.SetStreamDescription(stream.StartedAt, desc); err != nil {
			warn(fmt.Sprintf("The generated description could not be saved: %v", err))
		}
	}

	// -- Stage 8: clip scripts -----------------------------------------------
	if cancelled() {
		return
	}
	if set, err := a.GetClipIdeas(stream.StartedAt, "short"); err != nil || set.GeneratedAt == "" {
		a.postStreamUpdate(func(st *PostStreamStatus) {
			st.Stage = "clips"
			st.Detail = "Pitching three clip scripts from the broadcast…"
		})
		if _, err := a.GenerateClipIdeas(stream.StartedAt, title, "short"); err != nil {
			warn(fmt.Sprintf("The clip scripts could not be generated: %v — generate them from the stream's Clips tab.", err))
		}
	}

	a.mu.Lock()
	warnings := len(a.postStream.Warnings)
	a.mu.Unlock()
	if warnings > 0 {
		end("done", fmt.Sprintf("“%s” processed with %d issue%s — see the stream's page.", title, warnings, plural(warnings)))
		return
	}
	end("done", fmt.Sprintf("“%s” is processed: downloaded, transcribed, outlined, with a thumbnail, description, and clip scripts.", title))
}

// matchEndedStream finds the aggregated past stream for the broadcast that
// just stopped. With a stream session the match is by go-live time (any
// broadcast within the aggregation margin of the session's start); without
// one it is the stream whose broadcast ended around the stop time.
func (a *App) matchEndedStream(streams []PastStream, session ActiveStreamSession, stoppedAt time.Time) *PastStream {
	margin := a.pastMatchMargin()
	if session.Active {
		target, err := time.Parse(time.RFC3339, session.StartedAt)
		if err != nil {
			return nil
		}
		for i := range streams {
			for _, b := range streams[i].Broadcasts {
				t, err := time.Parse(time.RFC3339, b.StartedAt)
				if err == nil && b.URL != "" && absDuration(t.Sub(target)) <= margin {
					return &streams[i]
				}
			}
		}
		return nil
	}
	for i := range streams {
		for _, b := range streams[i].Broadcasts {
			if b.URL == "" || b.DurationSecs <= 0 {
				continue
			}
			t, err := time.Parse(time.RFC3339, b.StartedAt)
			if err != nil {
				continue
			}
			ended := t.Add(time.Duration(b.DurationSecs) * time.Second)
			if absDuration(stoppedAt.Sub(ended)) <= 30*time.Minute {
				return &streams[i]
			}
		}
	}
	return nil
}

// streamHasAllChannelVODs reports whether every connected VOD-capable channel
// has its copy of the stream listed — the signal that the aggregated stream's
// identity has settled.
func (a *App) streamHasAllChannelVODs(stream PastStream) bool {
	for _, platform := range []string{"twitch", "youtube", "kick", "facebook"} {
		a.mu.Lock()
		connected := a.statuses[platform].Connected
		a.mu.Unlock()
		if !connected {
			continue
		}
		found := false
		for _, b := range stream.Broadcasts {
			if b.Platform == platform && b.URL != "" && !b.Local {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// anyChannelStillLive reports whether any connected channel still shows the
// broadcast on the air. With nothing connected it is false, so local-only
// setups skip the live wait entirely.
func (a *App) anyChannelStillLive() bool {
	for _, ls := range a.GetLiveStreams() {
		if ls.Live {
			return true
		}
	}
	return false
}

// subfolderForStream finds an existing download of the stream (any broadcast
// URL match), returning its subfolder, or "" when none exists.
func (a *App) subfolderForStream(stream PastStream) string {
	for _, d := range a.GetDownloads() {
		for _, u := range d.URLs {
			for _, b := range stream.Broadcasts {
				if u != "" && u == b.URL {
					return d.Subfolder
				}
			}
		}
	}
	return ""
}

// streamChatWindowSecs mirrors the Stream page's chat window: the stream's
// start through the last broadcast's end, floored at the summed per-segment
// runtime, so multi-sitting streams cover the gaps between segments too.
func (a *App) streamChatWindowSecs(stream PastStream) int {
	total := 0
	for _, cluster := range clusterPastBroadcasts(stream.Broadcasts, a.pastMatchMargin()) {
		for _, b := range cluster {
			if b.DurationSecs > 0 {
				total += b.DurationSecs
				break
			}
		}
	}
	max := total
	if start, err := time.Parse(time.RFC3339, stream.StartedAt); err == nil {
		for _, b := range stream.Broadcasts {
			t, terr := time.Parse(time.RFC3339, b.StartedAt)
			if terr != nil {
				continue
			}
			end := int(t.Sub(start).Seconds()) + b.DurationSecs
			if end > max {
				max = end
			}
		}
	}
	return max
}

// notifyDownloadExit hands the finished download's exit detail ("" = success)
// to the pipeline, when one is waiting.
func (a *App) notifyDownloadExit(detail string) {
	a.mu.Lock()
	ch := a.downloadWaiter
	a.downloadWaiter = nil
	a.mu.Unlock()
	if ch != nil {
		select {
		case ch <- detail:
		default:
		}
	}
}

// notifyVodExit hands a finished transcription's exit detail ("" = success)
// to the pipeline, when one is waiting on that subfolder.
func (a *App) notifyVodExit(subfolder, detail string) {
	a.mu.Lock()
	ch := a.vodWaiters[subfolder]
	delete(a.vodWaiters, subfolder)
	a.mu.Unlock()
	if ch != nil {
		select {
		case ch <- detail:
		default:
		}
	}
}

// plural returns "s" for counts other than one.
func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

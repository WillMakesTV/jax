package main

import (
	"bp-temp/internal/platform"
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Transcribing downloaded videos
//
// A one-shot Python sidecar (transcriber/transcribe_video.py, embedded and
// written to ~/.jax) runs the same VAD -> faster-whisper pipeline as the live
// transcriber over a downloaded broadcast's audio track. Utterances arrive as
// video-relative timestamps; anchored to the broadcast's start time they
// become the stream's stored transcript, replacing whatever was captured
// live (re-producing from the VOD is strictly more complete — it hears the
// full programme audio, not just the mic).
//
// Why not ffmpeg's built-in whisper filter? It was tried (2026-07): the
// whisper.cpp inside the gyan ffmpeg 8.x build runs ~0.2-0.4x realtime on CPU
// with no threading or GPU options exposed, versus faster-whisper's int8
// pipeline at several times realtime. The sidecar stays until that changes.
//
// The sidecar runs as its own process at below-normal CPU priority
// (backgroundProcess), so the live mic transcriber and the rest of the app
// always outrank it — live transcription keeps working while videos process.
//
// Requests queue: up to transcribeConcurrency() sidecars run at once
// (Settings -> Streams) and the rest wait their turn. Progress lines are
// forwarded as "vodtranscribe:line" (subfolder, line) events, a run's end as
// "vodtranscribe:exit" (subfolder, detail; empty detail = success), and every
// queue change as "vodtranscribe:queue" (the jobs list).
//
// The queue survives restarts: jobs and their media checkpoints persist in
// the store (transcribe_jobs), and utterances are staged to the database as
// they arrive (transcribe_staged_lines). At startup restoreTranscribeQueue
// re-queues whatever was pending and each job resumes from its checkpoint via
// the sidecar's --start flag; only a completed run folds the staged lines
// into the stream's transcript.
// ---------------------------------------------------------------------------

//go:embed transcriber/transcribe_video.py
var transcribeVideoScript []byte

// keyTranscribeConcurrency is the settings key holding how many videos may be
// transcribed simultaneously. Managed from Settings -> Streams.
const keyTranscribeConcurrency = "transcribe_concurrency"

// Whisper is CPU-heavy; two concurrent runs is the most that stays usable.
const maxTranscribeConcurrency = 2

// transcribeConcurrency returns the configured simultaneous-transcription
// limit, defaulting to the maximum of 2.
func (a *App) transcribeConcurrency() int {
	if a.store == nil {
		return maxTranscribeConcurrency
	}
	v, err := a.store.getSetting(keyTranscribeConcurrency)
	if err != nil {
		return maxTranscribeConcurrency
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 1 {
		return maxTranscribeConcurrency
	}
	if n > maxTranscribeConcurrency {
		n = maxTranscribeConcurrency
	}
	return n
}

// TranscribeJob is one queue entry, as shown in the UI.
type TranscribeJob struct {
	Subfolder string `json:"subfolder"`
	State     string `json:"state"` // "queued" | "running"
}

// vodJob is the backend queue record. starting marks a job claimed by the
// pump but not yet spawned; cmd is set once the sidecar is running.
type vodJob struct {
	sub      string
	starting bool
	cmd      *exec.Cmd
}

// transcribeJobsLocked snapshots the queue for the frontend. Caller holds mu.
func (a *App) transcribeJobsLocked() []TranscribeJob {
	jobs := make([]TranscribeJob, 0, len(a.vodJobs))
	for _, j := range a.vodJobs {
		state := "queued"
		if j.starting || j.cmd != nil {
			state = "running"
		}
		jobs = append(jobs, TranscribeJob{Subfolder: j.sub, State: state})
	}
	return jobs
}

// GetTranscribeJobs returns the transcription queue, running jobs included,
// so pages can restore their progress UI after a navigation.
func (a *App) GetTranscribeJobs() []TranscribeJob {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.transcribeJobsLocked()
}

// emitTranscribeQueue pushes the current queue to the frontend.
func (a *App) emitTranscribeQueue() {
	a.mu.Lock()
	jobs := a.transcribeJobsLocked()
	a.mu.Unlock()
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "vodtranscribe:queue", jobs)
	}
}

// emitVodLine forwards one progress line to the frontend.
func (a *App) emitVodLine(sub, line string) {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "vodtranscribe:line", sub, line)
	}
}

// TranscribeDownload queues a transcript run for a downloaded broadcast's
// video file (identified by its download subfolder), starting it immediately
// when a slot is free. On success the stream's stored transcript — including
// one captured live — is replaced with the lines heard in the video, anchored
// to the broadcast's start time.
func (a *App) TranscribeDownload(subfolder string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	dl, err := a.findDownload(subfolder)
	if err != nil {
		return err
	}
	if _, err := time.Parse(time.RFC3339, dl.StartedAt); err != nil {
		return fmt.Errorf("the download has no valid start time to anchor the transcript to")
	}

	a.mu.Lock()
	if a.movingDownloads {
		a.mu.Unlock()
		return fmt.Errorf("the download folder is being moved — try again once it finishes")
	}
	for _, j := range a.vodJobs {
		if j.sub == subfolder {
			a.mu.Unlock()
			return fmt.Errorf("that video is already queued for transcription")
		}
	}
	a.vodJobs = append(a.vodJobs, &vodJob{sub: subfolder})
	a.mu.Unlock()

	// Persist the queue entry so an app restart picks the job back up.
	if err := a.store.upsertTranscribeJob(
		subfolder, time.Now().UTC().Format(time.RFC3339Nano),
	); err != nil {
		log.Printf("jax: persist transcribe job: %v", err)
	}

	a.emitTranscribeQueue()
	a.pumpTranscribeQueue()
	return nil
}

// CancelTranscribeDownload removes a job from the queue, killing its sidecar
// if it is already running. The stream's stored transcript is left untouched;
// a freed slot starts the next queued job.
func (a *App) CancelTranscribeDownload(subfolder string) {
	a.mu.Lock()
	var cmd *exec.Cmd
	for i, j := range a.vodJobs {
		if j.sub == subfolder {
			cmd = j.cmd
			a.vodJobs = append(a.vodJobs[:i], a.vodJobs[i+1:]...)
			break
		}
	}
	a.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if a.store != nil {
		if err := a.store.deleteTranscribeJob(subfolder); err != nil {
			log.Printf("jax: drop transcribe job: %v", err)
		}
	}
	a.notifyVodExit(subfolder, "The transcription was cancelled.")
	a.emitTranscribeQueue()
	a.pumpTranscribeQueue()
}

// killVodJobs ends every queued and running transcription; used at shutdown.
// The persisted queue rows stay put so the next launch resumes the work from
// each job's checkpoint.
func (a *App) killVodJobs() {
	a.mu.Lock()
	jobs := a.vodJobs
	a.vodJobs = nil
	a.mu.Unlock()
	for _, j := range jobs {
		if j.cmd != nil && j.cmd.Process != nil {
			_ = j.cmd.Process.Kill()
		}
	}
}

// restoreTranscribeQueue re-queues the jobs persisted by a previous session,
// dropping any whose download has since disappeared. Called at startup.
func (a *App) restoreTranscribeQueue() {
	if a.store == nil {
		return
	}
	subs, err := a.store.getTranscribeJobSubfolders()
	if err != nil {
		log.Printf("jax: restore transcribe queue: %v", err)
		return
	}
	restored := false
	for _, sub := range subs {
		if _, err := a.findDownload(sub); err != nil {
			_ = a.store.deleteTranscribeJob(sub)
			continue
		}
		a.mu.Lock()
		dup := false
		for _, j := range a.vodJobs {
			if j.sub == sub {
				dup = true
				break
			}
		}
		if !dup {
			a.vodJobs = append(a.vodJobs, &vodJob{sub: sub})
			restored = true
		}
		a.mu.Unlock()
	}
	if restored {
		a.emitTranscribeQueue()
		a.pumpTranscribeQueue()
	}
}

// findDownload resolves a download subfolder to its manifest record.
func (a *App) findDownload(subfolder string) (DownloadedVideo, error) {
	for _, d := range a.GetDownloads() {
		if d.Subfolder == subfolder {
			return d, nil
		}
	}
	return DownloadedVideo{}, fmt.Errorf("that download no longer exists")
}

// pumpTranscribeQueue starts queued jobs while slots are free. Safe to call
// from anywhere; failures to start surface as that job's exit event.
func (a *App) pumpTranscribeQueue() {
	for {
		limit := a.transcribeConcurrency()

		a.mu.Lock()
		running := 0
		var next *vodJob
		for _, j := range a.vodJobs {
			if j.starting || j.cmd != nil {
				running++
			} else if next == nil {
				next = j
			}
		}
		if next == nil || running >= limit {
			a.mu.Unlock()
			return
		}
		next.starting = true // claim it so a concurrent pump skips it
		a.mu.Unlock()

		if err := a.startVodJob(next); err != nil {
			a.mu.Lock()
			for i, j := range a.vodJobs {
				if j == next {
					a.vodJobs = append(a.vodJobs[:i], a.vodJobs[i+1:]...)
					break
				}
			}
			a.mu.Unlock()
			// The failure was reported; don't let the persisted row retry
			// (and re-fail) the job on every launch.
			if a.store != nil {
				_ = a.store.deleteTranscribeJob(next.sub)
			}
			if a.ctx != nil {
				wruntime.EventsEmit(a.ctx, "vodtranscribe:exit", next.sub, err.Error())
			}
			a.notifyVodExit(next.sub, err.Error())
		}
		a.emitTranscribeQueue()
	}
}

// startVodJob spawns the sidecar for one claimed queue entry.
func (a *App) startVodJob(job *vodJob) error {
	dl, err := a.findDownload(job.sub)
	if err != nil {
		return err
	}
	startBase, err := time.Parse(time.RFC3339, dl.StartedAt)
	if err != nil {
		return fmt.Errorf("the download has no valid start time to anchor the transcript to")
	}
	video := filepath.Join(a.resolveDownloadDir(), dl.Subfolder, dl.VideoFile)
	if !fileExists(video) {
		return fmt.Errorf("the downloaded video file is missing")
	}

	// Resume from the persisted checkpoint (0 for a fresh job). Staged lines
	// at or past it are about to be replayed, so drop them first — a crash
	// between staging a line and advancing the checkpoint must not duplicate.
	resume, err := a.store.getTranscribeJobPos(job.sub)
	if err != nil {
		log.Printf("jax: transcribe checkpoint: %v", err)
		resume = 0
	}
	if resume > 0 {
		if err := a.store.deleteTranscribeStagedFrom(
			job.sub, startBase.UnixMilli()+int64(resume*1000),
		); err != nil {
			return fmt.Errorf("could not trim the staged transcript: %w", err)
		}
	}

	dir, err := dataDir()
	if err != nil {
		return fmt.Errorf("no data directory: %w", err)
	}
	script := filepath.Join(dir, "transcribe_video.py")
	if err := os.WriteFile(script, transcribeVideoScript, 0o600); err != nil {
		return fmt.Errorf("could not write the transcriber script: %w", err)
	}

	python, pyArgs, err := findPython()
	if err != nil {
		return err
	}
	args := append(pyArgs, script, "--input", video, "--model", "small")
	if dl.DurationSecs > 0 {
		args = append(args, "--duration", strconv.Itoa(dl.DurationSecs))
	}
	if resume > 0 {
		args = append(args, "--start", strconv.FormatFloat(resume, 'f', 2, 64))
	}
	cmd := exec.Command(python, args...)
	platform.BackgroundProcess(cmd) // below-normal priority: never starve live capture

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start the transcriber: %w", err)
	}

	// Attach the process — unless the job was cancelled while starting, in
	// which case the fresh process is orphaned and must die here.
	a.mu.Lock()
	present := false
	for _, j := range a.vodJobs {
		if j == job {
			present = true
			break
		}
	}
	if !present {
		a.mu.Unlock()
		_ = cmd.Process.Kill()
		return nil
	}
	job.cmd = cmd
	job.starting = false
	a.mu.Unlock()

	// The resume checkpoint advances monotonically: to each utterance's end,
	// and between speech to the heartbeats' resume-safe position (throttled).
	var ckMu sync.Mutex
	checkpoint := resume
	advance := func(pos float64, force bool) {
		ckMu.Lock()
		defer ckMu.Unlock()
		if pos <= checkpoint || (!force && pos < checkpoint+5) {
			return
		}
		checkpoint = pos
		_ = a.store.setTranscribeJobPos(job.sub, pos)
	}

	// stdout: forward each JSON progress line to the frontend; stage each
	// utterance to the store (converting video-relative seconds to wall-clock
	// millis). The last reported error is kept for the exit event — fatal
	// sidecar errors arrive on stdout, not stderr.
	type stdoutResult struct {
		lastErr string
	}
	linesCh := make(chan stdoutResult, 1)
	go func() {
		var result stdoutResult
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			a.emitVodLine(job.sub, line)

			var seg struct {
				Text  string  `json:"text"`
				Start float64 `json:"start"`
				End   float64 `json:"end"`
				Safe  float64 `json:"safe"`
				Error string  `json:"error"`
			}
			if err := json.Unmarshal([]byte(line), &seg); err != nil {
				continue
			}
			switch {
			case seg.Error != "":
				result.lastErr = seg.Error
			case seg.Text != "":
				rec := TranscriptLineRec{
					At:    startBase.UnixMilli() + int64(seg.Start*1000),
					EndAt: startBase.UnixMilli() + int64(seg.End*1000),
					Text:  seg.Text,
				}
				if err := a.store.addTranscribeStagedLine(job.sub, rec); err != nil {
					log.Printf("jax: stage transcript line: %v", err)
				}
				advance(seg.End, true)
			case seg.Safe > 0:
				advance(seg.Safe, false)
			}
		}
		linesCh <- result
	}()

	errTail := make(chan string, 1)
	go func() {
		raw, _ := io.ReadAll(stderr)
		tail := strings.TrimSpace(string(raw))
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		errTail <- tail
	}()

	go func() {
		waitErr := cmd.Wait()
		result := <-linesCh
		tail := <-errTail

		// Still in the queue means it ran to completion; a cancelled (or
		// shut-down) job was already removed and gets no exit report.
		a.mu.Lock()
		current := false
		for i, j := range a.vodJobs {
			if j == job {
				current = true
				a.vodJobs = append(a.vodJobs[:i], a.vodJobs[i+1:]...)
				break
			}
		}
		a.mu.Unlock()

		if current {
			detail := ""
			if waitErr != nil {
				detail = firstNonEmpty(result.lastErr, tail, waitErr.Error())
			} else {
				staged, err := a.store.getTranscribeStagedLines(job.sub)
				switch {
				case err != nil:
					detail = fmt.Sprintf("Could not read the staged transcript: %v", err)
				case len(staged) == 0:
					detail = "No speech was found in the video's audio; the existing transcript was kept."
				default:
					if err := a.replaceTranscriptForStream(dl.StartedAt, dl.Title, staged); err != nil {
						detail = fmt.Sprintf("Could not save the transcript: %v", err)
					}
				}
			}
			// The run is over either way — completed, empty, or failed — so
			// the persisted job must not come back on the next launch.
			if err := a.store.deleteTranscribeJob(job.sub); err != nil {
				log.Printf("jax: drop transcribe job: %v", err)
			}
			if a.ctx != nil {
				wruntime.EventsEmit(a.ctx, "vodtranscribe:exit", job.sub, detail)
				a.emitTranscribeQueue()
			}
			// The post-stream pipeline may be waiting on this transcription.
			a.notifyVodExit(job.sub, detail)
		}
		a.pumpTranscribeQueue()
	}()

	return nil
}

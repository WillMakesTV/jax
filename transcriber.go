package main

import (
	"bp-temp/internal/platform"
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Local transcription (Transcript tab)
//
// A resident Python sidecar (transcriber/transcribe_mic.py, embedded and
// written to ~/.jax) holds the faster-whisper model warm; ffmpeg capture is
// toggled per stream over a stdin command channel, so starting to transcribe
// is near-instant instead of paying the model load every time. The pipeline
// (ffmpeg -> VAD -> faster-whisper) is ported from the twitch-chatter-bot
// project and fully offline.
//
// Each sidecar stdout line is one JSON object, forwarded to the frontend as
// "transcript:line" events; unexpected process exits raise "transcript:exit".
// ---------------------------------------------------------------------------

//go:embed transcriber/transcribe_mic.py
var transcribeScript []byte

// findPython prefers the Windows launcher pinned to 3.11 (the environment
// faster-whisper is installed into), falling back to whatever python is on
// PATH.
func findPython() (exe string, args []string, err error) {
	if p, e := exec.LookPath("py"); e == nil {
		return p, []string{"-3.11"}, nil
	}
	for _, name := range []string{"python", "python3"} {
		if p, e := exec.LookPath(name); e == nil {
			return p, nil, nil
		}
	}
	return "", nil, fmt.Errorf("Python not found — install Python 3.11+ and 'py -3.11 -m pip install --user faster-whisper numpy'")
}

// ensureTranscriber spawns the resident sidecar if it is not already running,
// so the Whisper model is loaded (or loading) before capture is requested.
func (a *App) ensureTranscriber() error {
	a.mu.Lock()
	running := a.transcribeCmd != nil
	a.mu.Unlock()
	if running {
		return nil
	}

	dir, err := dataDir()
	if err != nil {
		return fmt.Errorf("no data directory: %w", err)
	}
	script := filepath.Join(dir, "transcribe_mic.py")
	if err := os.WriteFile(script, transcribeScript, 0o600); err != nil {
		return fmt.Errorf("could not write the transcriber script: %w", err)
	}

	python, pyArgs, err := findPython()
	if err != nil {
		return err
	}

	cmd := exec.Command(python, append(pyArgs, script, "--model", "small")...)
	platform.HideWindow(cmd)

	stdin, err := cmd.StdinPipe() // the command channel; closing it exits the sidecar
	if err != nil {
		return err
	}
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

	a.mu.Lock()
	a.transcribeCmd = cmd
	a.transcribeStdin = stdin
	a.mu.Unlock()

	// Forward each JSON line to the frontend.
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" && a.ctx != nil {
				wruntime.EventsEmit(a.ctx, "transcript:line", line)
			}
		}
	}()

	// Keep a tail of stderr for the exit report.
	errTail := make(chan string, 1)
	go func() {
		raw, _ := io.ReadAll(stderr)
		tail := strings.TrimSpace(string(raw))
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		errTail <- tail
	}()

	// Report unexpected exits (a deliberate shutdown clears transcribeCmd
	// first). The fields are cleared so the next Start respawns the sidecar.
	go func() {
		err := cmd.Wait()
		tail := <-errTail

		a.mu.Lock()
		current := a.transcribeCmd == cmd
		if current {
			a.transcribeCmd = nil
			a.transcribeStdin = nil
		}
		a.mu.Unlock()

		if current && a.ctx != nil {
			detail := ""
			if err != nil {
				detail = firstNonEmpty(tail, err.Error())
			}
			wruntime.EventsEmit(a.ctx, "transcript:exit", detail)
		}
	}()

	return nil
}

// transcriberCommand writes one JSON command line to the sidecar's stdin.
func (a *App) transcriberCommand(cmd map[string]string) error {
	raw, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.transcribeStdin == nil {
		return fmt.Errorf("the transcriber is not running")
	}
	_, err = a.transcribeStdin.Write(append(raw, '\n'))
	return err
}

// StartTranscription begins capturing the given device (its display name;
// empty picks the first available device). The resident sidecar is spawned
// on first use — WarmTranscriber at startup usually has it ready already.
func (a *App) StartTranscription(deviceLabel string) error {
	if err := a.ensureTranscriber(); err != nil {
		return err
	}
	return a.transcriberCommand(map[string]string{
		"cmd":    "start",
		"device": deviceLabel,
	})
}

// StopTranscription ends the capture but keeps the sidecar (and its loaded
// model) resident so the next start is instant. Safe to call anytime.
func (a *App) StopTranscription() {
	_ = a.transcriberCommand(map[string]string{"cmd": "stop"})
}

// killTranscriber ends the resident sidecar; used at app shutdown.
func (a *App) killTranscriber() {
	a.mu.Lock()
	cmd := a.transcribeCmd
	stdin := a.transcribeStdin
	a.transcribeCmd = nil
	a.transcribeStdin = nil
	a.mu.Unlock()

	if cmd == nil {
		return
	}
	if stdin != nil {
		_ = stdin.Close() // stdin EOF ends the command loop cleanly
	}
	proc := cmd.Process
	if proc != nil {
		time.AfterFunc(2*time.Second, func() {
			_ = proc.Kill() // no-op error if it already exited
		})
	}
}

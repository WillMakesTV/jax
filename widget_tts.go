package main

import (
	"bp-temp/internal/platform"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Widget sound TTS
//
// Sound fields can be spoken instead of uploaded: type the line and it
// becomes the field's audio file. OpenAI's speech API produces the voice
// when an API key is connected (Anthropic has no TTS surface, and the
// ChatGPT-account mode's Codex CLI exposes none either); otherwise the
// local Windows speech synthesizer (System.Speech, driven through
// PowerShell) does the job entirely offline.
// ---------------------------------------------------------------------------

const openaiSpeechURL = "https://api.openai.com/v1/audio/speech"

// openaiTTSModel and voice: the small dedicated speech model with its
// default voice — widget alerts need clarity, not narration nuance.
const (
	openaiTTSModel = "gpt-4o-mini-tts"
	openaiTTSVoice = "alloy"
)

// GenerateWidgetFieldSound speaks text into an audio file and records it as
// the sound field's value, returning the updated widget. OpenAI TTS renders
// the voice when an API key is connected; otherwise the local Windows
// synthesizer does.
func (a *App) GenerateWidgetFieldSound(widgetID, fieldID, text string) (StreamWidget, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return StreamWidget{}, fmt.Errorf("type the line to speak first")
	}

	dir, err := widgetFilesDir(widgetID)
	if err != nil {
		return StreamWidget{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var name string
	if conn, ok := a.getConn(openaiService); ok && conn.login == openaiModeAPIKey {
		name, err = a.openaiSpeech(ctx, dir, text)
	} else {
		name, err = localSpeech(ctx, dir, text)
	}
	if err != nil {
		return StreamWidget{}, err
	}
	return a.setWidgetFieldFile(widgetID, fieldID, name)
}

// openaiSpeech renders text through the OpenAI speech API into an MP3 in
// dir, returning the file's bare name.
func (a *App) openaiSpeech(ctx context.Context, dir, text string) (string, error) {
	headers, err := a.openaiAuthHeaders()
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(map[string]any{
		"model":           openaiTTSModel,
		"voice":           openaiTTSVoice,
		"input":           text,
		"response_format": "mp3",
	})
	if err != nil {
		return "", err
	}
	headers["Content-Type"] = "application/json"
	raw, err := postAI(ctx, openaiSpeechURL, headers, body, "OpenAI")
	if err != nil {
		return "", err
	}
	name := fmt.Sprintf("speech_%d.mp3", time.Now().UnixNano())
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o600); err != nil {
		return "", fmt.Errorf("could not save the audio: %v", err)
	}
	return name, nil
}

// localSpeech renders text through the Windows speech synthesizer
// (System.Speech via PowerShell) into a WAV in dir, returning the file's
// bare name. Fully offline. The text travels through a temp file rather
// than the command line, so no quoting can break out of the script.
func localSpeech(ctx context.Context, dir, text string) (string, error) {
	textFile, err := os.CreateTemp("", "jax-tts-*.txt")
	if err != nil {
		return "", err
	}
	textPath := textFile.Name()
	defer os.Remove(textPath)
	if _, err := textFile.WriteString(text); err != nil {
		_ = textFile.Close()
		return "", err
	}
	if err := textFile.Close(); err != nil {
		return "", err
	}

	name := fmt.Sprintf("speech_%d.wav", time.Now().UnixNano())
	outPath := filepath.Join(dir, name)
	script := fmt.Sprintf(`Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText(%q, [System.Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile(%q)
$synth.Speak($text)
$synth.Dispose()`, textPath, outPath)

	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	platform.HideWindow(cmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return "", fmt.Errorf("the Windows speech synthesizer failed: %s", firstNonEmpty(msg, err.Error()))
	}
	if info, err := os.Stat(outPath); err != nil || info.Size() == 0 {
		return "", fmt.Errorf("the Windows speech synthesizer produced no audio")
	}
	return name, nil
}

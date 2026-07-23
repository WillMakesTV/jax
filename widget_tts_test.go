package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalSpeech(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	name, err := localSpeech(ctx, dir, "Jax test alert")
	if err != nil {
		t.Fatalf("local speech: %v", err)
	}
	if !strings.HasSuffix(name, ".wav") {
		t.Fatalf("unexpected file name %q", name)
	}
	info, err := os.Stat(filepath.Join(dir, name))
	if err != nil || info.Size() == 0 {
		t.Fatalf("no audio produced: stat %v", err)
	}
}

func TestGenerateWidgetFieldSoundRequiresText(t *testing.T) {
	a := newTestApp(t)
	if _, err := a.GenerateWidgetFieldSound("w", "f", "   "); err == nil {
		t.Fatal("want error for empty text")
	}
}

func TestApplicationVoice(t *testing.T) {
	a := newTestApp(t)

	// Unset: the built-in default speaks.
	if got := a.applicationVoice(); got != openaiTTSVoice {
		t.Fatalf("unset should default to %q, got %q", openaiTTSVoice, got)
	}

	// A recognized voice is honored.
	if err := a.SetSetting(keyApplicationVoice, "nova"); err != nil {
		t.Fatalf("set voice: %v", err)
	}
	if got := a.applicationVoice(); got != "nova" {
		t.Fatalf("want nova, got %q", got)
	}

	// An unknown value can't reach the API — it falls back to the default.
	if err := a.SetSetting(keyApplicationVoice, "not-a-voice"); err != nil {
		t.Fatalf("set voice: %v", err)
	}
	if got := a.applicationVoice(); got != openaiTTSVoice {
		t.Fatalf("unknown voice should fall back to %q, got %q", openaiTTSVoice, got)
	}
}

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

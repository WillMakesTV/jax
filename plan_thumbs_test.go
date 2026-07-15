package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// Changing a plan's thumbnail files the replaced image into the history;
// restoring a history entry pulls it back out and files the replaced one.
func TestThumbnailHistoryOnSave(t *testing.T) {
	a := newTestApp(t)

	p, err := a.SavePlannedStream(PlannedStream{Title: "T", ThumbnailFile: "a.png"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if len(p.ThumbnailHistory) != 0 {
		t.Fatalf("new plan history = %v, want empty", p.ThumbnailHistory)
	}

	p.ThumbnailFile = "b.png"
	if p, err = a.SavePlannedStream(p); err != nil {
		t.Fatal(err)
	}
	if len(p.ThumbnailHistory) != 1 || p.ThumbnailHistory[0] != "a.png" {
		t.Fatalf("after change history = %v, want [a.png]", p.ThumbnailHistory)
	}

	// Revert: a.png becomes current again, b.png files into history.
	p.ThumbnailFile = "a.png"
	if p, err = a.SavePlannedStream(p); err != nil {
		t.Fatal(err)
	}
	if len(p.ThumbnailHistory) != 1 || p.ThumbnailHistory[0] != "b.png" {
		t.Fatalf("after revert history = %v, want [b.png]", p.ThumbnailHistory)
	}

	// Removing the thumbnail keeps it restorable.
	p.ThumbnailFile = ""
	if p, err = a.SavePlannedStream(p); err != nil {
		t.Fatal(err)
	}
	if len(p.ThumbnailHistory) != 2 || p.ThumbnailHistory[0] != "a.png" || p.ThumbnailHistory[1] != "b.png" {
		t.Fatalf("after remove history = %v, want [a.png b.png]", p.ThumbnailHistory)
	}

	// A save that does not touch the thumbnail leaves the history alone.
	p.Title = "T2"
	if p, err = a.SavePlannedStream(p); err != nil {
		t.Fatal(err)
	}
	if len(p.ThumbnailHistory) != 2 {
		t.Fatalf("after unrelated save history = %v, want 2 entries", p.ThumbnailHistory)
	}
}

// Live round-trip through Codex's image_generation tool. Costs real ChatGPT
// A short's thumbnail is the cover of a vertical video seen full-screen on a
// phone; a long-form video's is the usual 16:9 card. The plan's format is what
// decides, so the two never come back in the wrong frame.
func TestThumbShapeFollowsThePlanFormat(t *testing.T) {
	short := thumbShapeForFormat("short")
	if short.size != openaiImageSizePortrait {
		t.Errorf("a short's thumbnail is %s, want the portrait %s", short.size, openaiImageSizePortrait)
	}
	if !strings.Contains(short.note, "9:16") {
		t.Error("the short-form brief never tells the model the frame is 9:16")
	}

	for _, format := range []string{"long", "", "something-else"} {
		shape := thumbShapeForFormat(format)
		if shape.size != openaiImageSizeLandscape {
			t.Errorf("format %q gave %s, want the landscape %s",
				format, shape.size, openaiImageSizeLandscape)
		}
	}
}

// subscription usage and needs a signed-in Codex, so it only runs when
// explicitly asked for: JAX_LIVE_CODEX=1 go test -run TestGenerateThumbViaCodexLive
func TestGenerateThumbViaCodexLive(t *testing.T) {
	if os.Getenv("JAX_LIVE_CODEX") == "" {
		t.Skip("set JAX_LIVE_CODEX=1 to run the live Codex image test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	png, err := generateThumbViaCodex(ctx, "A simple flat illustration of a blue square on a white background.", nil, nil, landscapeThumb)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	// PNG magic bytes prove an actual image came back, not an apology.
	if len(png) < 8 || string(png[1:4]) != "PNG" {
		t.Fatalf("did not get a PNG (%d bytes)", len(png))
	}
}

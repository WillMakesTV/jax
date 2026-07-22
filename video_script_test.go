package main

import (
	"strings"
	"testing"
)

func TestVideoScriptStore(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Preset walkthrough", Format: "long"})
	if err != nil {
		t.Fatalf("save plan: %v", err)
	}

	if got := a.GetVideoScript(plan.ID); got != "" {
		t.Fatalf("a new plan has no script: %q", got)
	}
	if err := a.SaveVideoScript(plan.ID, "## Cold open\n\n> Here it is."); err != nil {
		t.Fatalf("save script: %v", err)
	}
	if got := a.GetVideoScript(plan.ID); !strings.Contains(got, "Cold open") {
		t.Fatalf("script not stored: %q", got)
	}

	// The script is its own document: writing it leaves the edit directions
	// alone, and the teleprompter reads the script rather than the directions.
	if err := a.SaveEditScript(plan.ID, "Cut from 00:12 to 00:40."); err != nil {
		t.Fatalf("save directions: %v", err)
	}
	if got := a.GetVideoScript(plan.ID); strings.Contains(got, "00:12") {
		t.Fatalf("directions leaked into the script: %q", got)
	}
	if got := a.GetEditScript(plan.ID); !strings.Contains(got, "00:12") {
		t.Fatalf("directions not stored: %q", got)
	}
}

func TestTeleprompterSettings(t *testing.T) {
	a := newTestApp(t)

	// Defaults until something is chosen.
	got := a.GetTeleprompterSettings()
	if got.Scheme != "theme" || got.Speed != teleprompterSpeedDefault || got.Scroll {
		t.Fatalf("defaults: %+v", got)
	}
	if len(a.GetTeleprompterSchemes()) < 2 {
		t.Fatal("the prompter should offer more than one palette")
	}

	// A saved choice comes back, and keep-on-top rides along with it.
	saved, err := a.SetTeleprompterSettings(TeleprompterSettings{
		Scheme: "amber", Scroll: true, Speed: 45, Topmost: true,
	})
	if err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if saved.Scheme != "amber" || !saved.Scroll || saved.Speed != 45 || !saved.Topmost {
		t.Fatalf("settings not stored: %+v", saved)
	}
	if !a.scriptWindowTopmost() {
		t.Fatal("keep-on-top should follow the settings")
	}

	// A named scheme resolves to its own colours; "theme" follows the app.
	opts := a.scriptWindowOptions(saved)
	if opts.Background != 0x00000000 || opts.Foreground != 0x0000b0ff ||
		!opts.Scroll || opts.Speed != 45 {
		t.Fatalf("amber options: %+v", opts)
	}
	if err := a.store.setSetting("theme", "dark"); err != nil {
		t.Fatalf("set theme: %v", err)
	}
	opts = a.scriptWindowOptions(TeleprompterSettings{Scheme: "theme", Speed: 30})
	if !opts.Dark || opts.Background != 0x000d0d0d {
		t.Fatalf("theme options: %+v", opts)
	}

	// A speed of zero is nobody's choice — it is the default coming through.
	reset, err := a.SetTeleprompterSettings(TeleprompterSettings{Scheme: "", Speed: 0})
	if err != nil {
		t.Fatalf("reset settings: %v", err)
	}
	if reset.Scheme != "theme" || reset.Speed != teleprompterSpeedDefault {
		t.Fatalf("blank settings should fall back to the defaults: %+v", reset)
	}
}

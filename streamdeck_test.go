package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// TestStreamdeckHotkeyDiscovery lays out a fake Stream Deck profile holding a
// standalone Hotkey button and a Multi Action with a nested hotkey, and
// checks both normalize into replayable hotkey steps.
func TestStreamdeckHotkeyDiscovery(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("profile location is exercised via %APPDATA%")
	}
	root := t.TempDir()
	t.Setenv("APPDATA", root)

	bundle := filepath.Join(root, "Elgato", "StreamDeck", "ProfilesV2", "TEST.sdProfile")
	pageDir := filepath.Join(bundle, "Profiles", "PAGE1")
	if err := os.MkdirAll(pageDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(bundle, "manifest.json"), []byte(`{"Name":"Test Profile"}`), 0o600,
	); err != nil {
		t.Fatalf("write profile manifest: %v", err)
	}
	page := `{
	  "Controllers": [{"Actions": {
	    "0,0": {
	      "ActionID": "hk1",
	      "UUID": "com.elgato.streamdeck.system.hotkey",
	      "States": [{"Title": "Scene\nSwitcher"}],
	      "Settings": {"Hotkeys": [
	        {"KeyCtrl": true, "KeyShift": true, "VKeyCode": 81},
	        {"VKeyCode": -1}
	      ]}
	    },
	    "1,0": {
	      "ActionID": "ma1",
	      "UUID": "com.elgato.streamdeck.multiactions",
	      "States": [{"Title": "Combo"}],
	      "Actions": [{"Actions": [
	        {"UUID": "com.elgato.streamdeck.system.hotkey",
	         "Settings": {"Hotkeys": [{"KeyOption": true, "VKeyCode": 112}]}}
	      ]}]
	    }
	  }}]
	}`
	if err := os.WriteFile(filepath.Join(pageDir, "manifest.json"), []byte(page), 0o600); err != nil {
		t.Fatalf("write page manifest: %v", err)
	}

	a := &App{}
	actions, err := a.GetStreamdeckMultiActions()
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(actions) != 2 {
		t.Fatalf("want 2 replayable buttons, got %+v", actions)
	}
	byID := map[string]StreamdeckMultiAction{}
	for _, x := range actions {
		byID[x.ID] = x
	}

	hk := byID["hk1"]
	if hk.Title != "Scene Switcher" || len(hk.Steps) != 1 {
		t.Fatalf("standalone hotkey button parsed wrong: %+v", hk)
	}
	s := hk.Steps[0]
	if s.Kind != "hotkey" || s.VKey != 81 || !s.Ctrl || !s.Shift || s.Alt || s.Win {
		t.Fatalf("standalone hotkey step: %+v", s)
	}
	if s.Description != "Ctrl+Shift+Q" {
		t.Fatalf("hotkey label = %q, want Ctrl+Shift+Q", s.Description)
	}

	ma := byID["ma1"]
	if len(ma.Steps) != 1 {
		t.Fatalf("multi action parsed wrong: %+v", ma)
	}
	s = ma.Steps[0]
	if s.Kind != "hotkey" || s.VKey != 112 || !s.Alt || s.Ctrl || s.Description != "Alt+F1" {
		t.Fatalf("nested hotkey step: %+v", s)
	}
}

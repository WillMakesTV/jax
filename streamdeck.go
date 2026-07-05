package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// Stream Deck Multi Action discovery
//
// The Elgato Stream Deck software offers no API for an external app to press
// a button, so a routine "managed with Streamdeck" works by reading the Multi
// Action's steps straight out of the Stream Deck's own profile files and
// replaying the ones Jax understands (OBS actions and delays) over the app's
// obs-websocket connection. Steps Jax cannot replay (third-party plugins like
// Philips Hue) are surfaced as unsupported so the user knows they only run
// when the button is pressed on the deck itself.
//
// Profiles live under %APPDATA%\Elgato\StreamDeck\ProfilesV2: one
// {GUID}.sdProfile bundle per profile with a manifest.json (profile name,
// device), and one Profiles/{PageID}/manifest.json per page holding the
// buttons. A Multi Action button carries UUID
// com.elgato.streamdeck.multiactions[.routine|.switch] and nests its child
// actions in Actions[0].Actions.
// ---------------------------------------------------------------------------

// StreamdeckMultiAction is one Multi Action button found on a Stream Deck,
// with its child actions normalized into routine steps.
type StreamdeckMultiAction struct {
	// ID is the button's stable ActionID (a GUID that survives profile edits).
	ID string `json:"id"`
	// Title is the button's on-deck title, falling back to "Multi Action".
	Title string `json:"title"`
	// Profile is the name of the Stream Deck profile holding the button.
	Profile string `json:"profile"`
	// Coordinates is the button's "column,row" position on its page.
	Coordinates string `json:"coordinates"`
	Steps       []RoutineStep `json:"steps"`
}

// streamdeckProfilesDir locates the Stream Deck software's profile store.
func streamdeckProfilesDir() (string, error) {
	switch runtime.GOOS {
	case "windows":
		cfg, err := os.UserConfigDir() // %APPDATA% (Roaming)
		if err != nil {
			return "", err
		}
		return filepath.Join(cfg, "Elgato", "StreamDeck", "ProfilesV2"), nil
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "com.elgato.StreamDeck", "ProfilesV2"), nil
	default:
		return "", fmt.Errorf("stream deck profiles are not supported on %s", runtime.GOOS)
	}
}

// sdAction is one button or nested child action in a page manifest.
type sdAction struct {
	ActionID string         `json:"ActionID"`
	Name     string         `json:"Name"`
	UUID     string         `json:"UUID"`
	Settings map[string]any `json:"Settings"`
	Plugin   struct {
		Name string `json:"Name"`
	} `json:"Plugin"`
	States []struct {
		Title string `json:"Title"`
	} `json:"States"`
	// A Multi Action nests its steps one level down: Actions[0].Actions holds
	// the sequence (Actions[1] is the second state of a Multi Action Switch).
	Actions []struct {
		Actions []sdAction `json:"Actions"`
	} `json:"Actions"`
}

type sdPageManifest struct {
	Controllers []struct {
		Actions map[string]sdAction `json:"Actions"`
	} `json:"Controllers"`
}

// GetStreamdeckMultiActions scans every Stream Deck profile on this machine
// and returns the Multi Action buttons found, sorted by profile then title.
func (a *App) GetStreamdeckMultiActions() ([]StreamdeckMultiAction, error) {
	root, err := streamdeckProfilesDir()
	if err != nil {
		return nil, err
	}
	bundles, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("no Stream Deck profiles found — is the Stream Deck software installed?")
	}

	actions := []StreamdeckMultiAction{}
	for _, bundle := range bundles {
		if !bundle.IsDir() || !strings.HasSuffix(bundle.Name(), ".sdProfile") {
			continue
		}
		bundleDir := filepath.Join(root, bundle.Name())

		profileName := strings.TrimSuffix(bundle.Name(), ".sdProfile")
		var profile struct {
			Name string `json:"Name"`
		}
		if raw, err := os.ReadFile(filepath.Join(bundleDir, "manifest.json")); err == nil {
			if json.Unmarshal(raw, &profile) == nil && profile.Name != "" {
				profileName = profile.Name
			}
		}

		pages, err := os.ReadDir(filepath.Join(bundleDir, "Profiles"))
		if err != nil {
			continue
		}
		for _, page := range pages {
			if !page.IsDir() {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(bundleDir, "Profiles", page.Name(), "manifest.json"))
			if err != nil {
				continue
			}
			var manifest sdPageManifest
			if err := json.Unmarshal(raw, &manifest); err != nil {
				continue
			}
			for _, controller := range manifest.Controllers {
				for coords, action := range controller.Actions {
					if !strings.HasPrefix(action.UUID, "com.elgato.streamdeck.multiactions") ||
						len(action.Actions) == 0 {
						continue
					}
					steps := []RoutineStep{}
					for _, child := range action.Actions[0].Actions {
						steps = append(steps, normalizeStreamdeckStep(child))
					}
					actions = append(actions, StreamdeckMultiAction{
						ID:          action.ActionID,
						Title:       sdActionTitle(action),
						Profile:     profileName,
						Coordinates: coords,
						Steps:       steps,
					})
				}
			}
		}
	}

	sort.Slice(actions, func(i, j int) bool {
		if actions[i].Profile != actions[j].Profile {
			return actions[i].Profile < actions[j].Profile
		}
		return actions[i].Title < actions[j].Title
	})
	return actions, nil
}

// sdActionTitle returns a button's display title: its first state title with
// newlines flattened, falling back to the action name.
func sdActionTitle(action sdAction) string {
	title := ""
	if len(action.States) > 0 {
		title = action.States[0].Title
	}
	title = strings.Join(strings.Fields(title), " ")
	if title == "" {
		title = action.Name
	}
	if title == "" {
		title = "Multi Action"
	}
	return title
}

// Settings helpers: Stream Deck settings are loosely typed JSON.
func sdString(settings map[string]any, key string) string {
	v, _ := settings[key].(string)
	return v
}

func sdInt(settings map[string]any, key string) int {
	v, _ := settings[key].(float64)
	return int(v)
}

// normalizeStreamdeckStep maps one Multi Action child onto a routine step.
// Anything Jax cannot replay over obs-websocket becomes an unsupported step
// describing what it was.
func normalizeStreamdeckStep(action sdAction) RoutineStep {
	settings := action.Settings
	switch {
	case action.UUID == "com.elgato.streamdeck.multiactions.delay":
		return RoutineStep{Kind: "delay", DelayMs: sdInt(settings, "delay")}

	case action.UUID == "com.elgato.obsstudio.scene":
		target := sdString(settings, "target")
		if target == "" {
			target = "program"
		}
		return RoutineStep{
			Kind:   "obs-scene",
			Scene:  sdString(settings, "scene"),
			Target: target,
		}

	case action.UUID == "com.elgato.obsstudio.source":
		scene := sdString(settings, "sceneitemscene")
		if scene == "" {
			scene = sdString(settings, "scene")
		}
		return RoutineStep{
			Kind:        "obs-source",
			Scene:       scene,
			Source:      sdString(settings, "sceneitemname"),
			SceneItemID: sdInt(settings, "sceneitemid"),
			Mode:        "toggle",
		}

	case action.UUID == "com.elgato.obsstudio.mixeraudio" && sdString(settings, "type") == "mute":
		mode := sdString(settings, "mode")
		if mode == "" {
			mode = "toggle"
		}
		return RoutineStep{
			Kind:   "obs-mute",
			Source: sdString(settings, "source"),
			Mode:   mode,
		}

	case action.UUID == "com.elgato.obsstudio.stream" ||
		action.UUID == "com.elgato.obsstudio.streaming":
		return RoutineStep{Kind: "obs-stream", Mode: "toggle"}

	case action.UUID == "com.elgato.obsstudio.record":
		return RoutineStep{Kind: "obs-record", Mode: "toggle"}
	}

	// Nested child actions often lack Plugin metadata, so fall back to a name
	// derived from the UUID (com.elgato.philips-hue.color → "Philips Hue").
	plugin := action.Plugin.Name
	if plugin == "" {
		if parts := strings.Split(action.UUID, "."); len(parts) >= 3 {
			words := strings.Fields(strings.ReplaceAll(parts[2], "-", " "))
			for i, w := range words {
				words[i] = strings.ToUpper(w[:1]) + w[1:]
			}
			plugin = strings.Join(words, " ")
		}
	}
	desc := action.Name
	if plugin != "" && plugin != action.Name {
		desc = plugin + ": " + action.Name
	}
	if desc == "" {
		desc = action.UUID
	}
	return RoutineStep{Kind: "unsupported", Description: desc}
}

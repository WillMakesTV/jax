package main

import (
	"bp-temp/internal/platform"
	"fmt"
	"log"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------------------
// The teleprompter
//
// A small window beside the app showing the plan's spoken script (see
// video_script.go) while footage is recorded from OBS. It is owned by this
// process, so the hide-from-capture preference covers it exactly like the
// main window, and it carries its own settings: the colours it reads in, and
// whether it scrolls itself and how fast.
// ---------------------------------------------------------------------------

// settingScriptTopmost mirrors SETTING_KEYS.scriptWindowTopmost in
// frontend/src/lib/settings.ts: keep the teleprompter above every other
// window, so it stays readable over OBS or a game.
const settingScriptTopmost = "script_window_topmost"

// keyTeleprompterSettings stores the producer's prompter preferences.
const keyTeleprompterSettings = "teleprompter_settings"

// TeleprompterSettings is how the prompter reads: its colour scheme, and the
// auto-scroll that carries the talent through a long script hands-free.
type TeleprompterSettings struct {
	// Scheme names a palette below ("theme" = follow the app's theme).
	Scheme string `json:"scheme"`
	// Scroll turns the auto-scroll on; Speed is in lines per minute.
	Scroll bool `json:"scroll"`
	Speed  int  `json:"speed"`
	// Topmost mirrors the keep-on-top preference, so one read tells the
	// frontend everything the prompter is doing.
	Topmost bool `json:"topmost"`
}

// teleprompterScheme is one named palette. Colours are COLORREF (0x00BBGGRR),
// which is what the window's GDI calls take.
type teleprompterScheme struct {
	ID    string
	Label string
	Fg    uint32
	Bg    uint32
	// Dark asks Windows for a dark title bar to match the client area.
	Dark bool
}

// teleprompterSchemes are the palettes offered, in display order. "theme"
// leads: the prompter looks like the app unless a reading-specific palette is
// chosen for it. The rest are the high-contrast pairs broadcast prompters
// have always used — they are read at a distance, off-axis, over a lit set.
var teleprompterSchemes = []teleprompterScheme{
	{ID: "theme", Label: "Match the app"},
	{ID: "dark", Label: "Dark", Fg: 0x00f5f5f5, Bg: 0x000d0d0d, Dark: true},
	{ID: "light", Label: "Light", Fg: 0x001a1a1a, Bg: 0x00ffffff},
	{ID: "amber", Label: "Amber on black", Fg: 0x0000b0ff, Bg: 0x00000000, Dark: true},
	{ID: "green", Label: "Green on black", Fg: 0x0040ff40, Bg: 0x00000000, Dark: true},
	{ID: "paper", Label: "Black on paper", Fg: 0x00000000, Bg: 0x00e8f4fa},
}

// teleprompterSpeedDefault is the auto-scroll's starting pace, in lines per
// minute — an unhurried read.
const teleprompterSpeedDefault = 30

// TeleprompterScheme is one palette, as the frontend lists it.
type TeleprompterScheme struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// GetTeleprompterSchemes returns the palettes the prompter offers, in display
// order. Never nil.
func (a *App) GetTeleprompterSchemes() []TeleprompterScheme {
	out := make([]TeleprompterScheme, 0, len(teleprompterSchemes))
	for _, s := range teleprompterSchemes {
		out = append(out, TeleprompterScheme{ID: s.ID, Label: s.Label})
	}
	return out
}

// GetTeleprompterSettings returns the stored prompter settings, filled in
// with the defaults for anything never chosen.
func (a *App) GetTeleprompterSettings() TeleprompterSettings {
	s := TeleprompterSettings{Scheme: "theme", Speed: teleprompterSpeedDefault}
	if a.store != nil {
		if _, err := a.store.getJSON(keyTeleprompterSettings, &s); err != nil {
			log.Printf("jax: teleprompter settings: %v", err)
		}
	}
	if s.Scheme == "" {
		s.Scheme = "theme"
	}
	if s.Speed <= 0 {
		s.Speed = teleprompterSpeedDefault
	}
	s.Topmost = a.scriptWindowTopmost()
	return s
}

// SetTeleprompterSettings stores the prompter's settings and applies them to
// the window if one is open, so a colour or speed change is seen while the
// talent is mid-read rather than at the next open.
func (a *App) SetTeleprompterSettings(settings TeleprompterSettings) (TeleprompterSettings, error) {
	if settings.Scheme == "" {
		settings.Scheme = "theme"
	}
	if settings.Speed <= 0 {
		settings.Speed = teleprompterSpeedDefault
	}
	if a.store != nil {
		if err := a.store.setJSON(keyTeleprompterSettings, settings); err != nil {
			return TeleprompterSettings{}, err
		}
		if err := a.store.setSetting(settingScriptTopmost,
			strconv.FormatBool(settings.Topmost)); err != nil {
			return TeleprompterSettings{}, err
		}
	}
	// No window open is not a failure — the settings are stored, and the next
	// open picks them up.
	if err := platform.SetScriptWindowOptions(a.scriptWindowOptions(settings)); err != nil {
		log.Printf("jax: apply teleprompter settings: %v", err)
	}
	return a.GetTeleprompterSettings(), nil
}

// scriptWindowOptions resolves stored settings into what the window needs:
// the scheme's colours (or the app theme's, for "theme"), the scroll, and
// keep-on-top.
func (a *App) scriptWindowOptions(s TeleprompterSettings) platform.ScriptWindowOptions {
	opts := platform.ScriptWindowOptions{
		Topmost: s.Topmost,
		Scroll:  s.Scroll,
		Speed:   s.Speed,
	}
	for _, scheme := range teleprompterSchemes {
		if scheme.ID != s.Scheme || scheme.ID == "theme" {
			continue
		}
		opts.Foreground, opts.Background, opts.Dark = scheme.Fg, scheme.Bg, scheme.Dark
		return opts
	}
	// "Match the app": the theme preference, resolved the way the rest of the
	// app resolves it.
	if a.scriptWindowDark() {
		opts.Foreground, opts.Background, opts.Dark = 0x00f5f5f5, 0x000d0d0d, true
	} else {
		opts.Foreground, opts.Background = 0x001a1a1a, 0x00ffffff
	}
	return opts
}

// scriptWindowDark resolves the app's theme preference (Settings →
// Appearance; the frontend stores it under the shared "theme" key) for the
// teleprompter: dark, light, or — for "system"/unset — whatever the OS
// prefers.
func (a *App) scriptWindowDark() bool {
	pref := ""
	if a.store != nil {
		if v, err := a.store.getSetting("theme"); err == nil {
			pref = v
		}
	}
	switch pref {
	case "dark":
		return true
	case "light":
		return false
	}
	return platform.SystemPrefersDark()
}

// scriptWindowTopmost reads the persisted keep-on-top preference.
func (a *App) scriptWindowTopmost() bool {
	if a.store == nil {
		return false
	}
	v, err := a.store.getSetting(settingScriptTopmost)
	return err == nil && v == "true"
}

// SetScriptWindowTopmost applies and persists the teleprompter's keep-on-top
// preference. An already-open window flips immediately; otherwise the choice
// takes effect the next time it opens.
func (a *App) SetScriptWindowTopmost(onTop bool) error {
	if err := platform.SetScriptWindowTopmost(onTop); err != nil {
		return err
	}
	if a.store == nil {
		return nil
	}
	return a.store.setSetting(settingScriptTopmost, strconv.FormatBool(onTop))
}

// OpenTeleprompter shows a video plan's spoken script in its own window
// beside the app — what the talent reads while recording straight from OBS.
// The window is owned by this process, so when the hide-from-capture
// preference is on it disappears from screen shares exactly like the app
// itself (the per-window affinity is re-applied here to cover the fresh
// window).
func (a *App) OpenTeleprompter(planID string) error {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return err
	}
	script := strings.TrimSpace(a.GetVideoScript(planID))
	if script == "" {
		return fmt.Errorf("this plan has no script yet — write one on the Editor tab first")
	}
	title := "Teleprompter"
	if strings.TrimSpace(plan.Title) != "" {
		title = "Teleprompter — " + strings.TrimSpace(plan.Title)
	}
	opts := a.scriptWindowOptions(a.GetTeleprompterSettings())
	if err := platform.OpenScriptWindow(title, script, opts); err != nil {
		return err
	}
	if a.store != nil {
		if v, err := a.store.getSetting(settingHideFromCapture); err == nil && v == "true" {
			if err := platform.ApplyCaptureExclusion(true); err != nil {
				log.Printf("jax: hide teleprompter from capture: %v", err)
			}
		}
	}
	return nil
}

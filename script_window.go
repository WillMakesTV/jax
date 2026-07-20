package main

import (
	"fmt"
	"log"
	"strconv"
	"strings"
)

// settingScriptTopmost mirrors SETTING_KEYS.scriptWindowTopmost in
// frontend/src/lib/settings.ts: keep the script window above every other
// window, so the teleprompter stays readable over OBS or a game.
const settingScriptTopmost = "script_window_topmost"

// scriptWindowDark resolves the app's theme preference (Settings →
// Appearance; the frontend stores it under the shared "theme" key) for the
// native script window: dark, light, or — for "system"/unset — whatever the
// OS prefers.
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
	return systemPrefersDark()
}

// scriptWindowTopmost reads the persisted keep-on-top preference.
func (a *App) scriptWindowTopmost() bool {
	if a.store == nil {
		return false
	}
	v, err := a.store.getSetting(settingScriptTopmost)
	return err == nil && v == "true"
}

// SetScriptWindowTopmost applies and persists the script window's keep-on-top
// preference. An already-open window flips immediately; otherwise the choice
// takes effect the next time the window opens.
func (a *App) SetScriptWindowTopmost(onTop bool) error {
	if err := setScriptWindowTopmost(onTop); err != nil {
		return err
	}
	if a.store == nil {
		return nil
	}
	return a.store.setSetting(settingScriptTopmost, strconv.FormatBool(onTop))
}

// OpenScriptWindow shows a video plan's saved script in its own small window
// beside the app — the teleprompter for recording straight from OBS. The
// window is owned by this process, so when the hide-from-capture preference
// is on it disappears from screen shares exactly like the app itself (the
// per-window affinity is re-applied here to cover the fresh window).
func (a *App) OpenScriptWindow(planID string) error {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return err
	}
	script := strings.TrimSpace(a.GetEditScript(planID))
	if script == "" {
		return fmt.Errorf("this plan has no script yet — write one on the Editor tab first")
	}
	title := "Video script"
	if strings.TrimSpace(plan.Title) != "" {
		title = "Script — " + strings.TrimSpace(plan.Title)
	}
	if err := openScriptWindow(title, script, a.scriptWindowDark(), a.scriptWindowTopmost()); err != nil {
		return err
	}
	if a.store != nil {
		if v, err := a.store.getSetting(settingHideFromCapture); err == nil && v == "true" {
			if err := applyCaptureExclusion(true); err != nil {
				log.Printf("jax: hide script window from capture: %v", err)
			}
		}
	}
	return nil
}

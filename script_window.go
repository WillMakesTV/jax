package main

import (
	"fmt"
	"log"
	"strings"
)

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
	if err := openScriptWindow(title, script, a.scriptWindowDark()); err != nil {
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

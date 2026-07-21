package main

import (
	"bp-temp/internal/platform"
	"log"
	"strconv"
	"time"
)

// The "Hide application from screen capture" preference (Settings → Streams).
// Works like OBS's own option: the window stays visible on the real display
// but screen captures, shares and screenshots show nothing where it sits, so
// a display capture of the streaming PC never leaks the dashboard.

// settingHideFromCapture mirrors SETTING_KEYS.hideFromCapture in
// frontend/src/lib/settings.ts.
const settingHideFromCapture = "hide_from_capture"

// SetHideFromCapture applies and persists the hide-from-screen-capture
// preference. The error surfaces in the settings UI when the platform can't
// honour it (non-Windows, or Windows older than 10 2004).
func (a *App) SetHideFromCapture(hidden bool) error {
	if err := platform.ApplyCaptureExclusion(hidden); err != nil {
		return err
	}
	if a.store == nil {
		return nil
	}
	return a.store.setSetting(settingHideFromCapture, strconv.FormatBool(hidden))
}

// restoreCaptureExclusion re-applies a persisted "hidden" preference when the
// app launches. The native window can trail the OnStartup callback by a
// moment, so it retries briefly rather than losing the race.
func (a *App) restoreCaptureExclusion() {
	if a.store == nil {
		return
	}
	v, err := a.store.getSetting(settingHideFromCapture)
	if err != nil || v != "true" {
		return
	}
	var lastErr error
	for i := 0; i < 25; i++ {
		if lastErr = platform.ApplyCaptureExclusion(true); lastErr == nil {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	log.Printf("jax: hide from screen capture: %v", lastErr)
}

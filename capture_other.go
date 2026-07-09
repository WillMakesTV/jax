//go:build !windows

package main

import "fmt"

// applyCaptureExclusion hides the app window from screen capture. Only
// implemented on Windows (SetWindowDisplayAffinity), the platform Jax's
// OBS/Stream Deck workflow runs on.
func applyCaptureExclusion(hidden bool) error {
	return fmt.Errorf("hiding from screen capture is only supported on Windows")
}

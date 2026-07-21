//go:build !windows

package platform

import "fmt"

// ApplyCaptureExclusion hides the app window from screen capture. Only
// implemented on Windows (SetWindowDisplayAffinity), the platform Jax's
// OBS/Stream Deck workflow runs on.
func ApplyCaptureExclusion(hidden bool) error {
	return fmt.Errorf("hiding from screen capture is only supported on Windows")
}

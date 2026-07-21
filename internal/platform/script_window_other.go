//go:build !windows

package platform

import "fmt"

// OpenScriptWindow needs the Win32 window machinery; other platforms report
// the limitation instead.
func OpenScriptWindow(title, text string, dark, topmost bool) error {
	return fmt.Errorf("the script window is only available on Windows")
}

// SetScriptWindowTopmost has no window to move on other platforms.
func SetScriptWindowTopmost(onTop bool) error {
	return fmt.Errorf("the script window is only available on Windows")
}

// SystemPrefersDark backs the "system" theme preference; without a desktop
// convention to consult here, default to light.
func SystemPrefersDark() bool {
	return false
}

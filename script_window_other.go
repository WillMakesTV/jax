//go:build !windows

package main

import "fmt"

// openScriptWindow needs the Win32 window machinery; other platforms report
// the limitation instead.
func openScriptWindow(title, text string, dark bool) error {
	return fmt.Errorf("the script window is only available on Windows")
}

// systemPrefersDark backs the "system" theme preference; without a desktop
// convention to consult here, default to light.
func systemPrefersDark() bool {
	return false
}

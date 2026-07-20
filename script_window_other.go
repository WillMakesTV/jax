//go:build !windows

package main

import "fmt"

// openScriptWindow needs the Win32 window machinery; other platforms report
// the limitation instead.
func openScriptWindow(title, text string) error {
	return fmt.Errorf("the script window is only available on Windows")
}

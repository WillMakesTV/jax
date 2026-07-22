//go:build !windows

package platform

import "fmt"

// ScriptWindowOptions mirrors the Windows teleprompter's settings so callers
// compile everywhere; nothing here has a window to apply them to.
type ScriptWindowOptions struct {
	Foreground uint32
	Background uint32
	Dark       bool
	Topmost    bool
	Scroll     bool
	Speed      int
}

// OpenScriptWindow needs the Win32 window machinery; other platforms report
// the limitation instead.
func OpenScriptWindow(title, text string, opts ScriptWindowOptions) error {
	return fmt.Errorf("the teleprompter is only available on Windows")
}

// SetScriptWindowTopmost has no window to move on other platforms.
func SetScriptWindowTopmost(onTop bool) error {
	return fmt.Errorf("the teleprompter is only available on Windows")
}

// SetScriptWindowOptions has no window to dress on other platforms.
func SetScriptWindowOptions(opts ScriptWindowOptions) error {
	return fmt.Errorf("the teleprompter is only available on Windows")
}

// SystemPrefersDark backs the "system" theme preference; without a desktop
// convention to consult here, default to light.
func SystemPrefersDark() bool {
	return false
}

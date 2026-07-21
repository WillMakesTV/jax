//go:build !windows

package platform

import "fmt"

// PressHotkey synthesizes a keyboard shortcut. Only implemented on Windows,
// where the Stream Deck Hotkey buttons Jax replays live.
func PressHotkey(vkey int, ctrl, shift, alt, win bool) error {
	return fmt.Errorf("pressing hotkeys is only supported on Windows")
}

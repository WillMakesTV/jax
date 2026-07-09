//go:build !windows

package main

import "fmt"

// pressHotkey synthesizes a keyboard shortcut. Only implemented on Windows,
// where the Stream Deck Hotkey buttons Jax replays live.
func pressHotkey(vkey int, ctrl, shift, alt, win bool) error {
	return fmt.Errorf("pressing hotkeys is only supported on Windows")
}

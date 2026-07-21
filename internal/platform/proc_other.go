//go:build !windows

package platform

import "os/exec"

// HideWindow is a no-op off Windows.
func HideWindow(_ *exec.Cmd) {}

// BackgroundProcess is a no-op off Windows.
func BackgroundProcess(_ *exec.Cmd) {}

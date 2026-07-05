//go:build !windows

package main

import "os/exec"

// hideWindow is a no-op off Windows.
func hideWindow(_ *exec.Cmd) {}

// backgroundProcess is a no-op off Windows.
func backgroundProcess(_ *exec.Cmd) {}

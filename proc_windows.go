//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps spawned console processes (the transcriber sidecar) from
// flashing a terminal window.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

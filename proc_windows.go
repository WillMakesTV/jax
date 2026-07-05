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

// belowNormalPriorityClass is the CreateProcess priority for batch work.
const belowNormalPriorityClass = 0x00004000

// backgroundProcess hides the window like hideWindow and additionally drops
// the process to below-normal CPU priority, so heavy batch sidecars (video
// transcription) never starve the live pipeline (mic transcriber, OBS, the
// app itself) of CPU time.
func backgroundProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: belowNormalPriorityClass,
	}
}

//go:build windows

package platform

import (
	"os/exec"
	"syscall"
)

// HideWindow keeps spawned console processes (the transcriber sidecar) from
// flashing a terminal window.
func HideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

// belowNormalPriorityClass is the CreateProcess priority for batch work.
const belowNormalPriorityClass = 0x00004000

// BackgroundProcess hides the window like HideWindow and additionally drops
// the process to below-normal CPU priority, so heavy batch sidecars (video
// transcription) never starve the live pipeline (mic transcriber, OBS, the
// app itself) of CPU time.
func BackgroundProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: belowNormalPriorityClass,
	}
}

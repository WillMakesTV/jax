//go:build windows

package main

import (
	"fmt"
	"os"
	"sync"
	"syscall"
	"unsafe"
)

// SetWindowDisplayAffinity with WDA_EXCLUDEFROMCAPTURE is the same mechanism
// behind OBS's "Hide OBS windows from screen capture": the compositor keeps
// drawing the window on the physical display but omits it from capture APIs
// (display capture, screen shares, screenshots).

var (
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procSetWindowDisplayAffinity = user32.NewProc("SetWindowDisplayAffinity")
)

const (
	wdaNone               = 0x00000000
	wdaExcludeFromCapture = 0x00000011 // needs Windows 10 2004+
)

// EnumWindows scratch state. syscall.NewCallback allocations are permanent,
// so one shared callback (with enumMu serialising its slice) is created up
// front instead of leaking a callback slot per toggle.
var (
	enumMu    sync.Mutex
	enumOwned []uintptr
	enumCB    = syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		var pid uint32
		_, _, _ = procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
		if pid == uint32(os.Getpid()) {
			enumOwned = append(enumOwned, hwnd)
		}
		return 1 // keep enumerating
	})
)

// ownedTopLevelWindows returns the top-level windows this process owns. Wails
// creates one real window; any helper windows that show up are harmless to
// include.
func ownedTopLevelWindows() []uintptr {
	enumMu.Lock()
	defer enumMu.Unlock()
	enumOwned = nil
	_, _, _ = procEnumWindows.Call(enumCB, 0)
	return enumOwned
}

// applyCaptureExclusion sets or clears the capture-exclusion display affinity
// on the app's windows.
func applyCaptureExclusion(hidden bool) error {
	windows := ownedTopLevelWindows()
	if len(windows) == 0 {
		return fmt.Errorf("the app window could not be found")
	}

	affinity := uintptr(wdaNone)
	if hidden {
		affinity = wdaExcludeFromCapture
	}
	applied := false
	var lastErr error
	for _, hwnd := range windows {
		ok, _, callErr := procSetWindowDisplayAffinity.Call(hwnd, affinity)
		if ok == 0 {
			lastErr = callErr
		} else {
			applied = true
		}
	}
	if !applied {
		return fmt.Errorf("hiding from screen capture needs Windows 10 2004 or newer: %v", lastErr)
	}
	return nil
}

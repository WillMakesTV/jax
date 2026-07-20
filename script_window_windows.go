//go:build windows

package main

import (
	"fmt"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

// The script window is a plain Win32 window owned by this process, so the
// hide-from-capture affinity (capture_windows.go) covers it exactly like the
// main window: a read-only multiline EDIT fills the client area with the
// plan's script, on its own message-loop thread. One window at a time —
// reopening updates the text in place and brings it forward.

var (
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procRegisterClassExW    = user32.NewProc("RegisterClassExW")
	procCreateWindowExW     = user32.NewProc("CreateWindowExW")
	procDefWindowProcW      = user32.NewProc("DefWindowProcW")
	procDestroyWindow       = user32.NewProc("DestroyWindow")
	procGetMessageW         = user32.NewProc("GetMessageW")
	procTranslateMessage    = user32.NewProc("TranslateMessage")
	procDispatchMessageW    = user32.NewProc("DispatchMessageW")
	procPostQuitMessage     = user32.NewProc("PostQuitMessage")
	procSetWindowTextW      = user32.NewProc("SetWindowTextW")
	procSendMessageW        = user32.NewProc("SendMessageW")
	procMoveWindow          = user32.NewProc("MoveWindow")
	procGetClientRect       = user32.NewProc("GetClientRect")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procShowWindow          = user32.NewProc("ShowWindow")
	procUpdateWindow        = user32.NewProc("UpdateWindow")
	procLoadCursorW         = user32.NewProc("LoadCursorW")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
	procCreateFontW         = gdi32.NewProc("CreateFontW")
)

const (
	wsOverlappedWindow = 0x00CF0000
	wsChild            = 0x40000000
	wsVisible          = 0x10000000
	wsVScroll          = 0x00200000
	esMultiline        = 0x0004
	esAutoVScroll      = 0x0040
	esReadonly         = 0x0800
	wmDestroy          = 0x0002
	wmSize             = 0x0005
	wmClose            = 0x0010
	wmSetfont          = 0x0030
	swShow             = 5
	swRestore          = 9
	cwUseDefault       = 0x80000000
	colorWindow        = 5
	idcArrow           = 32512
)

type wndclassexw struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSm     uintptr
}

type winRect struct {
	left, top, right, bottom int32
}

type winMsg struct {
	hwnd    uintptr
	message uint32
	wparam  uintptr
	lparam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

// The single script window's state; guarded by scriptMu (the window lives on
// its own thread, so the bound method and the WndProc both reach for it).
var (
	scriptMu   sync.Mutex
	scriptHwnd uintptr
	scriptEdit uintptr

	scriptClassOnce sync.Once
	scriptClassErr  error
	scriptFont      uintptr

	// One permanent callback: syscall.NewCallback allocations never free.
	scriptWndProc = syscall.NewCallback(func(hwnd, msg, wparam, lparam uintptr) uintptr {
		switch msg {
		case wmSize:
			scriptMu.Lock()
			edit := scriptEdit
			scriptMu.Unlock()
			if edit != 0 {
				w := lparam & 0xffff
				h := (lparam >> 16) & 0xffff
				_, _, _ = procMoveWindow.Call(edit, 0, 0, w, h, 1)
			}
			return 0
		case wmClose:
			_, _, _ = procDestroyWindow.Call(hwnd)
			return 0
		case wmDestroy:
			scriptMu.Lock()
			scriptHwnd, scriptEdit = 0, 0
			scriptMu.Unlock()
			_, _, _ = procPostQuitMessage.Call(0)
			return 0
		}
		r, _, _ := procDefWindowProcW.Call(hwnd, msg, wparam, lparam)
		return r
	})
)

func utf16Ptr(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

// registerScriptClass registers the window class once per process.
func registerScriptClass() error {
	scriptClassOnce.Do(func() {
		hinst, _, _ := procGetModuleHandleW.Call(0)
		cursor, _, _ := procLoadCursorW.Call(0, idcArrow)
		wc := wndclassexw{
			wndProc:    scriptWndProc,
			instance:   hinst,
			cursor:     cursor,
			background: colorWindow + 1,
			className:  utf16Ptr("JaxScriptWindow"),
		}
		wc.size = uint32(unsafe.Sizeof(wc))
		if atom, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
			scriptClassErr = fmt.Errorf("register script window class: %v", err)
		}
	})
	return scriptClassErr
}

// openScriptWindow shows the plan's script in the process-owned side window,
// creating it (on a dedicated message-loop thread) or updating the one
// already open. The caller re-applies the capture affinity afterwards.
func openScriptWindow(title, text string) error {
	// The EDIT control needs CRLF line endings.
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")

	scriptMu.Lock()
	hwnd, edit := scriptHwnd, scriptEdit
	scriptMu.Unlock()
	if hwnd != 0 {
		_, _, _ = procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(utf16Ptr(title))))
		_, _, _ = procSetWindowTextW.Call(edit, uintptr(unsafe.Pointer(utf16Ptr(text))))
		_, _, _ = procShowWindow.Call(hwnd, swRestore)
		_, _, _ = procSetForegroundWindow.Call(hwnd)
		return nil
	}

	if err := registerScriptClass(); err != nil {
		return err
	}

	created := make(chan error, 1)
	go func() {
		// The window and its message loop live and die on this thread.
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		hinst, _, _ := procGetModuleHandleW.Call(0)
		hwnd, _, callErr := procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(utf16Ptr("JaxScriptWindow"))),
			uintptr(unsafe.Pointer(utf16Ptr(title))),
			wsOverlappedWindow,
			cwUseDefault, cwUseDefault, 560, 760,
			0, 0, hinst, 0,
		)
		if hwnd == 0 {
			created <- fmt.Errorf("create script window: %v", callErr)
			return
		}
		edit, _, callErr := procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(utf16Ptr("EDIT"))),
			uintptr(unsafe.Pointer(utf16Ptr(text))),
			wsChild|wsVisible|wsVScroll|esMultiline|esAutoVScroll|esReadonly,
			0, 0, 10, 10,
			hwnd, 0, hinst, 0,
		)
		if edit == 0 {
			_, _, _ = procDestroyWindow.Call(hwnd)
			created <- fmt.Errorf("create script text area: %v", callErr)
			return
		}
		if scriptFont == 0 {
			scriptFont, _, _ = procCreateFontW.Call(
				uintptr(^uintptr(20)+1), // height -20 (two's complement)
				0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0,
				uintptr(unsafe.Pointer(utf16Ptr("Segoe UI"))),
			)
		}
		if scriptFont != 0 {
			_, _, _ = procSendMessageW.Call(edit, wmSetfont, scriptFont, 1)
		}

		scriptMu.Lock()
		scriptHwnd, scriptEdit = hwnd, edit
		scriptMu.Unlock()

		var rc winRect
		if r, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); r != 0 {
			_, _, _ = procMoveWindow.Call(edit, 0, 0,
				uintptr(rc.right-rc.left), uintptr(rc.bottom-rc.top), 1)
		}
		_, _, _ = procShowWindow.Call(hwnd, swShow)
		_, _, _ = procUpdateWindow.Call(hwnd)
		created <- nil

		var m winMsg
		for {
			r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				return
			}
			_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
	}()
	return <-created
}

//go:build windows

package platform

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
	dwmapi   = syscall.NewLazyDLL("dwmapi.dll")
	advapi32 = syscall.NewLazyDLL("advapi32.dll")

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
	procGetDC               = user32.NewProc("GetDC")
	procReleaseDC           = user32.NewProc("ReleaseDC")
	procSelectObject        = gdi32.NewProc("SelectObject")
	procGetTextMetricsW     = gdi32.NewProc("GetTextMetricsW")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procShowWindow          = user32.NewProc("ShowWindow")
	procUpdateWindow        = user32.NewProc("UpdateWindow")
	procLoadCursorW         = user32.NewProc("LoadCursorW")
	procInvalidateRect      = user32.NewProc("InvalidateRect")
	procSetTimer            = user32.NewProc("SetTimer")
	procKillTimer           = user32.NewProc("KillTimer")
	procFillRect            = user32.NewProc("FillRect")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
	procCreateFontW         = gdi32.NewProc("CreateFontW")
	procCreateSolidBrush    = gdi32.NewProc("CreateSolidBrush")
	procDeleteObject        = gdi32.NewProc("DeleteObject")
	procSetTextColor        = gdi32.NewProc("SetTextColor")
	procSetBkColor          = gdi32.NewProc("SetBkColor")
	procDwmSetWindowAttr    = dwmapi.NewProc("DwmSetWindowAttribute")
	procRegGetValueW        = advapi32.NewProc("RegGetValueW")
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
	wmEraseBkgnd       = 0x0014
	wmSetfont          = 0x0030
	wmTimer            = 0x0113
	emLineScroll       = 0x00B6
	emGetFirstVisible  = 0x00CE
	emGetLineCount     = 0x00BA
	wmCtlColorEdit     = 0x0133
	wmCtlColorStatic   = 0x0138
	swShow             = 5
	swRestore          = 9
	cwUseDefault       = 0x80000000
	colorWindow        = 5
	idcArrow           = 32512

	// DWMWA_USE_IMMERSIVE_DARK_MODE — flips the title bar dark (Win10 2004+).
	dwmaUseImmersiveDarkMode = 20

	// SetWindowPos: the topmost/normal z-order bands and the flags that
	// change only the band, leaving position, size and focus alone.
	swpNoSize     = 0x0001
	swpNoMove     = 0x0002
	swpNoActivate = 0x0010
)

// SetWindowPos insert-after handles: HWND_TOPMOST (-1) / HWND_NOTOPMOST (-2).
var (
	hwndTopmost   = ^uintptr(0)     // -1
	hwndNoTopmost = ^uintptr(0) - 1 // -2
)

// The script window mirrors the app palette (frontend/src/style.css):
// dark --bp-bg #0d0d0d / --bp-fg #f5f5f5, light #ffffff / #1a1a1a.
// COLORREF is 0x00BBGGRR; these values are grey so the order is moot.
const (
	scriptDarkBg  = 0x000d0d0d
	scriptDarkFg  = 0x00f5f5f5
	scriptLightBg = 0x00ffffff
	scriptLightFg = 0x001a1a1a
)

// ScriptWindowOptions is how the teleprompter is dressed and driven: the
// colours it paints in, whether it stays above other windows, and whether it
// scrolls itself while the talent reads.
type ScriptWindowOptions struct {
	// Foreground and Background are COLORREFs (0x00BBGGRR).
	Foreground uint32
	Background uint32
	// Dark asks Windows for a dark title bar; it does not pick the colours.
	Dark    bool
	Topmost bool
	// Scroll turns the auto-scroll on; Speed is in lines per minute, and is
	// clamped to something a person can read.
	Scroll bool
	Speed  int
}

// Auto-scroll bounds, in lines per minute: slow enough to read, fast enough
// to be worth automating.
const (
	scriptSpeedMin     = 6
	scriptSpeedMax     = 240
	scriptSpeedDefault = 30

	// scriptScrollTimer identifies the window's scroll timer.
	scriptScrollTimer = 1

	// scriptScrollTickMs is how often the smooth scroll advances — ~60fps, so
	// the sub-line nudges read as continuous motion rather than steps.
	scriptScrollTickMs = 16
)

// textMetricW mirrors the Win32 TEXTMETRICW; only the two leading LONGs are
// read (line height = tmHeight + tmExternalLeading).
type textMetricW struct {
	tmHeight           int32
	tmAscent           int32
	tmDescent          int32
	tmInternalLeading  int32
	tmExternalLeading  int32
	tmAveCharWidth     int32
	tmMaxCharWidth     int32
	tmWeight           int32
	tmOverhang         int32
	tmDigitizedAspectX int32
	tmDigitizedAspectY int32
	tmFirstChar        uint16
	tmLastChar         uint16
	tmDefaultChar      uint16
	tmBreakChar        uint16
	tmItalic           byte
	tmUnderlined       byte
	tmStruckOut        byte
	tmPitchAndFamily   byte
	tmCharSet          byte
}

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
	scriptDark bool
	scriptOpts ScriptWindowOptions

	scriptClassOnce sync.Once
	scriptClassErr  error
	scriptFont      uintptr

	// Smooth auto-scroll state. The EDIT control only scrolls in whole lines
	// (EM_LINESCROLL), so between line steps the edit window is nudged up by
	// sub-line pixels to make the motion continuous. scriptLineH is the
	// measured line height (0 = not measured, falls back to line-at-a-time),
	// scriptScrollDy the pixels advanced per timer tick, and scriptScrollAcc
	// the sub-line offset the edit is currently shifted by.
	scriptLineH     int32
	scriptScrollDy  float64
	scriptScrollAcc float64

	// The background brush for the colours currently set, rebuilt whenever
	// they change. Kept until then so repainting never races a DeleteObject.
	scriptBrush   uintptr
	scriptBrushBg uint32

	// One permanent callback: syscall.NewCallback allocations never free.
	scriptWndProc = syscall.NewCallback(func(hwnd, msg, wparam, lparam uintptr) uintptr {
		switch msg {
		case wmCtlColorEdit, wmCtlColorStatic:
			// The read-only EDIT asks its parent for colors (readonly sends
			// CTLCOLORSTATIC); answer with the scheme's palette.
			scriptMu.Lock()
			fg, bg := scriptOpts.Foreground, scriptOpts.Background
			scriptMu.Unlock()
			_, _, _ = procSetTextColor.Call(wparam, uintptr(fg))
			_, _, _ = procSetBkColor.Call(wparam, uintptr(bg))
			return scriptBrushFor(bg)
		case wmEraseBkgnd:
			// Erase the frame in the scheme's background so no white flashes
			// behind the EDIT while it catches up to the client size.
			scriptMu.Lock()
			bg := scriptOpts.Background
			scriptMu.Unlock()
			var rc winRect
			if r, _, _ := procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc))); r != 0 {
				_, _, _ = procFillRect.Call(wparam, uintptr(unsafe.Pointer(&rc)), scriptBrushFor(bg))
			}
			return 1
		case wmTimer:
			// Advance the scroll, stopping at the end rather than hammering a
			// scroll that can no longer move. With a measured line height the
			// edit is nudged sub-line pixels each tick and stepped a whole line
			// (EM_LINESCROLL) once a line's worth accrues, so the motion is
			// smooth; without one it falls back to a line at a time.
			if wparam != scriptScrollTimer {
				break
			}
			scriptMu.Lock()
			edit := scriptEdit
			lineH := scriptLineH
			var steps int
			var offset int32
			if lineH > 0 {
				scriptScrollAcc += scriptScrollDy
				for scriptScrollAcc >= float64(lineH) {
					scriptScrollAcc -= float64(lineH)
					steps++
				}
				offset = int32(scriptScrollAcc + 0.5)
			} else {
				steps = 1
			}
			scriptMu.Unlock()
			if edit == 0 {
				return 0
			}

			ended := false
			for i := 0; i < steps; i++ {
				first, _, _ := procSendMessageW.Call(edit, emGetFirstVisible, 0, 0)
				_, _, _ = procSendMessageW.Call(edit, emLineScroll, 0, 1)
				after, _, _ := procSendMessageW.Call(edit, emGetFirstVisible, 0, 0)
				if after == first {
					ended = true
					break
				}
			}
			if ended {
				// The last line is on screen; nothing left to scroll to.
				_, _, _ = procKillTimer.Call(hwnd, scriptScrollTimer)
				scriptResetScrollOffset()
				return 0
			}
			if lineH > 0 {
				scriptMoveEdit(hwnd, edit, offset)
			}
			return 0
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
			scriptLineH, scriptScrollAcc, scriptScrollDy = 0, 0, 0
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

// SystemPrefersDark reads Windows' per-user app theme — the same OS setting
// the frontend's prefers-color-scheme resolves against. AppsUseLightTheme=0
// means dark; a missing value (older Windows) counts as light.
func SystemPrefersDark() bool {
	const hkcu = 0x80000001
	const rrfRtRegDword = 0x00000010
	var val, size uint32 = 0, 4
	r, _, _ := procRegGetValueW.Call(
		hkcu,
		uintptr(unsafe.Pointer(utf16Ptr(`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`))),
		uintptr(unsafe.Pointer(utf16Ptr("AppsUseLightTheme"))),
		rrfRtRegDword,
		0,
		uintptr(unsafe.Pointer(&val)),
		uintptr(unsafe.Pointer(&size)),
	)
	return r == 0 && val == 0
}

// scriptBrushFor returns the background brush for a colour, rebuilding it
// when the scheme changes. The previous brush is released only once the new
// one exists, so a repaint never finds nothing to paint with.
func scriptBrushFor(bg uint32) uintptr {
	scriptMu.Lock()
	defer scriptMu.Unlock()
	if scriptBrush != 0 && scriptBrushBg == bg {
		return scriptBrush
	}
	b, _, _ := procCreateSolidBrush.Call(uintptr(bg))
	if b == 0 {
		return scriptBrush
	}
	old := scriptBrush
	scriptBrush, scriptBrushBg = b, bg
	if old != 0 {
		_, _, _ = procDeleteObject.Call(old)
	}
	return scriptBrush
}

// scriptScrollInterval turns lines per minute into a timer period — the
// fallback cadence for a whole-line scroll when the line height is unknown.
func scriptScrollInterval(speed int) uintptr {
	if speed < scriptSpeedMin {
		speed = scriptSpeedMin
	}
	if speed > scriptSpeedMax {
		speed = scriptSpeedMax
	}
	return uintptr(60_000 / speed)
}

// scriptScrollPixelsPerTick is how many pixels the smooth scroll advances each
// tick to hold the requested lines-per-minute pace.
func scriptScrollPixelsPerTick(speed int, lineH int32) float64 {
	if speed < scriptSpeedMin {
		speed = scriptSpeedMin
	}
	if speed > scriptSpeedMax {
		speed = scriptSpeedMax
	}
	pxPerSec := float64(lineH) * float64(speed) / 60.0
	return pxPerSec * float64(scriptScrollTickMs) / 1000.0
}

// scriptLineHeight measures the EDIT control's line height with its own font,
// so the smooth scroll knows when a sub-line offset has grown into a full line.
func scriptLineHeight(edit uintptr) int32 {
	dc, _, _ := procGetDC.Call(edit)
	if dc == 0 {
		return 0
	}
	defer procReleaseDC.Call(edit, dc)
	if scriptFont != 0 {
		_, _, _ = procSelectObject.Call(dc, scriptFont)
	}
	var tm textMetricW
	if r, _, _ := procGetTextMetricsW.Call(dc, uintptr(unsafe.Pointer(&tm))); r == 0 {
		return 0
	}
	return tm.tmHeight + tm.tmExternalLeading
}

// scriptMoveEdit positions the edit control at a sub-line vertical offset
// (0 = flush), sized to the window's client area.
func scriptMoveEdit(hwnd, edit uintptr, offset int32) {
	if hwnd == 0 || edit == 0 {
		return
	}
	var rc winRect
	_, _, _ = procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
	w := rc.right - rc.left
	h := rc.bottom - rc.top
	// The edit's top `offset` pixels clip against the parent; the `offset`
	// pixels of parent background revealed at the bottom share the edit's
	// colour, so the shift reads as smooth motion with no seam.
	_, _, _ = procMoveWindow.Call(edit, 0, uintptr(-int(offset)), uintptr(w), uintptr(h), 1)
}

// scriptResetScrollOffset clears the sub-line offset and puts the edit flush
// against the top of its client area.
func scriptResetScrollOffset() {
	scriptMu.Lock()
	edit, hwnd := scriptEdit, scriptHwnd
	scriptScrollAcc = 0
	scriptMu.Unlock()
	scriptMoveEdit(hwnd, edit, 0)
}

// applyScriptScroll starts, restarts, or stops the window's auto-scroll.
func applyScriptScroll(hwnd uintptr, opts ScriptWindowOptions) {
	if hwnd == 0 {
		return
	}
	if !opts.Scroll {
		_, _, _ = procKillTimer.Call(hwnd, scriptScrollTimer)
		scriptResetScrollOffset()
		return
	}
	scriptMu.Lock()
	edit := scriptEdit
	if scriptLineH == 0 && edit != 0 {
		scriptLineH = scriptLineHeight(edit)
	}
	lineH := scriptLineH
	if lineH > 0 {
		scriptScrollDy = scriptScrollPixelsPerTick(opts.Speed, lineH)
	}
	scriptMu.Unlock()

	// SetTimer with an existing id replaces the period in place. With a known
	// line height the scroll is pixel-smooth at a fixed high tick rate; without
	// it, fall back to a whole line at the reading cadence.
	if lineH > 0 {
		_, _, _ = procSetTimer.Call(hwnd, scriptScrollTimer, uintptr(scriptScrollTickMs), 0)
	} else {
		_, _, _ = procSetTimer.Call(hwnd, scriptScrollTimer, scriptScrollInterval(opts.Speed), 0)
	}
}

// applyScriptTopmost moves the window into or out of the topmost band
// without touching its position, size or focus.
func applyScriptTopmost(hwnd uintptr, onTop bool) {
	band := hwndNoTopmost
	if onTop {
		band = hwndTopmost
	}
	_, _, _ = procSetWindowPos.Call(hwnd, band, 0, 0, 0, 0,
		swpNoMove|swpNoSize|swpNoActivate)
}

// SetScriptWindowTopmost applies keep-on-top to the open script window; with
// no window open there is nothing to move and the preference just persists.
func SetScriptWindowTopmost(onTop bool) error {
	scriptMu.Lock()
	hwnd := scriptHwnd
	scriptOpts.Topmost = onTop
	scriptMu.Unlock()
	if hwnd != 0 {
		applyScriptTopmost(hwnd, onTop)
	}
	return nil
}

// SetScriptWindowOptions applies a fresh set of teleprompter settings to the
// window that is already open — the colours repaint, the scroll restarts at
// the new speed (or stops), and the title bar follows the scheme. With no
// window open the settings are simply remembered for the next one.
func SetScriptWindowOptions(opts ScriptWindowOptions) error {
	scriptMu.Lock()
	hwnd, edit := scriptHwnd, scriptEdit
	scriptOpts = opts
	scriptMu.Unlock()
	if hwnd == 0 {
		return nil
	}
	applyScriptTheme(hwnd, opts.Dark)
	applyScriptTopmost(hwnd, opts.Topmost)
	applyScriptScroll(hwnd, opts)
	_, _, _ = procInvalidateRect.Call(hwnd, 0, 1)
	_, _, _ = procInvalidateRect.Call(edit, 0, 1)
	return nil
}

// applyScriptTheme records the resolved theme and flips the title bar to
// match; the client colors follow via WM_CTLCOLOR* on the next paint.
func applyScriptTheme(hwnd uintptr, dark bool) {
	scriptMu.Lock()
	scriptDark = dark
	scriptMu.Unlock()
	if hwnd != 0 {
		val := int32(0)
		if dark {
			val = 1
		}
		_, _, _ = procDwmSetWindowAttr.Call(hwnd, dwmaUseImmersiveDarkMode,
			uintptr(unsafe.Pointer(&val)), unsafe.Sizeof(val))
	}
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

// OpenScriptWindow shows the plan's script in the process-owned side window,
// creating it (on a dedicated message-loop thread) or updating the one
// already open. The window is dressed and driven by opts — its colours,
// whether it keeps above other windows, and the auto-scroll. The caller
// re-applies the capture affinity afterwards.
func OpenScriptWindow(title, text string, opts ScriptWindowOptions) error {
	// The EDIT control needs CRLF line endings.
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")

	scriptMu.Lock()
	hwnd, edit := scriptHwnd, scriptEdit
	scriptOpts = opts
	scriptMu.Unlock()
	if hwnd != 0 {
		applyScriptTheme(hwnd, opts.Dark)
		applyScriptTopmost(hwnd, opts.Topmost)
		_, _, _ = procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(utf16Ptr(title))))
		_, _, _ = procSetWindowTextW.Call(edit, uintptr(unsafe.Pointer(utf16Ptr(text))))
		_, _, _ = procInvalidateRect.Call(edit, 0, 1)
		// A re-opened prompter reads from the top again, with no carried-over
		// sub-line offset.
		_, _, _ = procSendMessageW.Call(edit, emLineScroll, 0, 0)
		scriptResetScrollOffset()
		applyScriptScroll(hwnd, opts)
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
		// Theme before first paint: dark title bar plus the palette the
		// WM_CTLCOLOR*/WM_ERASEBKGND handlers answer with.
		applyScriptTheme(hwnd, opts.Dark)
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
		if opts.Topmost {
			applyScriptTopmost(hwnd, true)
		}
		applyScriptScroll(hwnd, opts)
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

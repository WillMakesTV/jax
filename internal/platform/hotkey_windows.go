//go:build windows

package platform

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Keystroke synthesis for routine "hotkey" steps (Stream Deck Hotkey buttons)
// via user32 SendInput: modifiers down, key down, key up, modifiers up — the
// same system-wide press the Stream Deck software performs, so global
// shortcuts (OBS hotkeys, scene switchers, other tools) all respond.

var (
	user32        = syscall.NewLazyDLL("user32.dll")
	procSendInput = user32.NewProc("SendInput")
)

const (
	vkShift = 0x10
	vkCtrl  = 0x11
	vkAlt   = 0x12
	vkLWin  = 0x5B

	keyeventfKeyUp = 0x0002
	inputKeyboard  = 1
)

// winInput mirrors the Win64 INPUT struct: a 4-byte type (padded to 8 for
// union alignment), the KEYBDINPUT union member, and padding out to the
// union's full size (MOUSEINPUT, 32 bytes).
type winInput struct {
	inputType uint32
	_         uint32
	vk        uint16
	scan      uint16
	flags     uint32
	time      uint32
	extraInfo uintptr
	_         [8]byte
}

func keyEvent(vk uint16, up bool) winInput {
	in := winInput{inputType: inputKeyboard, vk: vk}
	if up {
		in.flags = keyeventfKeyUp
	}
	return in
}

// PressHotkey sends the shortcut as one SendInput batch so no other input can
// interleave between the modifier and key events.
func PressHotkey(vkey int, ctrl, shift, alt, win bool) error {
	var keys []uint16
	if ctrl {
		keys = append(keys, vkCtrl)
	}
	if shift {
		keys = append(keys, vkShift)
	}
	if alt {
		keys = append(keys, vkAlt)
	}
	if win {
		keys = append(keys, vkLWin)
	}
	keys = append(keys, uint16(vkey))

	inputs := make([]winInput, 0, len(keys)*2)
	for _, vk := range keys {
		inputs = append(inputs, keyEvent(vk, false))
	}
	for i := len(keys) - 1; i >= 0; i-- {
		inputs = append(inputs, keyEvent(keys[i], true))
	}

	sent, _, err := procSendInput.Call(
		uintptr(len(inputs)),
		uintptr(unsafe.Pointer(&inputs[0])),
		unsafe.Sizeof(inputs[0]),
	)
	if int(sent) != len(inputs) {
		return fmt.Errorf("the keystroke could not be sent: %v", err)
	}
	return nil
}

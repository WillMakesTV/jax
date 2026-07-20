package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// ---------------------------------------------------------------------------
// System stream widgets
//
// Alongside the producer-built stream widgets (widgets.go), the app ships a
// small catalog of built-in Browser Sources — fully implemented overlays
// that only need enabling and pointing OBS at. They are enabled by default;
// the producer can switch each off from the Stream Widgets tab, which 404s
// its page so a forgotten OBS source goes dark instead of half-working.
//
// The first system widget is Unified Chat: the same merged all-channel chat
// the Broadcasting page shows, as an overlay, with an input that sends a
// reply to every connected channel at once (SendBroadcastChat).
// ---------------------------------------------------------------------------

// systemWidgetPrefix serves the built-in widget pages and their endpoints.
const systemWidgetPrefix = "/syswidget/"

// systemWidgetUnifiedChat identifies the built-in unified chat overlay.
const systemWidgetUnifiedChat = "unified-chat"

// SystemWidget is one built-in Browser Source.
type SystemWidget struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	// SourceURL is the widget's local OBS Browser Source address, derived
	// on read and never persisted.
	SourceURL string `json:"sourceUrl"`
}

// systemWidgetCatalog lists the built-in widgets, in display order. Enabled
// and SourceURL are filled per read.
var systemWidgetCatalog = []SystemWidget{
	{
		ID:   systemWidgetUnifiedChat,
		Name: "Unified Chat",
		Description: "Every connected channel's chat merged into one overlay — the same feed as the " +
			"Broadcasting page — with a box that sends your reply to all channels at once.",
	},
}

// keySystemWidgetsDisabled stores the ids the producer switched OFF (the
// catalog defaults to enabled, so absence means on).
const keySystemWidgetsDisabled = "system_widgets_disabled"

// systemWidgetsDisabled loads the switched-off id set. Never nil.
func (a *App) systemWidgetsDisabled() map[string]bool {
	m := map[string]bool{}
	if a.store != nil {
		if _, err := a.store.getJSON(keySystemWidgetsDisabled, &m); err != nil {
			log.Printf("jax: load system widget state: %v", err)
		}
	}
	if m == nil {
		return map[string]bool{}
	}
	return m
}

// systemWidgetEnabled reports whether a catalog widget is switched on.
func (a *App) systemWidgetEnabled(id string) bool {
	for _, sw := range systemWidgetCatalog {
		if sw.ID == id {
			return !a.systemWidgetsDisabled()[id]
		}
	}
	return false
}

// GetSystemWidgets returns the built-in widget catalog with each entry's
// enabled state and Browser Source address. Never nil.
func (a *App) GetSystemWidgets() []SystemWidget {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()
	disabled := a.systemWidgetsDisabled()

	out := make([]SystemWidget, 0, len(systemWidgetCatalog))
	for _, sw := range systemWidgetCatalog {
		sw.Enabled = !disabled[sw.ID]
		if base != "" {
			sw.SourceURL = base + systemWidgetPrefix + url.PathEscape(sw.ID)
		}
		out = append(out, sw)
	}
	return out
}

// SetSystemWidgetEnabled switches one built-in widget on or off and returns
// the updated catalog. Disabling 404s the widget's page, so an OBS source
// left pointing at it goes dark rather than half-working.
func (a *App) SetSystemWidgetEnabled(id string, enabled bool) ([]SystemWidget, error) {
	if a.store == nil {
		return nil, fmt.Errorf("storage unavailable")
	}
	known := false
	for _, sw := range systemWidgetCatalog {
		if sw.ID == id {
			known = true
			break
		}
	}
	if !known {
		return nil, fmt.Errorf("no system widget %q", id)
	}
	disabled := a.systemWidgetsDisabled()
	if enabled {
		delete(disabled, id)
	} else {
		disabled[id] = true
	}
	if err := a.store.setJSON(keySystemWidgetsDisabled, disabled); err != nil {
		return nil, err
	}
	return a.GetSystemWidgets(), nil
}

// serveSystemWidget handles everything under /syswidget/: each built-in
// widget's page and its data/send endpoints. Disabled or unknown widgets
// 404 wholesale.
func (a *App) serveSystemWidget(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, systemWidgetPrefix)
	id, action, _ := strings.Cut(rest, "/")
	if !a.systemWidgetEnabled(id) {
		http.NotFound(w, r)
		return
	}
	switch id {
	case systemWidgetUnifiedChat:
		a.serveUnifiedChat(w, r, action)
	default:
		http.NotFound(w, r)
	}
}

// serveUnifiedChat is the unified chat overlay: the page, its message feed,
// and the broadcast-to-all send endpoint.
func (a *App) serveUnifiedChat(w http.ResponseWriter, r *http.Request, action string) {
	switch action {
	case "":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(unifiedChatPage))
	case "data":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"messages": a.GetChatHistory(150),
		})
	case "send":
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			Message string `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(a.SendBroadcastChat(in.Message))
	default:
		http.NotFound(w, r)
	}
}

// unifiedChatPage is the overlay itself: a transparent page with the merged
// chat pinned to the bottom and a send box that broadcasts to every
// connected channel. Message content is rendered via textContent only —
// chat text never becomes markup.
const unifiedChatPage = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Unified Chat</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: transparent; }
  #wrap {
    display: flex; flex-direction: column; height: 100vh;
    box-sizing: border-box; padding: 12px;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  }
  #list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  #list > :first-child { margin-top: auto; }
  #list::-webkit-scrollbar { width: 0; }
  .msg {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px; padding: 6px 10px;
    color: #fff; font-size: 15px; line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .plat {
    display: inline-block; vertical-align: 1px; margin-right: 6px;
    font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.06em; padding: 1px 6px; border-radius: 999px; color: #fff;
  }
  .author { font-weight: 700; margin-right: 6px; }
  #form { display: flex; gap: 8px; margin-top: 10px; }
  #input {
    flex: 1; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 10px;
    background: rgba(15, 23, 42, 0.9); color: #fff;
    padding: 8px 12px; font-size: 14px; outline: none;
  }
  #input:focus { border-color: rgba(255, 255, 255, 0.6); }
  #send {
    border: 0; border-radius: 10px; background: #6366f1; color: #fff;
    padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  #send:disabled { opacity: 0.5; cursor: default; }
  #note { min-height: 16px; margin-top: 4px; font-size: 11px; color: #fca5a5; }
</style>
</head>
<body>
<div id="wrap">
  <div id="list"></div>
  <form id="form">
    <input id="input" placeholder="Message all channels…" autocomplete="off">
    <button id="send" type="submit">Send</button>
  </form>
  <div id="note"></div>
</div>
<script>
(function () {
  'use strict'
  var base = location.pathname.replace(/\/$/, '')
  var list = document.getElementById('list')
  var form = document.getElementById('form')
  var input = document.getElementById('input')
  var send = document.getElementById('send')
  var note = document.getElementById('note')
  var lastJSON = ''
  var noteTimer = 0

  var PLATFORM_COLORS = {
    twitch: '#9146FF', youtube: '#FF0000', kick: '#53FC18',
    facebook: '#1877F2', instagram: '#E1306C', x: '#444444', tiktok: '#111111',
  }

  function render(messages) {
    // Only re-scroll when the view is already pinned to the newest messages,
    // so scrolling back to read is not fought by the poll.
    var pinned =
      list.scrollTop + list.clientHeight >= list.scrollHeight - 40
    list.textContent = ''
    messages.forEach(function (m) {
      var row = document.createElement('div')
      row.className = 'msg'
      var plat = document.createElement('span')
      plat.className = 'plat'
      plat.textContent = m.platform
      plat.style.background = PLATFORM_COLORS[m.platform] || '#555555'
      row.appendChild(plat)
      var author = document.createElement('span')
      author.className = 'author'
      author.textContent = m.author
      if (m.color) author.style.color = m.color
      row.appendChild(author)
      row.appendChild(document.createTextNode(m.text))
      list.appendChild(row)
    })
    if (pinned) list.scrollTop = list.scrollHeight
  }

  function tick() {
    fetch(base + '/data', {cache: 'no-store'})
      .then(function (res) { return res.text() })
      .then(function (text) {
        if (text === lastJSON) return
        lastJSON = text
        render(JSON.parse(text).messages || [])
      })
      .catch(function () {})
  }

  function showNote(text) {
    note.textContent = text
    window.clearTimeout(noteTimer)
    if (text) noteTimer = window.setTimeout(function () { note.textContent = '' }, 5000)
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    var message = input.value.trim()
    if (!message) return
    send.disabled = true
    fetch(base + '/send', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: message}),
    })
      .then(function (res) { return res.json() })
      .then(function (results) {
        var errors = (results || [])
          .filter(function (r) { return r.error })
          .map(function (r) { return r.platform + ': ' + r.error })
        showNote(errors.join(' · '))
        input.value = ''
        lastJSON = ''
        tick()
      })
      .catch(function (err) { showNote(String(err)) })
      .finally(function () { send.disabled = false })
  })

  tick()
  setInterval(tick, 2000)
})()
</script>
</body>
</html>
`

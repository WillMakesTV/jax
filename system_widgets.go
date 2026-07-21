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
		// The overlay shows the broadcast on the air: the active session's
		// chat and events only, matching the Broadcasting page's live feed.
		// Between sessions the page explains itself instead of replaying
		// history.
		session := a.GetActiveStreamSession()
		// Each row names the channel it came from, so the merged column says
		// where a message landed.
		channels := map[string]string{}
		for _, s := range a.GetServiceStatuses() {
			if s.Connected && s.Account != "" {
				channels[s.Name] = s.Account
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"sessionActive": session.Active,
			"messages":      a.GetSessionChatHistory(150),
			// Follows, subs, gifts, and raids, run inline with the chat.
			"events":   a.GetSessionLiveEvents(50),
			"channels": channels,
		})
	case "user":
		// The user card behind clicking a message: profile info, the
		// chatter's stored messages, and — on Twitch — the popout viewer
		// card, which carries the platform's own ban/timeout/mod controls.
		q := r.URL.Query()
		platform, id, login := q.Get("platform"), q.Get("id"), q.Get("login")
		resp := map[string]any{
			"messages": a.chatMessagesByAuthor(platform, id, login, q.Get("author"), 50),
		}
		if info, err := a.GetChatUserInfo(platform, id, login); err == nil {
			resp["info"] = info
		} else {
			resp["infoError"] = err.Error()
		}
		if platform == "twitch" && login != "" {
			if conn, ok := a.getConn("twitch"); ok && conn.login != "" {
				resp["modUrl"] = "https://www.twitch.tv/popout/" + url.PathEscape(conn.login) +
					"/viewercard/" + url.PathEscape(strings.ToLower(login))
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp)
	case "moderate":
		// Timeout or ban the chatter on their own platform (see
		// moderation.go); seconds <= 0 is a permanent ban.
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			Platform string `json:"platform"`
			UserID   string `json:"userId"`
			Seconds  int    `json:"seconds"`
			Reason   string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		resp := map[string]any{"ok": true}
		if err := a.TimeoutChatUser(in.Platform, in.UserID, in.Seconds, in.Reason); err != nil {
			resp = map[string]any{"ok": false, "error": err.Error()}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp)
	case "delete":
		// Remove one message from the platform's chat and from the log, so
		// it leaves the stream and every Jax surface at once.
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			Platform  string `json:"platform"`
			MessageID string `json:"messageId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		resp := map[string]any{"ok": true}
		if err := a.DeleteChatMessage(in.Platform, in.MessageID); err != nil {
			resp = map[string]any{"ok": false, "error": err.Error()}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp)
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

// unifiedChatPage is the overlay itself: a dark-gray chat column pinned
// to the newest messages — the active session's chat, with its follows,
// subs, gifts, and raids inline on the same timeline — with avatars,
// hover timestamps, a click-through user card (profile, their stored
// messages, and Twitch's popout viewer card for ban/timeout/mod actions),
// and a send box that broadcasts to every connected channel. Message
// content is rendered as text nodes only — chat text never becomes markup;
// the one exception is Kick's emote markup, which becomes an <img> built
// from the emote's numeric id (see appendBody).
const unifiedChatPage = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Unified Chat</title>
<style>
  html, body {
    margin: 0; padding: 0; height: 100%;
    /* The page itself is dark gray, edge to edge — a transparent page shows
       white corners in a browser, and the user-card overlay lives outside
       #wrap, so the font rides on body where everything inherits it. */
    background: #1f2937;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  }
  #wrap {
    display: flex; flex-direction: column; height: 100vh;
    box-sizing: border-box; padding: 12px;
  }
  #list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  #list > :first-child { margin-top: auto; }
  #list::-webkit-scrollbar { width: 0; }
  #empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: rgba(255, 255, 255, 0.45); font-size: 14px; text-align: center;
  }
  .msg {
    position: relative;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 10px; padding: 6px 10px;
    color: #fff; font-size: 15px; line-height: 1.35;
    overflow-wrap: anywhere; cursor: pointer;
  }
  .msg:hover { background: rgba(255, 255, 255, 0.1); }
  .avatar {
    width: 20px; height: 20px; border-radius: 50%; object-fit: cover;
    vertical-align: -5px; margin-right: 6px;
  }
  .avatar-fallback {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%; vertical-align: -5px;
    margin-right: 6px; font-size: 10px; font-weight: 800; color: #fff;
  }
  .plat {
    display: inline-block; vertical-align: 1px; margin-right: 6px;
    font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.06em; padding: 1px 6px; border-radius: 999px; color: #fff;
  }
  .author { font-weight: 700; margin-right: 6px; }
  /* Kick emotes, drawn inline at line height (see appendBody). */
  .emote { height: 22px; width: auto; vertical-align: -5px; }
  .past .emote { height: 18px; vertical-align: -4px; }
  /* Live events (follow, sub, gift, raid) sit in the chat's flow, tinted by
     kind so they read as moments rather than messages. */
  .evt { cursor: default; border-color: rgba(255, 255, 255, 0.2); }
  .evt:hover { background: rgba(255, 255, 255, 0.06); }
  .evt .author { margin-right: 4px; }
  .evt-icon {
    display: inline-block; margin-right: 6px; font-size: 14px;
    vertical-align: 0; color: inherit;
  }
  .evt-follow { background: rgba(83, 252, 24, 0.14); border-color: rgba(83, 252, 24, 0.35); }
  .evt-sub    { background: rgba(255, 196, 0, 0.14);  border-color: rgba(255, 196, 0, 0.38); }
  .evt-gift   { background: rgba(255, 122, 0, 0.14);  border-color: rgba(255, 122, 0, 0.38); }
  .evt-raid   { background: rgba(145, 70, 255, 0.18); border-color: rgba(145, 70, 255, 0.42); }
  .evt-cheer  { background: rgba(0, 176, 255, 0.14);  border-color: rgba(0, 176, 255, 0.38); }
  /* The row's corner: which channel it came from (always) plus the time and
     the delete control (on hover). Floated so long messages wrap under it
     instead of running beneath. */
  .corner {
    float: right; display: inline-flex; align-items: center; gap: 6px;
    margin: 1px 0 3px 10px;
  }
  .source {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 700; color: rgba(255, 255, 255, 0.65);
    max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .source svg { width: 13px; height: 13px; flex: none; fill: currentColor; }
  .time {
    font-size: 11px; color: rgba(255, 255, 255, 0.5);
    opacity: 0; transition: opacity 0.15s;
  }
  .msg:hover .time { opacity: 1; }
  .del {
    border: 0; background: transparent; padding: 0 2px; cursor: pointer;
    font-size: 12px; line-height: 1; color: rgba(255, 120, 120, 0.9);
    opacity: 0; transition: opacity 0.15s;
  }
  .msg:hover .del { opacity: 1; }
  .del:hover { color: #ff5252; }
  /* Moderation row in the chatter card. */
  .mods { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .mods button {
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px;
    background: rgba(255, 255, 255, 0.08); color: #fff;
    font-size: 12px; font-weight: 600; padding: 5px 10px; cursor: pointer;
  }
  .mods button:hover { background: rgba(255, 255, 255, 0.16); }
  .mods button.ban {
    border-color: rgba(255, 82, 82, 0.5); background: rgba(255, 82, 82, 0.18);
  }
  .mods button:disabled { opacity: 0.5; cursor: default; }
  .past .del { opacity: 0.6; }
  .past:hover .del { opacity: 1; }
  #form { display: flex; gap: 8px; margin-top: 10px; }
  #input {
    flex: 1; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 10px;
    background: rgba(0, 0, 0, 0.35); color: #fff;
    padding: 8px 12px; font-size: 14px; outline: none;
  }
  #input:focus { border-color: rgba(255, 255, 255, 0.6); }
  #send {
    border: 0; border-radius: 10px; background: #6366f1; color: #fff;
    padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  #send:disabled { opacity: 0.5; cursor: default; }
  #note { min-height: 16px; margin-top: 4px; font-size: 11px; color: #fca5a5; }
  #overlay {
    position: fixed; inset: 0; display: none; align-items: center;
    justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.55);
  }
  #overlay.open { display: flex; }
  #card {
    background: #111827; border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px; width: 100%; max-width: 420px; max-height: 82vh;
    overflow-y: auto; padding: 16px; color: #fff; box-sizing: border-box;
    font-size: 14px;
  }
  #card h3 { margin: 0; font-size: 16px; }
  #card .head { display: flex; align-items: center; gap: 10px; }
  #card .head img.avatar { width: 40px; height: 40px; }
  #card .close {
    margin-left: auto; border: 0; background: transparent; color: rgba(255, 255, 255, 0.6);
    font-size: 18px; cursor: pointer; padding: 2px 6px;
  }
  #card .stats { margin-top: 10px; color: rgba(255, 255, 255, 0.7); font-size: 12px; }
  #card .links { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  #card .links a {
    color: #fff; background: #374151; border-radius: 8px; padding: 5px 10px;
    font-size: 12px; font-weight: 600; text-decoration: none;
  }
  #card .links a.mod { background: #b91c1c; }
  #card .history { margin-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 10px; }
  #card .history h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255, 255, 255, 0.5); }
  #card .past { padding: 4px 0; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
  #card .past .t { color: rgba(255, 255, 255, 0.4); font-size: 11px; margin-right: 6px; }
</style>
</head>
<body>
<div id="wrap">
  <div id="empty" style="display: none"></div>
  <div id="list"></div>
  <form id="form">
    <input id="input" placeholder="Message all channels…" autocomplete="off">
    <button id="send" type="submit">Send</button>
  </form>
  <div id="note"></div>
</div>
<div id="overlay"><div id="card"></div></div>
<script>
(function () {
  'use strict'
  var base = location.pathname.replace(/\/$/, '')
  var list = document.getElementById('list')
  var empty = document.getElementById('empty')
  var form = document.getElementById('form')
  var input = document.getElementById('input')
  var send = document.getElementById('send')
  var note = document.getElementById('note')
  var overlay = document.getElementById('overlay')
  var card = document.getElementById('card')
  var lastJSON = ''
  var noteTimer = 0

  var PLATFORM_COLORS = {
    twitch: '#9146FF', youtube: '#FF0000', kick: '#53FC18',
    facebook: '#1877F2', instagram: '#E1306C', x: '#444444', tiktok: '#111111',
  }

  // The event feed's vocabulary (see the events provider): one glyph each.
  var EVENT_ICONS = {
    follow: '♥', sub: '★', gift: '🎁', raid: '⚑', cheer: '◆',
  }

  // Brand marks for the row's channel-source badge, the same paths the app's
  // BrandIcons draw.
  var PLATFORM_PATHS = {
    twitch: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z',
    youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
    kick: 'M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z',
  }

  var channels = {}

  function platformLabel(platform) {
    return channels[platform] || platform
  }

  // Logo + channel name, inline: the source badge every row carries.
  function sourceEl(platform) {
    var wrap = document.createElement('span')
    wrap.className = 'source'
    var path = PLATFORM_PATHS[platform]
    if (path) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', path)
      svg.appendChild(p)
      svg.style.color = PLATFORM_COLORS[platform] || '#ffffff'
      wrap.appendChild(svg)
    }
    var name = document.createElement('span')
    name.textContent = platformLabel(platform)
    wrap.appendChild(name)
    return wrap
  }

  // The row's top-right corner: source badge, hover timestamp, and — for a
  // deletable message — the remove control.
  function cornerEl(item, deletable) {
    var corner = document.createElement('span')
    corner.className = 'corner'
    if (deletable) {
      var del = document.createElement('button')
      del.className = 'del'
      del.type = 'button'
      del.title = 'Remove this message from chat'
      del.textContent = '✕'
      del.addEventListener('click', function (ev) {
        ev.stopPropagation()
        deleteMessage(item)
      })
      corner.appendChild(del)
    }
    var time = document.createElement('span')
    time.className = 'time'
    time.textContent = fmtTime(item.at)
    corner.appendChild(time)
    corner.appendChild(sourceEl(item.platform))
    return corner
  }

  // Removing a message here removes it from the platform's chat too; the
  // next poll drops the row, so nothing is hidden that is still live.
  function deleteMessage(m) {
    fetch(base + '/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({platform: m.platform, messageId: m.id}),
    })
      .then(function (res) { return res.json() })
      .then(function (data) {
        if (data && data.ok) {
          lastJSON = ''
          tick()
        } else {
          showNote((data && data.error) || 'The message could not be removed.')
        }
      })
      .catch(function (err) { showNote(String(err)) })
  }

  function fmtTime(at) {
    var d = new Date(at)
    var h = d.getHours(), m = d.getMinutes()
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
  }

  function avatarEl(m) {
    if (m.avatarUrl) {
      var img = document.createElement('img')
      img.className = 'avatar'
      img.src = m.avatarUrl
      img.alt = ''
      return img
    }
    var span = document.createElement('span')
    span.className = 'avatar-fallback'
    span.textContent = (m.author || '?').charAt(0).toUpperCase()
    span.style.background = m.color || PLATFORM_COLORS[m.platform] || '#555555'
    return span
  }

  // Kick inlines its emotes in the message as "[emote:12345:catJAM]"; draw
  // them from Kick's file host, keyed on the id (digits only, so nothing a
  // chatter types can escape into the URL). Text still goes in as text
  // nodes — chat content never becomes markup.
  var EMOTE_RE = /\[emote:(\d+):([^\]]*)\]/g

  function appendBody(parent, m) {
    var source = m.richText || ''
    if (!source) {
      parent.appendChild(document.createTextNode(m.text || ''))
      return
    }
    var last = 0
    EMOTE_RE.lastIndex = 0
    for (var hit = EMOTE_RE.exec(source); hit; hit = EMOTE_RE.exec(source)) {
      if (hit.index > last) {
        parent.appendChild(document.createTextNode(source.slice(last, hit.index)))
      }
      var img = document.createElement('img')
      img.className = 'emote'
      img.src = 'https://files.kick.com/emotes/' + hit[1] + '/fullsize'
      img.alt = hit[2]
      img.title = hit[2]
      parent.appendChild(img)
      last = hit.index + hit[0].length
    }
    if (last < source.length) {
      parent.appendChild(document.createTextNode(source.slice(last)))
    }
  }

  function msgRow(m) {
    var row = document.createElement('div')
    row.className = 'msg'
    row.title = 'View this chatter'
    // The corner floats, so it goes in before the text it wraps around.
    row.appendChild(cornerEl(m, true))
    row.appendChild(avatarEl(m))
    var author = document.createElement('span')
    author.className = 'author'
    author.textContent = m.author
    if (m.color) author.style.color = m.color
    row.appendChild(author)
    appendBody(row, m)
    row.addEventListener('click', function () { openUser(m) })
    return row
  }

  // A follow/sub/gift/raid, in the chat's flow: same row shape, its own
  // colour, and the event's icon in place of an avatar.
  function evtRow(e) {
    var row = document.createElement('div')
    row.className = 'msg evt evt-' + (e.type || 'follow')
    row.appendChild(cornerEl(e, false))
    var icon = document.createElement('span')
    icon.className = 'evt-icon'
    icon.textContent = EVENT_ICONS[e.type] || '★'
    row.appendChild(icon)
    var author = document.createElement('span')
    author.className = 'author'
    author.textContent = e.author
    row.appendChild(author)
    row.appendChild(document.createTextNode(e.detail || ''))
    return row
  }

  function render(data) {
    var messages = data.messages || []
    var events = data.events || []
    channels = data.channels || {}
    if (messages.length === 0 && events.length === 0) {
      list.style.display = 'none'
      empty.style.display = 'flex'
      empty.textContent = data.sessionActive
        ? 'No chat yet — messages appear as they arrive.'
        : 'Chat appears here once a stream session is live.'
      return
    }
    empty.style.display = 'none'
    list.style.display = 'flex'
    // Only re-scroll when the view is already pinned to the newest messages,
    // so scrolling back to read is not fought by the poll.
    var pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 40
    list.textContent = ''
    // Chat and events share one timeline, oldest first.
    var rows = []
    messages.forEach(function (m) {
      rows.push({at: m.at, build: function () { return msgRow(m) }})
    })
    events.forEach(function (e) {
      rows.push({at: e.at, build: function () { return evtRow(e) }})
    })
    rows.sort(function (a, b) { return a.at - b.at })
    rows.forEach(function (r) { list.appendChild(r.build()) })
    if (pinned) list.scrollTop = list.scrollHeight
  }

  function line(parent, text, cls) {
    var p = document.createElement('div')
    if (cls) p.className = cls
    p.textContent = text
    parent.appendChild(p)
    return p
  }

  // Timeout/ban buttons for the chatter card. The action runs on the
  // chatter's own platform (see moderation.go); whatever the platform says
  // comes back on the button row rather than being swallowed.
  function modControls(m) {
    var wrap = document.createElement('div')
    wrap.className = 'mods'
    var status = document.createElement('span')
    status.className = 'stats'

    var run = function (seconds, label) {
      var buttons = wrap.querySelectorAll('button')
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true
      status.textContent = label + '…'
      fetch(base + '/moderate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          platform: m.platform,
          userId: m.authorId || '',
          seconds: seconds,
        }),
      })
        .then(function (res) { return res.json() })
        .then(function (data) {
          status.textContent = data && data.ok ? label + ' — done' : (data && data.error) || 'That failed.'
        })
        .catch(function (err) { status.textContent = String(err) })
        .then(function () {
          for (var i = 0; i < buttons.length; i++) buttons[i].disabled = false
        })
    }

    var add = function (text, seconds, cls) {
      var b = document.createElement('button')
      b.type = 'button'
      if (cls) b.className = cls
      b.textContent = text
      b.addEventListener('click', function () { run(seconds, text) })
      wrap.appendChild(b)
    }
    add('Timeout 10m', 600)
    add('Timeout 1h', 3600)
    add('Ban', 0, 'ban')
    wrap.appendChild(status)
    return wrap
  }

  function closeCard() { overlay.className = '' }
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeCard()
  })

  // The user card: profile info, the chatter's stored messages, and — on
  // Twitch — the popout viewer card carrying ban/timeout/mod controls.
  function openUser(m) {
    overlay.className = 'open'
    card.textContent = ''
    var head = document.createElement('div')
    head.className = 'head'
    head.appendChild(avatarEl(m))
    var h3 = document.createElement('h3')
    h3.textContent = m.author
    if (m.color) h3.style.color = m.color
    head.appendChild(h3)
    var plat = document.createElement('span')
    plat.className = 'plat'
    plat.textContent = m.platform
    plat.style.background = PLATFORM_COLORS[m.platform] || '#555555'
    head.appendChild(plat)
    var close = document.createElement('button')
    close.className = 'close'
    close.type = 'button'
    close.textContent = '✕'
    close.addEventListener('click', closeCard)
    head.appendChild(close)
    card.appendChild(head)
    var loading = line(card, 'Loading…', 'stats')

    var params =
      'platform=' + encodeURIComponent(m.platform) +
      '&id=' + encodeURIComponent(m.authorId || '') +
      '&login=' + encodeURIComponent(m.authorLogin || '') +
      '&author=' + encodeURIComponent(m.author || '')
    fetch(base + '/user?' + params, {cache: 'no-store'})
      .then(function (res) { return res.json() })
      .then(function (data) {
        loading.remove()
        var info = data.info
        if (info) {
          if (info.avatarUrl) {
            var old = head.querySelector('.avatar, .avatar-fallback')
            if (old && old.tagName !== 'IMG') {
              var real = document.createElement('img')
              real.className = 'avatar'
              real.src = info.avatarUrl
              real.alt = ''
              head.replaceChild(real, old)
            }
          }
          var bits = []
          if (info.follower && info.follower !== 'unknown') bits.push('Follower: ' + info.follower)
          if (info.subscriber && info.subscriber !== 'unknown') {
            bits.push('Subscriber: ' + info.subscriber + (info.subTier ? ' (' + info.subTier + ')' : ''))
          }
          if (info.createdAt) bits.push('Since ' + new Date(info.createdAt).toLocaleDateString())
          if (bits.length) line(card, bits.join(' · '), 'stats')
          if (info.description) line(card, info.description, 'stats')
        } else if (data.infoError) {
          line(card, data.infoError, 'stats')
        }
        var links = document.createElement('div')
        links.className = 'links'
        if (info && info.channelUrl) {
          var a1 = document.createElement('a')
          a1.href = info.channelUrl
          a1.target = '_blank'
          a1.rel = 'noreferrer'
          a1.textContent = 'Open channel'
          links.appendChild(a1)
        }
        if (data.modUrl) {
          var a2 = document.createElement('a')
          a2.href = data.modUrl
          a2.target = '_blank'
          a2.rel = 'noreferrer'
          a2.className = 'mod'
          a2.textContent = 'Open on ' + platformLabel('twitch')
          links.appendChild(a2)
        }
        if (links.childNodes.length) card.appendChild(links)
        card.appendChild(modControls(m))
        var hist = document.createElement('div')
        hist.className = 'history'
        var h4 = document.createElement('h4')
        h4.textContent = 'Recent messages'
        hist.appendChild(h4)
        var past = data.messages || []
        if (past.length === 0) {
          line(hist, 'No stored messages from this chatter.', 'past')
        } else {
          past.forEach(function (pm) {
            var row = document.createElement('div')
            row.className = 'past'
            var del = document.createElement('button')
            del.className = 'del'
            del.type = 'button'
            del.title = 'Remove this message from chat'
            del.textContent = '✕'
            del.addEventListener('click', function () {
              deleteMessage(pm)
              row.remove()
            })
            row.appendChild(del)
            var t = document.createElement('span')
            t.className = 't'
            t.textContent = fmtTime(pm.at)
            row.appendChild(t)
            appendBody(row, pm)
            hist.appendChild(row)
          })
        }
        card.appendChild(hist)
      })
      .catch(function (err) { loading.textContent = String(err) })
  }

  function tick() {
    fetch(base + '/data', {cache: 'no-store'})
      .then(function (res) { return res.text() })
      .then(function (text) {
        if (text === lastJSON) return
        lastJSON = text
        render(JSON.parse(text))
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

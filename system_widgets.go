package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
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
// reply to every connected channel at once (SendBroadcastChat). The second is
// Sponsors: the saved brand partners on rotation, each with its logo, name,
// and website. The third is Issue Tracker: the debug-report queue live on
// screen, each report and its status, drawn straight from the queue so it
// never falls out of date. The fourth is Active Project: the project being
// worked on right now, following it live. The fifth is Event Feed: every
// earned follow, sub, gift, cheer and raid as one scrolling history, divided
// by the stream each came from.
//
// Issue Tracker and Active Project render through the same display pipeline as
// a producer's own stream widgets (widget_source.go) — a JSX template, CSS and
// JS run by React — and transfer their look from the matching custom widget,
// snapshotting it so it survives that widget's deletion (see the "System
// widget displays" section below).
// ---------------------------------------------------------------------------

// systemWidgetPrefix serves the built-in widget pages and their endpoints.
const systemWidgetPrefix = "/syswidget/"

// systemWidgetUnifiedChat identifies the built-in unified chat overlay.
const systemWidgetUnifiedChat = "unified-chat"

// systemWidgetSponsors identifies the built-in sponsors overlay.
const systemWidgetSponsors = "sponsors"

// systemWidgetIssueTracker identifies the built-in issue-tracker overlay.
const systemWidgetIssueTracker = "issue-tracker"

// systemWidgetActiveProject identifies the built-in active-project overlay.
const systemWidgetActiveProject = "active-project"

// systemWidgetEventFeed identifies the built-in event-feed overlay.
const systemWidgetEventFeed = "event-feed"

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
	{
		ID:   systemWidgetSponsors,
		Name: "Sponsors",
		Description: "Your sponsors on rotation under a \"Sponsored By\" heading — each one's logo, " +
			"with its name and website beside it. Built for a 250px-wide Browser Source; the " +
			"card's height follows its content.",
	},
	{
		ID:   systemWidgetIssueTracker,
		Name: "Issue Tracker",
		Description: "The bug queue live on screen — every filed report and its status, updating as " +
			"reports are filed, worked, and resolved. No configuration: it draws straight from the " +
			"queue, so it can never fall out of date.",
	},
	{
		ID:   systemWidgetActiveProject,
		Name: "Active Project",
		Description: "The project you're working on right now — its cover and name — following the " +
			"active project live. Adopts your \"Active Project\" widget's design when you have one.",
	},
	{
		ID:   systemWidgetEventFeed,
		Name: "Event Feed",
		Description: "Every follow, sub, gift, cheer and raid you've earned — like Unified Chat but " +
			"events only — as one scrolling history, divided by the stream each came from.",
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
	case systemWidgetSponsors:
		a.serveSponsorsWidget(w, r, action)
	case systemWidgetIssueTracker:
		a.serveIssueTracker(w, r, action)
	case systemWidgetActiveProject:
		a.serveActiveProject(w, r, action)
	case systemWidgetEventFeed:
		a.serveEventFeed(w, r, action)
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
		// Who is on the air and how many are watching, for the header strip.
		// The snapshot is memoised, so this page's polling never becomes
		// platform API polling.
		type liveChannel struct {
			Platform string `json:"platform"`
			Channel  string `json:"channel"`
			Viewers  int    `json:"viewers"`
		}
		live := []liveChannel{}
		for _, ls := range a.liveSnapshot() {
			if !ls.Live {
				continue
			}
			live = append(live, liveChannel{
				Platform: ls.Platform,
				Channel:  firstNonEmpty(ls.ChannelName, channels[ls.Platform]),
				Viewers:  ls.ViewerCount,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"sessionActive": session.Active,
			"messages":      a.GetSessionChatHistory(150),
			// Follows, subs, gifts, and raids, run inline with the chat.
			"events":   a.GetSessionLiveEvents(50),
			"channels": channels,
			"live":     live,
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
  /* Who is on the air, above the chat: one chip per live channel. */
  #live {
    display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;
  }
  #live:empty { display: none; }
  .chan {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 12px; font-weight: 700; color: #fff;
  }
  .chan svg { width: 15px; height: 15px; flex: none; fill: currentColor; }
  .chan .viewers {
    display: inline-flex; align-items: center; gap: 4px;
    font-variant-numeric: tabular-nums;
  }
  /* Everyone watching, across every channel — pushed to the strip's end. */
  .chan.total {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.28);
  }
  .chan.total .label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.65);
  }
  .chan .dot {
    width: 6px; height: 6px; border-radius: 50%; background: #ff4b4b;
    animation: livepulse 2s ease-in-out infinite;
  }
  @keyframes livepulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
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
    display: inline-flex; align-items: center;
    color: rgba(255, 255, 255, 0.75);
  }
  .source svg { width: 15px; height: 15px; flex: none; fill: currentColor; }
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
  <div id="live"></div>
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
  var liveBar = document.getElementById('live')
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

  function platformSvg(platform) {
    var path = PLATFORM_PATHS[platform]
    if (!path) return null
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', path)
    svg.appendChild(p)
    svg.style.color = PLATFORM_COLORS[platform] || '#ffffff'
    return svg
  }

  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
    return String(n)
  }

  // The header strip: one chip per channel on the air — its logo, its name,
  // and how many are watching there right now.
  function renderLive(live) {
    liveBar.textContent = ''
    var total = 0
    ;(live || []).forEach(function (ch) {
      total += ch.viewers || 0
      var chip = document.createElement('span')
      chip.className = 'chan'
      chip.title = (ch.channel || ch.platform) + ' — live'
      var svg = platformSvg(ch.platform)
      if (svg) chip.appendChild(svg)
      var viewers = document.createElement('span')
      viewers.className = 'viewers'
      var dot = document.createElement('span')
      dot.className = 'dot'
      viewers.appendChild(dot)
      var count = document.createElement('span')
      count.textContent = fmtCount(ch.viewers || 0)
      viewers.appendChild(count)
      chip.appendChild(viewers)
      liveBar.appendChild(chip)
    })

    if ((live || []).length === 0) return
    // Everyone watching, whatever channel they came in on.
    var sum = document.createElement('span')
    sum.className = 'chan total'
    sum.title = total + ' watching across every live channel'
    var eye = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    eye.setAttribute('viewBox', '0 0 24 24')
    var eyePath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    eyePath.setAttribute('d', 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z')
    eye.appendChild(eyePath)
    sum.appendChild(eye)
    var sumCount = document.createElement('span')
    sumCount.className = 'viewers'
    sumCount.textContent = fmtCount(total)
    sum.appendChild(sumCount)
    var label = document.createElement('span')
    label.className = 'label'
    label.textContent = 'total'
    sum.appendChild(label)
    liveBar.appendChild(sum)
  }

  // The source badge every row carries: the platform's mark alone — the
  // channel is always ours, so its name only repeated itself down the
  // column. It stays in the badge's tooltip.
  function sourceEl(platform) {
    var wrap = document.createElement('span')
    wrap.className = 'source'
    wrap.title = platformLabel(platform)
    var svg = platformSvg(platform)
    if (svg) wrap.appendChild(svg)
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
    renderLive(data.live)
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

// serveSponsorsWidget is the sponsors overlay: the page and the sponsor feed
// behind it.
func (a *App) serveSponsorsWidget(w http.ResponseWriter, r *http.Request, action string) {
	switch action {
	case "":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(sponsorsPage))
	case "data":
		// Only what the overlay draws: the sponsor's logo (its chosen
		// branding file), its name, and its website. Sponsors without a
		// logo still show — the page draws their initial instead.
		type sponsorCard struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Website string `json:"website"`
			LogoURL string `json:"logoUrl"`
		}
		cards := []sponsorCard{}
		for _, s := range a.GetSponsors() {
			cards = append(cards, sponsorCard{
				ID:      s.ID,
				Name:    s.Name,
				Website: s.Website,
				LogoURL: s.LogoURL,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"sponsors": cards})
	default:
		http.NotFound(w, r)
	}
}

// sponsorsPage is the sponsors overlay, built for a 250px-wide Browser Source
// with a 20px margin all round and a card whose height follows its content:
// one sponsor at a time under a "Sponsored By" heading — its logo, with the
// name (on one line, set down in size until it fits) and the website stacked
// beside it, and a dot per sponsor ending the row — holding for three
// minutes before it fades to the next. Sponsor text is written as text nodes
// only, so a stored name or address never becomes markup.
const sponsorsPage = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Sponsors</title>
<style>
  html, body {
    margin: 0; padding: 0; height: 100%;
    /* Transparent, so the 20px margin around the card is see-through and the
       card floats over whatever the scene puts behind it. */
    background: transparent; overflow: hidden;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  }
  /* Built for a 250px-wide Browser Source with a 20px margin — the margin is
     the wrap's padding, leaving the card 210px across. The height is the
     card's own: it grows and shrinks with what the sponsor carries rather
     than being held at a fixed frame. */
  #wrap {
    width: 250px; max-width: 100%; box-sizing: border-box; padding: 20px;
  }
  #card {
    display: flex; flex-direction: column; width: 100%;
    box-sizing: border-box; padding: 14px 16px 16px; border-radius: 14px;
    background: linear-gradient(135deg, #0f172a, #1e293b);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 36px rgba(0, 0, 0, 0.5);
    color: #fff; opacity: 1; transition: opacity 0.4s ease;
  }
  #card.fading { opacity: 0; }
  /* Whose placement this is: the card's own heading, above the sponsor. */
  #label {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.14em; color: #93c5fd; margin-bottom: 8px;
  }
  /* The sponsor itself is the card's content: its logo, with the name and
     the website stacked beside it and the rotation dots ending the row. */
  #head {
    display: flex; align-items: center; gap: 12px; min-width: 0;
  }
  #mark { flex: none; display: flex; }
  #logo {
    width: 56px; height: 56px; flex: none; border-radius: 10px;
    object-fit: contain; background: rgba(255, 255, 255, 0.9); padding: 6px;
    box-sizing: border-box;
  }
  #initial {
    width: 56px; height: 56px; flex: none; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    font-size: 24px; font-weight: 800; color: #e2e8f0;
  }
  #body { flex: 1; min-width: 0; }
  /* The name stays on one line: the JS shrinks its font until the whole
     name fits the space beside the logo (see fitName). */
  #name {
    font-size: 18px; font-weight: 700; line-height: 1.2;
    white-space: nowrap; overflow: hidden;
  }
  #site {
    margin-top: 2px; font-size: 12px; font-weight: 600; color: #93c5fd;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #dots { display: flex; gap: 4px; flex: none; }
  #dots:empty { display: none; }
  .dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
  }
  .dot.on { background: #93c5fd; }
  #empty {
    width: 100%; box-sizing: border-box; padding: 18px 16px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 14px; border: 1px dashed rgba(255, 255, 255, 0.18);
    background: rgba(15, 23, 42, 0.75);
    color: rgba(255, 255, 255, 0.45); font-size: 12px; text-align: center;
  }
</style>
</head>
<body>
<div id="wrap">
  <div id="card">
    <div id="label">Sponsored By</div>
    <div id="head">
      <div id="mark"></div>
      <div id="body">
        <div id="name"></div>
        <div id="site"></div>
      </div>
      <div id="dots"></div>
    </div>
  </div>
  <div id="empty" style="display: none">Sponsors you add in Jax appear here.</div>
</div>
<script>
(function () {
  'use strict'
  var base = location.pathname.replace(/\/$/, '')
  var card = document.getElementById('card')
  var name = document.getElementById('name')
  var mark = document.getElementById('mark')
  var site = document.getElementById('site')
  var empty = document.getElementById('empty')
  var dots = document.getElementById('dots')
  var sponsors = []
  var index = 0
  var lastJSON = ''
  // How long a sponsor holds the card before the next one takes it. Three
  // minutes: long enough that a viewer joining mid-stream reads the whole
  // slide rather than catching it mid-fade.
  var SLIDE_MS = 3 * 60 * 1000

  // The address as a viewer reads it: no scheme, no trailing slash.
  function prettySite(url) {
    return (url || '').replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
  }

  // The name stays on one line whatever its length: start from the card's
  // full type size and step down until it fits, so a long sponsor is set
  // smaller rather than clipped or wrapped.
  var NAME_MAX = 18
  var NAME_MIN = 9

  function fitName() {
    var size = NAME_MAX
    name.style.fontSize = size + 'px'
    while (size > NAME_MIN && name.scrollWidth > name.clientWidth) {
      size -= 1
      name.style.fontSize = size + 'px'
    }
  }

  function draw() {
    var s = sponsors[index]
    mark.textContent = ''
    name.textContent = ''
    site.textContent = ''
    dots.textContent = ''
    if (!s) return
    if (s.logoUrl) {
      var img = document.createElement('img')
      img.id = 'logo'
      img.src = s.logoUrl
      img.alt = ''
      mark.appendChild(img)
    } else {
      var initial = document.createElement('div')
      initial.id = 'initial'
      initial.textContent = (s.name || '?').charAt(0).toUpperCase()
      mark.appendChild(initial)
    }
    name.textContent = s.name || 'Sponsor'
    fitName()
    site.textContent = prettySite(s.website)

    if (sponsors.length > 1) {
      sponsors.forEach(function (_, i) {
        var dot = document.createElement('span')
        dot.className = i === index ? 'dot on' : 'dot'
        dots.appendChild(dot)
      })
    }
  }

  // Advance to the next sponsor behind a short fade, so the card changes
  // rather than flickering.
  function advance() {
    if (sponsors.length < 2) return
    card.className = 'fading'
    window.setTimeout(function () {
      index = (index + 1) % sponsors.length
      draw()
      card.className = ''
    }, 400)
  }

  function render(data) {
    var next = data.sponsors || []
    // Keep showing the same sponsor across polls when the list is unchanged
    // in length; a real edit restarts at the first card.
    if (next.length !== sponsors.length) index = 0
    sponsors = next
    if (sponsors.length === 0) {
      card.style.display = 'none'
      empty.style.display = 'flex'
      return
    }
    card.style.display = 'flex'
    empty.style.display = 'none'
    if (index >= sponsors.length) index = 0
    draw()
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

  tick()
  setInterval(tick, 10000)
  setInterval(advance, SLIDE_MS)
})()
</script>
</body>
</html>
`

// serveIssueTracker is the issue-tracker overlay. It uses the same display
// pipeline as the producer's own stream widgets (see widget_source.go): the
// page is the shared React shell, and the data feed carries a template, CSS
// and JS plus the items to render — so a system widget gets the full display
// feature, not a hand-written page.
//
// Its template/CSS/JS are adopted from the producer's "Issue Tracker" stream
// widget when one exists, so the board on stream is the design they already
// built; its items are the live bug queue rather than manually pushed
// entries, so it can never fall out of date. Without that widget it falls
// back to a built-in default display.
func (a *App) serveIssueTracker(w http.ResponseWriter, r *http.Request, action string) {
	switch action {
	case "":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = widgetSourcePage.Execute(w, map[string]string{"Name": "Issue Tracker"})
	case "data":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(a.issueTrackerData())
	default:
		http.NotFound(w, r)
	}
}

// issueTrackerData builds the display payload: the built-in Issue Tracker
// display, and one item per open report. The queue is worked oldest first, so
// the items are ordered oldest first here — the oldest (next to be worked)
// leads and the newest trails. A resolved report leaves the queue (it is
// deleted), so only live work is ever shown.
//
// The Issue Tracker owns its display rather than adopting a custom widget's,
// so its ordering and animation are the app's to define.
func (a *App) issueTrackerData() widgetSourceData {
	data := widgetSourceData{
		Name:     "Issue Tracker",
		Template: issueTrackerDefaultTemplate,
		CSS:      issueTrackerDefaultCSS,
		JS:       issueTrackerDefaultJS,
		Fields:   []widgetSourceField{},
		Items:    []widgetSourceItem{},
	}
	reports := a.ListDebugReports()
	// The board reads top to bottom: the working (claimed or issue-opened)
	// items sit at the top, the queued ones below, and within each group the
	// oldest leads — so the oldest is worked first and a newly filed report
	// lands at the very bottom. The id increases with filing time.
	working := func(r DebugReport) bool { return r.CheckedOut || r.IssueNumber > 0 }
	sort.SliceStable(reports, func(i, j int) bool {
		if wi, wj := working(reports[i]), working(reports[j]); wi != wj {
			return wi
		}
		return reports[i].ID < reports[j].ID
	})
	for _, rep := range reports {
		status := "Queued"
		if rep.CheckedOut || rep.IssueNumber > 0 {
			status = "Working"
		}
		if rep.IssueNumber > 0 {
			status = fmt.Sprintf("Working #%d", rep.IssueNumber)
		}
		data.Items = append(data.Items, widgetSourceItem{
			ID:        fmt.Sprintf("report-%d", rep.ID),
			CreatedAt: rep.CreatedAt,
			Values: map[string]string{
				"Message": issueTrackerMessage(rep),
				"Status":  status,
			},
		})
	}
	return data
}

// ---------------------------------------------------------------------------
// System widget displays
//
// A system widget renders through the same display pipeline as a producer's
// stream widget (widget_source.go): a JSX template, CSS and JS run by React on
// the Browser Source. A widget transferred from a custom one adopts that
// widget's template/CSS/JS live — so it looks identical — and the design is
// snapshotted, so the system widget keeps its look after the custom widget it
// was transferred from is deleted. Falling back, it uses the last snapshot,
// then a built-in default.
// ---------------------------------------------------------------------------

// keySystemWidgetDisplays stores the template/CSS/JS snapshotted from each
// system widget's source custom widget.
const keySystemWidgetDisplays = "system_widget_displays"

// storedDisplay is one snapshotted (or default) template/CSS/JS set.
type storedDisplay struct {
	Template string `json:"template"`
	CSS      string `json:"css"`
	JS       string `json:"js"`
}

// systemWidgetDisplay is a resolved display: its template/CSS/JS and field
// schema, plus the labels its item values are keyed by (detected from the
// live widget's field kinds; the built-in defaults otherwise).
type systemWidgetDisplay struct {
	Template   string
	CSS        string
	JS         string
	Fields     []widgetSourceField
	MessageLbl string
	StatusLbl  string
	ImageLbl   string
	ImageURL   string
}

// storedSystemDisplays reads the snapshot map. Never nil.
func (a *App) storedSystemDisplays() map[string]storedDisplay {
	m := map[string]storedDisplay{}
	if a.store != nil {
		if _, err := a.store.getJSON(keySystemWidgetDisplays, &m); err != nil {
			log.Printf("jax: system widget displays: %v", err)
		}
	}
	if m == nil {
		return map[string]storedDisplay{}
	}
	return m
}

// snapshotSystemDisplay records a system widget's current design, so it
// survives the custom widget it was transferred from being deleted.
func (a *App) snapshotSystemDisplay(id string, d storedDisplay) {
	if a.store == nil || strings.TrimSpace(d.Template) == "" {
		return
	}
	m := a.storedSystemDisplays()
	if cur, ok := m[id]; ok && cur == d {
		return
	}
	m[id] = d
	if err := a.store.setJSON(keySystemWidgetDisplays, m); err != nil {
		log.Printf("jax: snapshot system widget display: %v", err)
	}
}

// resolveSystemDisplay resolves a system widget's display: the producer's
// custom widget matched by name (adopted live and snapshotted), else the last
// snapshot, else the built-in default.
func (a *App) resolveSystemDisplay(id string, names []string, def storedDisplay) systemWidgetDisplay {
	out := systemWidgetDisplay{
		Fields:     []widgetSourceField{},
		MessageLbl: "Message",
		StatusLbl:  "Status",
		ImageLbl:   "Image/Animation",
	}
	if cw, ok := a.customWidgetByName(names); ok {
		out.Template, out.CSS, out.JS = cw.Template, cw.CSS, cw.JS
		a.snapshotSystemDisplay(id, storedDisplay{cw.Template, cw.CSS, cw.JS})
		kinds := map[string]string{}
		for _, ft := range a.getWidgetFieldTypes() {
			kinds[ft.ID] = ft.Kind
		}
		for _, f := range cw.Fields {
			value := f.Value
			if f.ValueURL != "" {
				value = f.ValueURL
			}
			kind := kinds[f.TypeID]
			out.Fields = append(out.Fields, widgetSourceField{
				Label: f.Label, Kind: kind, Value: value,
			})
			switch kind {
			case widgetFieldMessage:
				out.MessageLbl = f.Label
			case widgetFieldStatus:
				out.StatusLbl = f.Label
			case widgetFieldImage:
				out.ImageLbl, out.ImageURL = f.Label, value
			}
		}
		return out
	}
	if d, ok := a.storedSystemDisplays()[id]; ok && strings.TrimSpace(d.Template) != "" {
		out.Template, out.CSS, out.JS = d.Template, d.CSS, d.JS
		return out
	}
	out.Template, out.CSS, out.JS = def.Template, def.CSS, def.JS
	return out
}

// customWidgetByName finds a producer stream widget by any of the given names
// (case-insensitive), skipping one with no template. URLs are filled so sound
// and image fields resolve to served addresses.
func (a *App) customWidgetByName(names []string) (*StreamWidget, bool) {
	want := map[string]bool{}
	for _, n := range names {
		want[strings.ToLower(strings.TrimSpace(n))] = true
	}
	for _, sw := range a.getStreamWidgets() {
		if want[strings.ToLower(strings.TrimSpace(sw.Name))] &&
			strings.TrimSpace(sw.Template) != "" {
			cp := sw
			a.fillWidgetURLs(&cp)
			return &cp, true
		}
	}
	return nil, false
}

// serveActiveProject is the active-project overlay: the current project's
// cover and name, rendered through the display pipeline. Its display is
// transferred from the producer's "Active Project" stream widget; the display
// polls /widget/app/active-project itself, so the feed carries only the
// template, styles and field fallbacks.
func (a *App) serveActiveProject(w http.ResponseWriter, r *http.Request, action string) {
	switch action {
	case "":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = widgetSourcePage.Execute(w, map[string]string{"Name": "Active Project"})
	case "data":
		disp := a.resolveSystemDisplay(systemWidgetActiveProject,
			[]string{"active project"},
			storedDisplay{
				Template: activeProjectDefaultTemplate,
				CSS:      activeProjectDefaultCSS,
				JS:       activeProjectDefaultJS,
			})
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(widgetSourceData{
			Name:     "Active Project",
			Template: disp.Template,
			CSS:      disp.CSS,
			JS:       disp.JS,
			Fields:   disp.Fields,
			Items:    []widgetSourceItem{},
		})
	default:
		http.NotFound(w, r)
	}
}

// eventFeedMaxStreams caps how many recent streams the feed reads events for,
// so the poll stays cheap however long the broadcast history grows.
const eventFeedMaxStreams = 40

// serveEventFeed is the event-feed overlay: the page, and the history of
// earned events grouped by the stream each came from.
func (a *App) serveEventFeed(w http.ResponseWriter, r *http.Request, action string) {
	switch action {
	case "":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(eventFeedPage))
	case "data":
		// The follows, subs, gifts, cheers and raids each stream earned, one
		// group per stream, oldest stream first so the newest events sit at
		// the bottom of the scroll (as the chat overlay does). Only streams
		// that actually earned an event appear, so the dividers mean
		// something. Recent streams only, to keep the poll light.
		type feedEvent struct {
			Platform string `json:"platform"`
			Type     string `json:"type"`
			Author   string `json:"author"`
			Detail   string `json:"detail"`
			At       int64  `json:"at"`
		}
		type feedGroup struct {
			Title     string      `json:"title"`
			StartedAt string      `json:"startedAt"`
			Episode   int         `json:"episode"`
			Events    []feedEvent `json:"events"`
		}
		streams := a.GetPastStreams(false)
		if len(streams) > eventFeedMaxStreams {
			streams = streams[:eventFeedMaxStreams]
		}
		groups := []feedGroup{}
		// GetPastStreams is newest first; walk backwards so the oldest group
		// leads and the newest trails.
		for i := len(streams) - 1; i >= 0; i-- {
			s := streams[i]
			// A stream's window is the longest of its simulcast broadcasts.
			durationSecs := 0
			for _, b := range s.Broadcasts {
				if b.DurationSecs > durationSecs {
					durationSecs = b.DurationSecs
				}
			}
			evs := a.GetLiveEventsForStream(s.StartedAt, durationSecs)
			if len(evs) == 0 {
				continue
			}
			g := feedGroup{
				Title:     firstNonEmpty(s.Title, "Untitled stream"),
				StartedAt: s.StartedAt,
				Episode:   s.EpisodeNumber,
			}
			for _, e := range evs {
				g.Events = append(g.Events, feedEvent{
					Platform: e.Platform, Type: e.Type,
					Author: e.Author, Detail: e.Detail, At: e.At,
				})
			}
			groups = append(groups, g)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"groups": groups})
	default:
		http.NotFound(w, r)
	}
}

// issueTrackerMessage is the one-line summary a report shows on the tracker:
// its title, or the first non-empty line of its description.
func issueTrackerMessage(r DebugReport) string {
	if t := strings.TrimSpace(r.Title); t != "" {
		return t
	}
	for _, line := range strings.Split(r.Description, "\n") {
		if s := strings.TrimSpace(line); s != "" {
			return s
		}
	}
	return "Untitled report"
}

// The built-in Issue Tracker display, used when the producer has no "Issue
// Tracker" stream widget of their own to adopt. A card per open report,
// newest first, its status pill amber while worked; the newest leads full
// size and the rest sit compact beneath. Rendered through the same React
// display pipeline as a stream widget, so it is the full display feature.
const issueTrackerDefaultTemplate = `<div className="iqw-wrap">
  <div className="iqw-list">
    {(items || []).map((item) => {
      var status = (item.values['Status'] || '').trim()
      var working = /\d|work/i.test(status)
      return (
        <div key={item.id} data-iqw-id={item.id} className={'iqw' + (working ? ' working' : '')}>
          <div className="iqw-body">
            <div className="iqw-name">{widget.name}</div>
            <div className="iqw-message">{item.values['Message']}</div>
          </div>
          <div className="iqw-status">{status || 'Queued'}</div>
        </div>
      )
    })}
    {(items || []).length === 0 ? (
      <div className="iqw-empty">No open issues - the queue is clear.</div>
    ) : null}
  </div>
</div>`

const issueTrackerDefaultCSS = `body { margin: 0; padding: 0; background: transparent; overflow: hidden;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
.iqw-wrap { width: 500px; height: 650px; box-sizing: border-box; padding: 24px;
  overflow: hidden; }
.iqw-list { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.iqw { display: flex; align-items: center; gap: 16px; width: 100%;
  box-sizing: border-box; padding: 16px 20px; border-radius: 16px;
  background: linear-gradient(135deg, rgba(15,23,42,0.94), rgba(30,41,59,0.94));
  border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 10px 36px rgba(0,0,0,0.5);
  color: #fff; }
.iqw-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
.iqw-name { font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.14em; color: #93c5fd; }
.iqw-message { font-size: 18px; font-weight: 700; line-height: 1.3;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere; }
.iqw-status { flex: none; align-self: flex-start; display: inline-flex;
  align-items: center; padding: 4px 12px; border-radius: 999px; font-size: 11px;
  font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
  white-space: nowrap; background: #64748b; color: #04121f; }
.iqw.working .iqw-status { background: #f59e0b; color: #1a1206; }
.iqw-empty { width: 100%; box-sizing: border-box; padding: 16px 20px;
  border-radius: 16px; border: 1px dashed rgba(255,255,255,0.18);
  background: rgba(15,23,42,0.75); color: rgba(255,255,255,0.5);
  font-size: 14px; text-align: center; }
.iqw-enter { animation: iqw-in 0.55s cubic-bezier(0.2,0.9,0.3,1.2) both; }
@keyframes iqw-in {
  from { opacity: 0; transform: translateX(calc(100% + 48px)); }
  to { opacity: 1; transform: translateX(0); }
}
.iqw-ghost { position: fixed; margin: 0; pointer-events: none; z-index: 5;
  animation: iqw-up 0.5s ease-in forwards; }
@keyframes iqw-up {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-40px); }
}`

// The default's motion: each row slides in from the right when it appears,
// rows glide (FLIP) to their new slots when the order changes, and a row that
// leaves the queue lifts off as a ghost and fades up. State is kept on the
// window so it survives the shell's re-render each poll.
const issueTrackerDefaultJS = `var store = (window.__itStore = window.__itStore || {snap: {}, ready: false})
var scope = root || document
var rows = scope.querySelectorAll('[data-iqw-id]')

// Snapshot the previous render's rows (position + markup) so a row that is
// gone this time can be replayed as a ghost.
var prev = store.snap
var now = {}
for (var i = 0; i < rows.length; i++) {
  var el = rows[i]
  var id = el.getAttribute('data-iqw-id')
  var r = el.getBoundingClientRect()
  now[id] = {left: r.left, top: r.top, width: r.width, height: r.height, html: el.outerHTML}
  if (store.ready && !prev[id]) {
    // New row: slide in from the right.
    el.classList.remove('iqw-enter')
    void el.offsetWidth
    el.classList.add('iqw-enter')
  } else if (prev[id]) {
    // Moved row: start it at its old spot and let it glide back (FLIP).
    var dx = prev[id].left - r.left
    var dy = prev[id].top - r.top
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      el.style.transition = 'none'
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'
      void el.offsetWidth
      el.style.transition = 'transform 0.5s cubic-bezier(0.4,0,0.2,1)'
      el.style.transform = ''
    }
  }
}

// Rows that were present last time but are gone now leave as fading ghosts.
if (store.ready) {
  Object.keys(prev).forEach(function (id) {
    if (now[id]) return
    var p = prev[id]
    var ghost = document.createElement('div')
    ghost.innerHTML = p.html
    var node = ghost.firstChild
    if (!node) return
    node.classList.add('iqw-ghost')
    node.style.left = p.left + 'px'
    node.style.top = p.top + 'px'
    node.style.width = p.width + 'px'
    document.body.appendChild(node)
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node)
    }, 550)
  })
}

store.snap = now
store.ready = true`

// The built-in Active Project display, used when the producer has no "Active
// Project" stream widget to adopt. A cover-filled card with the project name
// on a scrim; its custom JS follows the app's active project live from
// /widget/app/active-project, falling back to the widget's own fields.
const activeProjectDefaultTemplate = `<div className="apw-wrap">
  <div className="apw">
    <div className="apw-media">
      <img alt="" />
      <div className="apw-scrim"></div>
    </div>
    <div className="apw-body">
      <div className="apw-name">Current Project</div>
      <div className="apw-project">No active project</div>
    </div>
  </div>
</div>`

const activeProjectDefaultCSS = `body { margin: 0; padding: 0; background: transparent; overflow: hidden;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
.apw-wrap { width: 240px; height: 240px; max-width: 100%; box-sizing: border-box;
  padding-left: 20px; }
.apw { position: relative; overflow: hidden; display: flex; flex-direction: column;
  width: 100%; height: 100%; box-sizing: border-box; border-radius: 14px;
  background: linear-gradient(135deg, #0f172a, #1e293b);
  border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 10px 36px rgba(0,0,0,0.5);
  color: #fff; }
.apw-media { position: absolute; inset: 0; overflow: hidden; }
.apw-media img { position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; display: block; }
.apw-noimage .apw-media img { display: none; }
.apw-scrim { position: absolute; inset: 0; background: linear-gradient(180deg,
  rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.55) 35%, rgba(15,23,42,0.15) 60%,
  rgba(15,23,42,0.75) 100%); }
.apw-body { position: relative; z-index: 1; display: flex; flex-direction: column;
  align-items: flex-start; gap: 8px; padding: 14px 16px 12px; }
.apw-name { font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.14em; color: #93c5fd; background: #0f172a;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; padding: 4px 8px; }
.apw-project { font-size: 22px; font-weight: 700; line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  overflow: hidden; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
.apw-idle .apw-project { color: #cbd5e1; }`

// The default's logic: poll the app's active project and paint the card. The
// widget's own Project Name/Image fields stand in when nothing is active.
const activeProjectDefaultJS = `var store = (window.__apwStore = window.__apwStore || {data: null, timer: null})
store.rootEl = root
store.fieldName = (fields['Project Name'] || '').trim()
store.fieldImage = fields['Project Image'] || ''
store.paint = function () {
  var s = window.__apwStore
  var scope = s.rootEl && s.rootEl.isConnected ? s.rootEl : document
  var card = scope.querySelector('.apw')
  if (!card) return
  var d = s.data || {}
  var title = (d.title || s.fieldName || '').trim()
  var image = d.imageUrl || (d.title ? '' : s.fieldImage) || ''
  var nameEl = card.querySelector('.apw-project')
  if (nameEl) nameEl.textContent = title || 'No active project'
  var imgEl = card.querySelector('.apw-media img')
  if (imgEl && imgEl.getAttribute('src') !== image) {
    if (image) imgEl.setAttribute('src', image)
    else imgEl.removeAttribute('src')
  }
  card.classList.toggle('apw-noimage', !image)
  card.classList.toggle('apw-idle', !title)
}
store.fetch = function () {
  fetch('/widget/app/active-project', {cache: 'no-store'})
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (d) {
      var s = window.__apwStore
      if (!s) return
      if (d) s.data = d
      s.paint()
    })
    .catch(function () {})
}
store.paint()
store.fetch()
if (!store.timer) {
  store.timer = setInterval(function () {
    if (window.__apwStore && window.__apwStore.fetch) window.__apwStore.fetch()
  }, 5000)
}`

// eventFeedPage is the overlay: the earned-events history as a dark-gray
// scrolling column, each stream's events under a divider naming that stream,
// pinned to the newest at the bottom - the same look as the Unified Chat
// overlay, events only. Author and detail are text nodes only, so stored
// text never becomes markup.
const eventFeedPage = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Event Feed</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #1f2937;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  #wrap { display: flex; flex-direction: column; height: 100vh;
    box-sizing: border-box; padding: 12px; }
  #list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  #list > :first-child { margin-top: auto; }
  #list::-webkit-scrollbar { width: 0; }
  #empty { flex: 1; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.45); font-size: 14px; text-align: center; }
  .divider { display: flex; align-items: center; gap: 10px; margin: 12px 2px 4px;
    color: rgba(255,255,255,0.55); }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px;
    background: rgba(255,255,255,0.14); }
  .divider .d-title { font-size: 12px; font-weight: 700; white-space: nowrap;
    max-width: 60%; overflow: hidden; text-overflow: ellipsis; }
  .divider .d-date { font-size: 11px; color: rgba(255,255,255,0.4); white-space: nowrap; }
  .evt { position: relative; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; padding: 6px 10px;
    color: #fff; font-size: 15px; line-height: 1.35; overflow-wrap: anywhere; }
  .evt-icon { display: inline-block; margin-right: 6px; font-size: 14px; }
  .author { font-weight: 700; margin-right: 6px; }
  .plat { display: inline-block; vertical-align: 1px; margin-right: 6px;
    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
    padding: 1px 6px; border-radius: 999px; color: #fff; }
  .time { float: right; font-size: 11px; color: rgba(255,255,255,0.4); margin-left: 8px; }
  .evt-follow { background: rgba(83,252,24,0.14); border-color: rgba(83,252,24,0.35); }
  .evt-sub    { background: rgba(255,196,0,0.14); border-color: rgba(255,196,0,0.38); }
  .evt-gift   { background: rgba(255,122,0,0.14); border-color: rgba(255,122,0,0.38); }
  .evt-raid   { background: rgba(145,70,255,0.18); border-color: rgba(145,70,255,0.42); }
  .evt-cheer  { background: rgba(0,176,255,0.14); border-color: rgba(0,176,255,0.38); }
</style>
</head>
<body>
<div id="wrap">
  <div id="empty" style="display: none">Events you earn appear here, grouped by stream.</div>
  <div id="list"></div>
</div>
<script>
(function () {
  'use strict'
  var base = location.pathname.replace(/\/$/, '')
  var list = document.getElementById('list')
  var empty = document.getElementById('empty')
  var lastJSON = ''

  var EVENT_ICONS = { follow: '\u2665', sub: '\u2605', gift: '\uD83C\uDF81', raid: '\u2691', cheer: '\u25C6' }
  var PLATFORM_COLORS = { twitch: '#9146FF', youtube: '#FF0000', kick: '#53FC18',
    facebook: '#1877F2', instagram: '#E1306C', x: '#444444', tiktok: '#111111' }

  function fmtTime(at) {
    var d = new Date(at)
    var h = d.getHours(), m = d.getMinutes()
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
  }
  function fmtDate(iso) {
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})
  }

  function evtRow(e) {
    var row = document.createElement('div')
    row.className = 'evt evt-' + (e.type || 'follow')
    var time = document.createElement('span')
    time.className = 'time'
    time.textContent = fmtTime(e.at)
    row.appendChild(time)
    if (e.platform) {
      var plat = document.createElement('span')
      plat.className = 'plat'
      plat.textContent = e.platform
      plat.style.background = PLATFORM_COLORS[e.platform] || '#555'
      row.appendChild(plat)
    }
    var icon = document.createElement('span')
    icon.className = 'evt-icon'
    icon.textContent = EVENT_ICONS[e.type] || '\u2605'
    row.appendChild(icon)
    var author = document.createElement('span')
    author.className = 'author'
    author.textContent = e.author || ''
    row.appendChild(author)
    row.appendChild(document.createTextNode(e.detail || ''))
    return row
  }

  function divider(g) {
    var d = document.createElement('div')
    d.className = 'divider'
    var title = document.createElement('span')
    title.className = 'd-title'
    title.textContent = (g.episode ? 'EP' + g.episode + ' - ' : '') + (g.title || 'Stream')
    d.appendChild(title)
    var date = document.createElement('span')
    date.className = 'd-date'
    date.textContent = fmtDate(g.startedAt)
    d.appendChild(date)
    return d
  }

  function render(groups) {
    var total = 0
    groups.forEach(function (g) { total += (g.events || []).length })
    if (total === 0) {
      list.style.display = 'none'
      empty.style.display = 'flex'
      return
    }
    empty.style.display = 'none'
    list.style.display = 'flex'
    var pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 40
    list.textContent = ''
    groups.forEach(function (g) {
      if (!(g.events || []).length) return
      list.appendChild(divider(g))
      g.events.forEach(function (e) { list.appendChild(evtRow(e)) })
    })
    if (pinned) list.scrollTop = list.scrollHeight
  }

  function tick() {
    fetch(base + '/data', {cache: 'no-store'})
      .then(function (r) { return r.text() })
      .then(function (text) {
        if (text === lastJSON) return
        lastJSON = text
        render((JSON.parse(text).groups) || [])
      })
      .catch(function () {})
  }

  tick()
  setInterval(tick, 8000)
})()
</script>
</body>
</html>
`

package main

import (
	"context"
	"io"
	"log"
	"os/exec"
	"sync"
	"time"
)

// App struct
type App struct {
	ctx context.Context

	// store is the SQLite-backed persistence layer (~/.jax/jax.db). It may be
	// nil if the database could not be opened, in which case the bound methods
	// degrade gracefully to in-memory / default behaviour.
	store *Store

	// Remote service connection state. Sessions are persisted to the database
	// on connect and restored at startup; access tokens are refreshed on
	// demand (see tokens.go).
	mu       sync.Mutex
	conns    map[string]serviceConn
	statuses map[string]ServiceStatus

	// ytChatID memoises the active YouTube broadcast's live-chat id between
	// chat polls (guarded by mu; see chat.go).
	ytChatID string

	// YouTube live-status memo (guarded by mu; see live.go). The frontend
	// polls GetLiveStreams every 10-60s, but YouTube's quota is tight, so the
	// last result is served between backend refreshes and the active video id
	// is remembered so being live costs one videos.list call per refresh.
	ytVideoID      string
	ytLiveResult   *LiveStream
	ytLiveResultAt time.Time

	// Transcriber sidecar process (guarded by mu; see transcriber.go).
	transcribeCmd   *exec.Cmd
	transcribeStdin io.WriteCloser

	// Video-download sidecar process (guarded by mu; see download.go).
	downloadCmd *exec.Cmd

	// Downloaded-video transcription queue: queued and running jobs, oldest
	// first (guarded by mu; see transcribe_video.go).
	vodJobs []*vodJob

	// mediaBaseURL is the loopback URL of the local media server that streams
	// downloaded videos (guarded by mu; see media.go). Empty until startup.
	mediaBaseURL string

	// ytSubsSeen tracks which YouTube subscription ids the subscriber poll has
	// already reported, so only genuinely new subscribers become feed events.
	// nil until the first poll baselines it (guarded by mu; see subscribers.go).
	ytSubsSeen map[string]bool
}

// NewApp creates a new App application struct
func NewApp() *App {
	store, err := openStore()
	if err != nil {
		// Persistence is unavailable, but the app can still run for the session.
		log.Printf("jax: could not open database: %v", err)
	}
	app := &App{
		store:    store,
		conns:    map[string]serviceConn{},
		statuses: map[string]ServiceStatus{},
	}

	// Restore persisted OAuth sessions so Twitch/YouTube stay connected across
	// restarts. Expired access tokens are refreshed lazily on first use.
	if store != nil {
		conns, err := store.getServiceConns()
		if err != nil {
			log.Printf("jax: restore service connections: %v", err)
		}
		for name, conn := range conns {
			app.conns[name] = conn
			app.statuses[name] = ServiceStatus{
				Name:      name,
				Connected: true,
				Account:   conn.account,
			}
		}
	}
	return app
}

// startup is called when the app starts. The context is saved so we can call
// the runtime methods, and the transcriber sidecar is warmed in the
// background so its Whisper model is already loaded when a stream starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Serve downloaded videos over a loopback HTTP server so large files stream
	// (with range/seek support) instead of buffering through the webview.
	a.startMediaServer()
	go func() {
		if err := a.ensureTranscriber(); err != nil {
			log.Printf("jax: warm transcriber: %v", err)
		}
	}()
	// Keep the cached app icon in sync with the profile's Gravatar; the
	// build step embeds it (see icon.go).
	go a.refreshAppIcon()
	// Pick the transcription queue back up where the last session left off.
	go a.restoreTranscribeQueue()
	// Re-hide the window from screen capture if the preference is on.
	go a.restoreCaptureExclusion()
}

// shutdown is called when the app closes. It ends the sidecar processes and
// releases the database handle.
func (a *App) shutdown(ctx context.Context) {
	a.killTranscriber()
	a.CancelDownload()
	a.killVodJobs()
	if a.store != nil {
		_ = a.store.Close()
	}
}

// ---------------------------------------------------------------------------
// Streams & channel sources
// ---------------------------------------------------------------------------

// GetStreams returns the streams persisted in the local database.
func (a *App) GetStreams() []Stream {
	if a.store == nil {
		return []Stream{}
	}
	streams, err := a.store.getStreams()
	if err != nil {
		log.Printf("jax: GetStreams: %v", err)
		return []Stream{}
	}
	return streams
}

// SaveStreams replaces the stored streams with the supplied set.
func (a *App) SaveStreams(streams []Stream) error {
	if a.store == nil {
		return nil
	}
	return a.store.saveStreams(streams)
}

// GetChannelSources returns the channel sources persisted in the local database.
func (a *App) GetChannelSources() []ChannelSource {
	if a.store == nil {
		return []ChannelSource{}
	}
	sources, err := a.store.getChannelSources()
	if err != nil {
		log.Printf("jax: GetChannelSources: %v", err)
		return []ChannelSource{}
	}
	return sources
}

// SaveChannelSources replaces the stored channel sources with the supplied set.
func (a *App) SaveChannelSources(sources []ChannelSource) error {
	if a.store == nil {
		return nil
	}
	return a.store.saveChannelSources(sources)
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

// GetProfile returns the stored user profile (empty if never set).
func (a *App) GetProfile() Profile {
	var p Profile
	if a.store == nil {
		return p
	}
	if _, err := a.store.getJSON(keyProfile, &p); err != nil {
		log.Printf("jax: GetProfile: %v", err)
	}
	return p
}

// SaveProfile persists the user profile and refreshes the cached Gravatar
// app icon for the (possibly new) email.
func (a *App) SaveProfile(p Profile) error {
	if a.store == nil {
		return nil
	}
	if err := a.store.setJSON(keyProfile, p); err != nil {
		return err
	}
	go a.refreshAppIcon()
	return nil
}

// ---------------------------------------------------------------------------
// Service connection config
// ---------------------------------------------------------------------------

// defaultServiceConfig mirrors the frontend's previous defaults so first-run
// modals prefill sensible OBS values.
func defaultServiceConfig() ServiceConfig {
	return ServiceConfig{ObsHost: "localhost", ObsPort: "4455"}
}

// GetServiceConfig returns the stored service connection config, falling back
// to defaults when nothing has been saved yet.
func (a *App) GetServiceConfig() ServiceConfig {
	def := defaultServiceConfig()
	if a.store == nil {
		return def
	}
	var c ServiceConfig
	ok, err := a.store.getJSON(keyServiceConfig, &c)
	if err != nil {
		log.Printf("jax: GetServiceConfig: %v", err)
	}
	if !ok {
		return def
	}
	return c
}

// SaveServiceConfig persists the service connection config.
func (a *App) SaveServiceConfig(c ServiceConfig) error {
	if a.store == nil {
		return nil
	}
	return a.store.setJSON(keyServiceConfig, c)
}

// ---------------------------------------------------------------------------
// Generic UI settings (theme, nav state, ...)
// ---------------------------------------------------------------------------

// GetSetting returns a stored UI setting value, or "" if unset. Used for simple
// scalar preferences such as the theme and the collapsed-navigation flag.
func (a *App) GetSetting(key string) string {
	if a.store == nil {
		return ""
	}
	v, err := a.store.getSetting(key)
	if err != nil {
		log.Printf("jax: GetSetting(%q): %v", key, err)
		return ""
	}
	return v
}

// SetSetting persists a scalar UI setting.
func (a *App) SetSetting(key, value string) error {
	if a.store == nil {
		return nil
	}
	return a.store.setSetting(key, value)
}

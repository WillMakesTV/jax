package main

import (
	"context"
	"log"
	"sync"
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

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// shutdown is called when the app closes. It releases the database handle.
func (a *App) shutdown(ctx context.Context) {
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

// SaveProfile persists the user profile.
func (a *App) SaveProfile(p Profile) error {
	if a.store == nil {
		return nil
	}
	return a.store.setJSON(keyProfile, p)
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

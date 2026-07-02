package main

import (
	"context"
	"sync"
)

// App struct
type App struct {
	ctx context.Context

	// Remote service connection state. Tokens are held in memory only for now
	// (lost on restart); statuses reflect the current session's connections.
	mu       sync.Mutex
	tokens   map[string]string
	statuses map[string]ServiceStatus
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		tokens:   map[string]string{},
		statuses: map[string]ServiceStatus{},
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GetStreams returns the configured streams.
//
// Persistence is not yet implemented, so this currently returns an empty
// slice. It exists so the Stream model is surfaced in the generated TypeScript
// bindings and to provide the seam where stored streams will be loaded.
func (a *App) GetStreams() []Stream {
	return []Stream{}
}

// GetChannelSources returns the configured channel sources.
//
// As with GetStreams, persistence is not yet implemented; this returns an
// empty slice and exists to surface the ChannelSource model in the bindings.
func (a *App) GetChannelSources() []ChannelSource {
	return []ChannelSource{}
}

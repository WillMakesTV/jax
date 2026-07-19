package main

import (
	"strings"
	"testing"
)

func TestMediaServerPortPersists(t *testing.T) {
	a := newTestApp(t)
	a.startMediaServer()
	if a.mediaBaseURL == "" {
		t.Fatal("media server did not start")
	}
	port, err := a.store.getSetting(keyMediaPort)
	if err != nil || port == "" {
		t.Fatalf("port not stored: %q, %v", port, err)
	}
	if !strings.HasSuffix(a.mediaBaseURL, ":"+port) {
		t.Fatalf("stored port %s does not match base URL %s", port, a.mediaBaseURL)
	}

	// A stored port that is already taken (here: by the first app's server)
	// falls back to a fresh port — and stores it for the next run.
	b := newTestApp(t)
	if err := b.store.setSetting(keyMediaPort, port); err != nil {
		t.Fatalf("seed stored port: %v", err)
	}
	b.startMediaServer()
	if b.mediaBaseURL == "" {
		t.Fatal("fallback media server did not start")
	}
	if strings.HasSuffix(b.mediaBaseURL, ":"+port) {
		t.Fatalf("second server should not share the taken port %s", port)
	}
	newPort, err := b.store.getSetting(keyMediaPort)
	if err != nil || newPort == "" || newPort == port {
		t.Fatalf("fallback port not stored: %q, %v", newPort, err)
	}
}

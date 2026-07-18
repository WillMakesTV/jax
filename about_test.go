package main

import (
	"strings"
	"testing"
)

func TestAppAboutRoundTrip(t *testing.T) {
	a := newTestApp(t)

	if got := a.GetAppAbout(); got != "" {
		t.Fatalf("fresh about should be empty, got %q", got)
	}
	if err := a.SetAppAbout("Jax produces streams and videos."); err != nil {
		t.Fatalf("set about: %v", err)
	}
	if got := a.GetAppAbout(); got != "Jax produces streams and videos." {
		t.Fatalf("about round trip mismatch: %q", got)
	}
	// Blank clears.
	if err := a.SetAppAbout("  "); err != nil {
		t.Fatalf("clear about: %v", err)
	}
	if got := a.GetAppAbout(); got != "" {
		t.Fatalf("about should be cleared, got %q", got)
	}
}

func TestAppAboutAdoptsLegacyProject(t *testing.T) {
	a := newTestApp(t)

	// The app description used to live as a regular project; the first About
	// read adopts it so the move into Settings loses nothing.
	_, err := a.SaveProject(Project{
		Title:       "Project Jax - AI Content Producer & Dashboard",
		Description: "The application itself.",
	})
	if err != nil {
		t.Fatalf("save project: %v", err)
	}
	if got := a.GetAppAbout(); got != "The application itself." {
		t.Fatalf("about should adopt the legacy project description, got %q", got)
	}

	// The adoption persisted: editing the project no longer changes About.
	if v, _ := a.store.getSetting(keyAppAbout); v != "The application itself." {
		t.Fatalf("adoption not persisted, setting = %q", v)
	}

	// An explicit save always wins.
	if err := a.SetAppAbout("Rewritten."); err != nil {
		t.Fatalf("set about: %v", err)
	}
	if got := a.GetAppAbout(); got != "Rewritten." {
		t.Fatalf("about should be the saved value, got %q", got)
	}
}

func TestDescribeAppCarriesAbout(t *testing.T) {
	a := newTestApp(t)
	if err := a.SetAppAbout("Producer-authored portrait."); err != nil {
		t.Fatalf("set about: %v", err)
	}
	desc := a.DescribeApp()
	if !strings.Contains(desc.About, "Producer-authored portrait.") {
		t.Fatalf("describe_app should carry the About text: %+v", desc.About)
	}
}

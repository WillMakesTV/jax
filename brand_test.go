package main

import "testing"

func TestBrandGuidelinesRoundTrip(t *testing.T) {
	a := newTestApp(t)

	if got := a.GetBrandGuidelines(); got != "" {
		t.Fatalf("fresh guidelines should be empty, got %q", got)
	}
	if err := a.SetBrandGuidelines("## Voice\nEnergetic, never salesy."); err != nil {
		t.Fatalf("set guidelines: %v", err)
	}
	if got := a.GetBrandGuidelines(); got != "## Voice\nEnergetic, never salesy." {
		t.Fatalf("guidelines round trip mismatch: %q", got)
	}
	// Blank clears.
	if err := a.SetBrandGuidelines("  "); err != nil {
		t.Fatalf("clear guidelines: %v", err)
	}
	if got := a.GetBrandGuidelines(); got != "" {
		t.Fatalf("guidelines should be cleared, got %q", got)
	}
}

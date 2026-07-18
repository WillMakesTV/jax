package main

import "testing"

// The chat protocol splits the model's output at the description marker; a
// reply with no marker must leave the draft untouched rather than clobbering
// it with conversation text.
func TestParseProjectChatReply(t *testing.T) {
	r := parseProjectChatReply(
		"Got it — a two-week launch.\n\n---DESCRIPTION---\n# Launch\nA two-week launch.\n")
	if r.Reply != "Got it — a two-week launch." {
		t.Errorf("reply = %q", r.Reply)
	}
	if r.Description != "# Launch\nA two-week launch." {
		t.Errorf("description = %q", r.Description)
	}

	// Marker padded with whitespace still splits.
	r = parseProjectChatReply("Sure.\n  ---DESCRIPTION---  \nDraft.")
	if r.Reply != "Sure." || r.Description != "Draft." {
		t.Errorf("padded marker: reply=%q description=%q", r.Reply, r.Description)
	}

	// No marker: everything is reply, the draft stays as it was.
	r = parseProjectChatReply("What platforms does it target?")
	if r.Reply != "What platforms does it target?" || r.Description != "" {
		t.Errorf("no marker: reply=%q description=%q", r.Reply, r.Description)
	}
}

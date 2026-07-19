package main

import "testing"

func TestAnyChannelStillLive(t *testing.T) {
	a := newTestApp(t)
	// No services connected: nothing can report live, so the pipeline's live
	// wait must fall through immediately.
	if a.anyChannelStillLive() {
		t.Fatal("no connected channels should never read as live")
	}
}

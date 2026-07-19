package main

import "testing"

func TestAdoptPlanThumbs(t *testing.T) {
	a := newTestApp(t)
	streams := []PastStream{
		{StartedAt: "2026-07-19T01:00:00Z", Plan: &StreamPlanInfo{ThumbnailFile: "thumb_1.png"}},
		{StartedAt: "2026-07-19T02:00:00Z", Plan: &StreamPlanInfo{}},
		{StartedAt: "2026-07-19T03:00:00Z"},
	}
	a.adoptPlanThumbs(streams)
	m := a.streamThumbs()
	if m["2026-07-19T01:00:00Z"].File != "thumb_1.png" {
		t.Fatalf("plan thumbnail not adopted: %+v", m)
	}
	if len(m) != 1 {
		t.Fatalf("only the planned stream should adopt: %+v", m)
	}

	// A choice made on the stream's page wins — even a clear, whose history
	// keeps the record alive.
	if _, err := a.SetStreamThumbnail("2026-07-19T01:00:00Z", "mine.png"); err != nil {
		t.Fatalf("set custom thumb: %v", err)
	}
	if _, err := a.SetStreamThumbnail("2026-07-19T01:00:00Z", ""); err != nil {
		t.Fatalf("clear custom thumb: %v", err)
	}
	a.adoptPlanThumbs(streams)
	if got := a.streamThumbs()["2026-07-19T01:00:00Z"]; got.File != "" {
		t.Fatalf("cleared choice should stick, got %+v", got)
	}

	// The adopted file surfaces through the usual custom-thumb application.
	fresh := []PastStream{
		{StartedAt: "2026-07-19T04:00:00Z", Plan: &StreamPlanInfo{ThumbnailFile: "thumb_2.png"}},
	}
	a.adoptPlanThumbs(fresh)
	a.applyStreamThumbs(fresh)
	if fresh[0].CustomThumb == nil || fresh[0].CustomThumb.File != "thumb_2.png" {
		t.Fatalf("adopted thumbnail should apply: %+v", fresh[0].CustomThumb)
	}
}

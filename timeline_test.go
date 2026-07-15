package main

import (
	"encoding/json"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestValidTimelineSegments(t *testing.T) {
	cases := []struct {
		name     string
		segments []TimelineSegment
		wantErr  bool
	}{
		{"empty", nil, true},
		{"ok", []TimelineSegment{{Start: 0, End: 5}}, false},
		{"inverted", []TimelineSegment{{Start: 5, End: 1}}, true},
		{"negative start", []TimelineSegment{{Start: -1, End: 5}}, true},
		{
			"expanded with a source",
			[]TimelineSegment{{Start: 0, End: 5, Source: "ep.mp4", SourceStart: 10, SourceEnd: 15, PadStart: 2}},
			false,
		},
		{
			// A title card has no footage to expand into; the UI hides the
			// controls, and the backend refuses the render either way.
			"expanded without a source",
			[]TimelineSegment{{Start: 0, End: 5, PadStart: 2}},
			true,
		},
		{
			"negative pad",
			[]TimelineSegment{{Start: 0, End: 5, Source: "ep.mp4", PadEnd: -1}},
			true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validTimelineSegments(tc.segments)
			if (err != nil) != tc.wantErr {
				t.Fatalf("validTimelineSegments() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestNeedsSourcePadding(t *testing.T) {
	plain := []TimelineSegment{{Start: 0, End: 5, Source: "ep.mp4", SourceStart: 1, SourceEnd: 6}}
	if needsSourcePadding(plain) {
		t.Error("a segment with a source but no padding needs the single-input path")
	}
	expanded := append([]TimelineSegment{}, plain...)
	expanded[0].PadEnd = 1.5
	if !needsSourcePadding(expanded) {
		t.Error("an expanded segment needs the multi-input path")
	}
}

func TestPaddedClipsRestoresFootageAroundTheKeptSpan(t *testing.T) {
	segments := []TimelineSegment{
		// Expanded both ways: 2s of source before, 1s after.
		{Start: 0, End: 10, Source: "ep.mp4", SourceStart: 100, SourceEnd: 110, PadStart: 2, PadEnd: 1},
		// A title card: no source, so it is passed through untouched.
		{Start: 10, End: 13},
		// Expanded back past the very start of its source: clamped at 0.
		{Start: 20, End: 25, Source: "ep.mp4", SourceStart: 1, SourceEnd: 6, PadStart: 5},
	}
	clips := paddedClips(segments, map[string]int{"ep.mp4": 1})

	want := []paddedClip{
		{input: 1, start: 98, end: 100}, // restored before the first segment
		{input: 0, start: 0, end: 10},   // the rendered span, overlays intact
		{input: 1, start: 110, end: 111},
		{input: 0, start: 10, end: 13}, // the title card
		{input: 1, start: 0, end: 1},   // clamped at the source's start
		{input: 0, start: 20, end: 25},
	}
	if len(clips) != len(want) {
		t.Fatalf("got %d clips, want %d: %+v", len(clips), len(want), clips)
	}
	for i := range want {
		if clips[i] != want[i] {
			t.Errorf("clip %d = %+v, want %+v", i, clips[i], want[i])
		}
	}
}

func TestReprocessedCutsMapsSegmentsOntoTheNewRender(t *testing.T) {
	segments := []TimelineSegment{
		{Start: 0, End: 10, Source: "ep.mp4", SourceStart: 100, SourceEnd: 110, PadStart: 2, PadEnd: 1, Label: "cold open"},
		{Start: 30, End: 35}, // a title card
	}
	got := reprocessedCuts(segments, "")

	// The first segment renders 13s (2 + 10 + 1), so the second starts there.
	if len(got) != 2 {
		t.Fatalf("got %d segments, want 2", len(got))
	}
	if got[0].Start != 0 || got[0].End != 13 {
		t.Errorf("first segment spans %.1f–%.1f, want 0–13", got[0].Start, got[0].End)
	}
	// Its source span grew by the footage that was restored.
	if got[0].SourceStart != 98 || got[0].SourceEnd != 111 {
		t.Errorf("first segment's source span is %.1f–%.1f, want 98–111",
			got[0].SourceStart, got[0].SourceEnd)
	}
	if got[0].Label != "cold open" {
		t.Errorf("the label was lost: %q", got[0].Label)
	}
	// Padding is consumed by the render — it must not be reapplied next pass.
	if got[0].PadStart != 0 || got[0].PadEnd != 0 {
		t.Errorf("padding survived the render: %+v", got[0])
	}
	if got[1].Start != 13 || got[1].End != 18 {
		t.Errorf("second segment spans %.1f–%.1f, want 13–18", got[1].Start, got[1].End)
	}
	if got[1].Source != "" {
		t.Errorf("a sourceless segment gained a source: %q", got[1].Source)
	}
}

func TestReprocessedCutsTracesACutMadeStraightFromASource(t *testing.T) {
	// Cutting a downloaded source video directly: the base's own times are the
	// source's, so the segments stay expandable on the next pass.
	got := reprocessedCuts([]TimelineSegment{{Start: 60, End: 90}}, "EP04.mp4")
	if len(got) != 1 {
		t.Fatalf("got %d segments, want 1", len(got))
	}
	if got[0].Source != "EP04.mp4" || got[0].SourceStart != 60 || got[0].SourceEnd != 90 {
		t.Errorf("segment = %+v, want it traced to EP04.mp4 60–90", got[0])
	}
	if got[0].Start != 0 || got[0].End != 30 {
		t.Errorf("segment spans %.1f–%.1f in the new render, want 0–30", got[0].Start, got[0].End)
	}
}

func TestReadCutsManifest(t *testing.T) {
	dir := t.TempDir()
	a := &App{}
	// editWorkspaceDir hangs off the configured root; point it at the temp dir
	// by way of the plan id being the leaf folder.
	t.Setenv("USERPROFILE", dir)
	t.Setenv("HOME", dir)

	planID := "plan-1"
	ws := a.editWorkspaceDir(planID)
	if err := os.MkdirAll(filepath.Join(ws, "edit"), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `{
	  "video": "final.mp4",
	  "segments": [
	    {"start": 0, "end": 12.5, "source": "EP04.mp4", "sourceStart": 100, "sourceEnd": 112.5, "label": "cold open"},
	    {"start": 12.5, "end": 15, "label": "title card"},
	    {"start": 99, "end": 98, "label": "malformed — dropped"},
	    {"start": 15, "end": 20, "source": "EP04.mp4", "sourceStart": 5, "sourceEnd": 5, "label": "unusable source span"}
	  ]
	}`
	if err := os.WriteFile(filepath.Join(ws, "edit", cutsManifestName), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}

	got := a.readCutsManifest(planID)
	if got.File != "final.mp4" {
		t.Errorf("File = %q, want final.mp4", got.File)
	}
	if len(got.Segments) != 3 {
		t.Fatalf("got %d segments, want 3 (the inverted span is dropped): %+v",
			len(got.Segments), got.Segments)
	}
	if got.Segments[0].Source != "EP04.mp4" || got.Segments[0].SourceEnd != 112.5 {
		t.Errorf("the first segment lost its source span: %+v", got.Segments[0])
	}
	if got.Segments[1].Source != "" {
		t.Errorf("the title card gained a source: %+v", got.Segments[1])
	}
	// A zero-length source span can't be expanded into, so it is discarded
	// rather than handed to ffmpeg as a bad trim.
	if got.Segments[2].Source != "" {
		t.Errorf("an unusable source span survived: %+v", got.Segments[2])
	}
}

func TestReadCutsManifestMissingOrJunk(t *testing.T) {
	dir := t.TempDir()
	a := &App{}
	t.Setenv("USERPROFILE", dir)
	t.Setenv("HOME", dir)

	if got := a.readCutsManifest("nope"); got.File != "" || len(got.Segments) != 0 {
		t.Errorf("a plan with no manifest should read as empty, got %+v", got)
	}

	ws := a.editWorkspaceDir("junk")
	if err := os.MkdirAll(filepath.Join(ws, "edit"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ws, "edit", cutsManifestName), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := a.readCutsManifest("junk"); got.File != "" || len(got.Segments) != 0 {
		t.Errorf("an unreadable manifest should read as empty, got %+v", got)
	}
}

// ---------------------------------------------------------------------------
// The padded render, end to end through ffmpeg.
//
// The multi-input filter graph is the riskiest part of expanding a segment:
// clips from a source video have to be normalized to the render's resolution,
// frame rate, and audio layout before they can be concatenated onto it. These
// tests build real videos with mismatched properties and check that the render
// runs and lands on the duration the timeline promised.
// ---------------------------------------------------------------------------

// synthVideo writes a test video of the given duration and size, with audio.
func synthVideo(t *testing.T, ffmpeg, path string, secs float64, size string, fps int) {
	t.Helper()
	cmd := exec.Command(ffmpeg,
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-f", "lavfi", "-i", "testsrc=duration="+strconv.FormatFloat(secs, 'f', 2, 64)+":size="+size+":rate="+strconv.Itoa(fps),
		"-f", "lavfi", "-i", "sine=frequency=440:duration="+strconv.FormatFloat(secs, 'f', 2, 64),
		"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-shortest", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("could not build the test video %s: %v\n%s", path, err, out)
	}
}

// mediaDuration reads a file's duration in seconds.
func mediaDuration(t *testing.T, path string) float64 {
	t.Helper()
	out, err := exec.Command("ffprobe",
		"-v", "error", "-show_entries", "format=duration",
		"-of", "default=nw=1:nk=1", path).Output()
	if err != nil {
		t.Fatalf("ffprobe %s: %v", path, err)
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		t.Fatalf("ffprobe returned %q: %v", out, err)
	}
	return d
}

func TestProbeVideo(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not on PATH")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "base.mp4")
	synthVideo(t, ffmpeg, path, 3, "320x240", 30)

	p, err := probeVideo(path)
	if err != nil {
		t.Fatalf("probeVideo: %v", err)
	}
	if p.width != 320 || p.height != 240 {
		t.Errorf("probed %dx%d, want 320x240", p.width, p.height)
	}
	if !p.hasAudio {
		t.Error("the test video has an audio track; probeVideo missed it")
	}
	if p.fps == "" {
		t.Error("probeVideo returned no frame rate")
	}
}

// TestPaddedRenderJoinsMismatchedSourceFootage is the real thing: a 320x240
// 30fps "render" with a segment expanded into a 640x360 24fps source. The
// restored frames must be normalized and concatenated, and the output must come
// out at the promised length.
func TestPaddedRenderJoinsMismatchedSourceFootage(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not on PATH")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is not on PATH")
	}

	dir := t.TempDir()
	base := filepath.Join(dir, "final.mp4")
	source := filepath.Join(dir, "EP04.mp4")
	synthVideo(t, ffmpeg, base, 10, "320x240", 30)
	synthVideo(t, ffmpeg, source, 20, "640x360", 24) // deliberately mismatched

	// Keep 0–4s of the render (traced to 6–10s of the source), expanded by 2s
	// before and 1s after; then keep 6–8s of the render as a sourceless card.
	segments := []TimelineSegment{
		{Start: 0, End: 4, Source: "EP04.mp4", SourceStart: 6, SourceEnd: 10, PadStart: 2, PadEnd: 1},
		{Start: 6, End: 8},
	}

	props, err := probeVideo(base)
	if err != nil {
		t.Fatalf("probeVideo: %v", err)
	}
	clips := paddedClips(segments, map[string]int{"EP04.mp4": 1})
	filter, vOut, aOut := paddedFilter(clips, props, true)

	dst := filepath.Join(dir, "out.mp4")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", base, "-i", source,
		"-filter_complex", filter,
	}
	args = append(args, encodeArgs(true, vOut, aOut, dst)...)
	// -progress writes to stdout; the test doesn't read it, so drop it.
	args = append(args, "-nostats")

	cmd := exec.Command(ffmpeg, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("the padded render failed: %v\nfilter: %s\n%s", err, filter, out)
	}

	// 2s restored + 4s kept + 1s restored + 2s card = 9s.
	const want = 9.0
	got := mediaDuration(t, dst)
	if math.Abs(got-want) > 0.35 {
		t.Errorf("the render is %.2fs, want ~%.2fs", got, want)
	}

	// The restored footage was normalized to the render's frame, not the
	// source's — otherwise the concat would have been rejected outright.
	out, err := probeVideo(dst)
	if err != nil {
		t.Fatalf("probeVideo(out): %v", err)
	}
	if out.width != 320 || out.height != 240 {
		t.Errorf("the render is %dx%d, want the base's 320x240", out.width, out.height)
	}
	if !out.hasAudio {
		t.Error("the render lost its audio track")
	}
}

// TestTimelineFilterStillRendersUnexpandedCuts guards the single-input path —
// the common case, where nothing was expanded.
func TestTimelineFilterStillRendersUnexpandedCuts(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not on PATH")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is not on PATH")
	}

	dir := t.TempDir()
	base := filepath.Join(dir, "final.mp4")
	synthVideo(t, ffmpeg, base, 10, "320x240", 30)

	segments := []TimelineSegment{{Start: 1, End: 4}, {Start: 7, End: 9}}
	filter, vOut, aOut := timelineFilter(segments, true)

	dst := filepath.Join(dir, "out.mp4")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", base, "-filter_complex", filter,
	}
	args = append(args, encodeArgs(true, vOut, aOut, dst)...)
	args = append(args, "-nostats")
	if out, err := exec.Command(ffmpeg, args...).CombinedOutput(); err != nil {
		t.Fatalf("the plain render failed: %v\nfilter: %s\n%s", err, filter, out)
	}

	const want = 5.0 // 3s + 2s
	if got := mediaDuration(t, dst); math.Abs(got-want) > 0.35 {
		t.Errorf("the render is %.2fs, want ~%.2fs", got, want)
	}
}

// ---------------------------------------------------------------------------
// Replace-and-archive
//
// Every new cut — from an AI pass or a timeline reprocess — becomes the plan's
// video, and the cut it replaces drops into the history where it can be
// reviewed and reverted to. Nothing is ever destroyed.
// ---------------------------------------------------------------------------

// writeRender puts bytes at edit/<name> in the plan's workspace, standing in
// for a render. The mod time is set explicitly: it is what names the archived
// copy, and a real render takes minutes, so two cuts never share a timestamp.
func writeRender(t *testing.T, a *App, planID, name, content string, at time.Time) {
	t.Helper()
	dir := filepath.Join(a.editWorkspaceDir(planID), "edit")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, at, at); err != nil {
		t.Fatal(err)
	}
}

func readRender(t *testing.T, a *App, planID, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(a.editWorkspaceDir(planID), "edit", name))
	if err != nil {
		t.Fatalf("reading %s: %v", name, err)
	}
	return string(raw)
}

func TestNewCutReplacesTheVideoAndArchivesThePreviousOne(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}

	renderedAt := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)

	// The first cut, with the manifest the session wrote alongside it.
	writeRender(t, a, plan.ID, "final.mp4", "cut-1", renderedAt)
	writeRender(t, a, plan.ID, cutsManifestName, `{"video":"final.mp4",
	  "segments":[{"start":0,"end":9,"source":"EP04.mp4","sourceStart":1,"sourceEnd":10}]}`,
		renderedAt)

	versions, err := a.GetEditVersions(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 0 {
		t.Fatalf("the first cut should have no history behind it, got %d", len(versions))
	}

	// Archiving the same unchanged revision twice is a no-op, not a duplicate —
	// a session that starts and produces nothing must not pile up history.
	a.archiveEditRevision(plan.ID)
	a.archiveEditRevision(plan.ID)

	// A second pass snapshots the current revision before overwriting it —
	// exactly what StartEditRun and ExportPlanTimeline do before they render.
	writeRender(t, a, plan.ID, "final.mp4", "cut-2", renderedAt.Add(20*time.Minute))

	versions, err = a.GetEditVersions(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 {
		t.Fatalf("the replaced revision should be in the history, got %d", len(versions))
	}
	// A revision is a whole folder — the cut *and* the manifest that says where
	// its segments came from, so restoring it gives the timeline something it
	// can still open and expand.
	if !versions[0].HasCuts {
		t.Error("the archived revision did not keep its cuts manifest")
	}
	if versions[0].Legacy {
		t.Error("a folder revision should not read as legacy")
	}
	if got := readRender(t, a, plan.ID, "final.mp4"); got != "cut-2" {
		t.Errorf("the current video is %q, want the new cut", got)
	}

	// Reverting: the revision being replaced is itself snapshotted first, so
	// flipping back and forth loses nothing.
	if _, err := a.RestoreEditVersion(plan.ID, versions[0].Name); err != nil {
		t.Fatalf("RestoreEditVersion: %v", err)
	}
	if got := readRender(t, a, plan.ID, "final.mp4"); got != "cut-1" {
		t.Errorf("after reverting, the current video is %q, want cut-1", got)
	}
	// The manifest came back with it, so the timeline reopens pre-split at the
	// restored cut's own segments.
	if cuts := a.GetPlanCuts(plan.ID); len(cuts.Segments) != 1 ||
		cuts.Segments[0].Source != "EP04.mp4" {
		t.Errorf("the restored revision's cuts did not come back: %+v", cuts)
	}

	versions, err = a.GetEditVersions(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 {
		t.Fatalf("both revisions should now be in the history, got %d", len(versions))
	}
	// Every archived cut is still on disk and still playable.
	seen := map[string]bool{}
	for _, v := range versions {
		raw, err := os.ReadFile(filepath.Join(
			a.editWorkspaceDir(plan.ID), "edit", "versions", v.Name, "final.mp4"))
		if err != nil {
			t.Fatalf("archived revision %s has no cut on disk: %v", v.Name, err)
		}
		seen[string(raw)] = true
		if v.MediaURL == "" {
			t.Errorf("archived revision %s has no media URL to play from", v.Name)
		}
	}
	if !seen["cut-1"] || !seen["cut-2"] {
		t.Errorf("the history lost a cut: %v", seen)
	}
}

// Revisions archived before revisions became folders are bare .mp4 files.
// They must stay listed and stay restorable — the producer's existing history
// is not disposable.
func TestLegacyFileRevisionsStayListedAndRestorable(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 7, 9, 23, 16, 1, 0, time.UTC)
	writeRender(t, a, plan.ID, "final.mp4", "current", at.Add(time.Hour))

	// The shape the old archiver left behind.
	versions := filepath.Join(a.editWorkspaceDir(plan.ID), "edit", "versions")
	if err := os.MkdirAll(versions, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(versions, "final-20260709-231601.mp4")
	if err := os.WriteFile(legacy, []byte("old-cut"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(legacy, at, at); err != nil {
		t.Fatal(err)
	}

	list, err := a.GetEditVersions(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || !list[0].Legacy {
		t.Fatalf("the legacy revision should be listed as legacy, got %+v", list)
	}
	if list[0].HasCuts {
		t.Error("a legacy revision has no manifest and must not claim one")
	}

	if _, err := a.RestoreEditVersion(plan.ID, list[0].Name); err != nil {
		t.Fatalf("restoring a legacy revision: %v", err)
	}
	if got := readRender(t, a, plan.ID, "final.mp4"); got != "old-cut" {
		t.Errorf("the restored video is %q, want old-cut", got)
	}
	// The cut it replaced was snapshotted on the way, as a proper folder.
	list, err = a.GetEditVersions(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("the replaced cut should have been archived, got %d revisions", len(list))
	}
}

func TestRestoreRejectsUnknownVersionNames(t *testing.T) {
	a := newTestApp(t)
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "Boss fight", Format: "long"})
	if err != nil {
		t.Fatal(err)
	}
	writeRender(t, a, plan.ID, "final.mp4", "cut-1",
		time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC))

	// A name that doesn't map to a render output must not be copied over the
	// live video — this is the path a crafted name would take.
	if _, err := a.RestoreEditVersion(plan.ID, "../../project.md"); err == nil {
		t.Error("want an error restoring a name that isn't a render output")
	}
	if got := readRender(t, a, plan.ID, "final.mp4"); got != "cut-1" {
		t.Errorf("the current video was clobbered: %q", got)
	}
}

// ---------------------------------------------------------------------------
// What the timeline opens with
//
// The whole point of the manifest is that the video arrives pre-split at the
// cuts the session made, each traced to its source so it can be expanded. A
// saved cut outranks it — but only while it still describes the video that is
// actually there.
// ---------------------------------------------------------------------------

// seedManifestPlan gives a plan a rendered cut and the segment map the edit
// session wrote for it.
func seedManifestPlan(t *testing.T, a *App) VideoPlan {
	t.Helper()
	plan, err := a.SaveVideoPlan(VideoPlan{Title: "AI Video Editing", Format: "short"})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)
	writeRender(t, a, plan.ID, "final.mp4", "the-cut", at)
	writeRender(t, a, plan.ID, cutsManifestName, `{
	  "video": "final.mp4",
	  "segments": [
	    {"start": 0, "end": 3, "source": "EP08.mp4", "sourceStart": 2919.189, "sourceEnd": 2922.189, "label": "cold open"},
	    {"start": 3, "end": 10.4, "source": "EP08.mp4", "sourceStart": 2190.839, "sourceEnd": 2198.239, "label": "transcribed live"},
	    {"start": 10.4, "end": 19.4, "source": "EP08.mp4", "sourceStart": 2253.489, "sourceEnd": 2262.522, "label": "merges transcripts"}
	  ]
	}`, at)
	return plan
}

func TestTimelineOpensPreSplitFromTheSessionsManifest(t *testing.T) {
	a := newTestApp(t)
	plan := seedManifestPlan(t, a)

	cuts := a.GetPlanCuts(plan.ID)
	if cuts.File != "final.mp4" {
		t.Fatalf("File = %q, want final.mp4", cuts.File)
	}
	if len(cuts.Segments) != 3 {
		t.Fatalf("the video opened with %d segment(s), want it pre-split into 3: %+v",
			len(cuts.Segments), cuts.Segments)
	}
	// Every segment traces back to its footage — that is what makes it
	// expandable.
	for i, s := range cuts.Segments {
		if s.Source == "" || s.SourceEnd <= s.SourceStart {
			t.Errorf("segment %d cannot be expanded (no usable source span): %+v", i, s)
		}
	}
	if cuts.Segments[0].Label != "cold open" {
		t.Errorf("segment labels were lost: %+v", cuts.Segments[0])
	}
}

// The regression that made every processed video open as one segment: the
// timeline used to persist its un-split fallback before the producer had
// touched anything, and that placeholder then outranked the manifest forever.
func TestAPlaceholderCutNeverShadowsTheManifest(t *testing.T) {
	a := newTestApp(t)
	plan := seedManifestPlan(t, a)

	// Exactly what used to get written: the whole video as one sourceless
	// segment, from a session saved before SavedAt was tracked.
	timelines := a.planTimelines()
	timelines[plan.ID] = PlanTimeline{
		File:     "final.mp4",
		Segments: []TimelineSegment{{Start: 0, End: 59.166667}},
		// no SavedAt — the shape the old code left in the store
	}
	if err := a.store.setJSON(keyPlanTimelines, timelines); err != nil {
		t.Fatal(err)
	}

	cuts := a.GetPlanCuts(plan.ID)
	if len(cuts.Segments) != 3 {
		t.Fatalf("a placeholder cut shadowed the manifest — opened with %d segment(s), want 3",
			len(cuts.Segments))
	}
	if cuts.Segments[0].Source == "" {
		t.Error("the segments came back without their source mapping")
	}
}

// A cut the producer is actually part-way through must survive — it is only
// discarded once the video underneath it has been re-rendered.
func TestAnInProgressCutSurvivesButAStaleOneDoesNot(t *testing.T) {
	a := newTestApp(t)
	plan := seedManifestPlan(t, a)

	// The producer splits the cut into two segments and walks away.
	inProgress := PlanTimeline{
		File: "final.mp4",
		Segments: []TimelineSegment{
			{Start: 0, End: 5, Source: "EP08.mp4", SourceStart: 2919, SourceEnd: 2924},
			{Start: 5, End: 19.4, Source: "EP08.mp4", SourceStart: 2253, SourceEnd: 2262},
		},
	}
	if err := a.SavePlanTimeline(plan.ID, inProgress); err != nil {
		t.Fatal(err)
	}
	if got := a.GetPlanCuts(plan.ID); len(got.Segments) != 2 {
		t.Fatalf("the producer's own cut was thrown away, got %d segments", len(got.Segments))
	}

	// Now a new pass re-renders the video underneath that cut. Its segment
	// times describe a video that no longer exists, so the manifest — which the
	// session rewrote for the new cut — takes over again.
	writeRender(t, a, plan.ID, "final.mp4", "a-newer-cut",
		time.Now().Add(time.Hour))

	got := a.GetPlanCuts(plan.ID)
	if len(got.Segments) != 3 {
		t.Fatalf("a stale cut survived a re-render — opened with %d segment(s), want the manifest's 3",
			len(got.Segments))
	}
}

// ---------------------------------------------------------------------------
// Season folders
// ---------------------------------------------------------------------------

func TestSeasonFolderName(t *testing.T) {
	cases := map[string]string{
		"":            "",
		"   ":         "",
		"1":           "Season 1",
		"2":           "Season 2",
		"Season 3":    "Season 3",
		"Winter 2026": "Winter 2026",
		// Not a bare number, so used as written — with the slash sanitized, or
		// it would carve out a folder level nobody asked for.
		"1/2": "1-2",
	}
	for in, want := range cases {
		if got := seasonFolderName(in); got != want {
			t.Errorf("seasonFolderName(%q) = %q, want %q", in, got, want)
		}
	}
}

// seedSeasonPlan wires a plan to a past stream in a series with the given
// season — which is what puts its workspace on that season's shelf. It goes
// through the real path: the past-broadcast cache GetPastStreams reads, and the
// broadcast → series assignment the user makes on the stream's page.
func seedSeasonPlan(t *testing.T, a *App, season string) VideoPlan {
	t.Helper()
	series, err := a.SaveContentSeries(ContentSeries{
		Title:           "WillMakes.tv",
		Season:          season,
		TwitchCategory:  ServiceCategory{ID: "1", Name: "Software"},
		YouTubeCategory: ServiceCategory{ID: "28", Name: "Science & Technology"},
		KickCategory:    ServiceCategory{ID: "1", Name: "Software"},
	})
	if err != nil {
		t.Fatal(err)
	}

	startedAt := "2026-07-01T12:00:00Z"
	broadcast := PastBroadcast{
		Platform:  "youtube",
		Title:     "Episode 1",
		URL:       "https://youtu.be/ep1",
		StartedAt: startedAt,
	}
	raw, err := json.Marshal([]PastBroadcast{broadcast})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.store.setCacheEntry(a.connsCacheKey("past_broadcasts"), string(raw)); err != nil {
		t.Fatal(err)
	}
	if err := a.SetPastStreamSeries([]string{broadcastKey(broadcast)}, series.ID); err != nil {
		t.Fatal(err)
	}

	// Guard the fixture itself: if the stream doesn't come back carrying the
	// series, the season assertions below would pass or fail for the wrong
	// reason.
	streams := a.GetPastStreams(false)
	if len(streams) != 1 || streams[0].SeriesID != series.ID {
		t.Fatalf("fixture: the past stream did not pick up its series: %+v", streams)
	}

	plan, err := a.SaveVideoPlan(VideoPlan{
		Title:   "Highlights",
		Format:  "long",
		Streams: []VideoPlanStream{{StartedAt: startedAt, Title: "Episode 1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestWorkspaceIsFiledUnderTheSourceSeriesSeason(t *testing.T) {
	a := newTestApp(t)
	plan := seedSeasonPlan(t, a, "1")

	root := a.resolveEditRoot()
	want := filepath.Join(root, "Season 1", plan.ID)
	if got := a.editWorkspaceDir(plan.ID); got != want {
		t.Errorf("workspace = %q, want %q", got, want)
	}
	// The URL has to walk the same path, or the player 404s on its own video.
	url := a.editWorkspaceURL("http://127.0.0.1:1234", plan.ID)
	if !strings.Contains(url, "/edits/Season%201/"+plan.ID) {
		t.Errorf("media URL = %q, want it under the season folder", url)
	}
	// Every plan still gets its own folder — the season is only the shelf.
	if !strings.HasSuffix(a.editWorkspaceDir(plan.ID), plan.ID) {
		t.Error("the plan lost its own vplan_* folder")
	}
}

func TestWorkspaceStaysFlatWithoutASeason(t *testing.T) {
	a := newTestApp(t)
	plan := seedSeasonPlan(t, a, "") // series has no season

	want := filepath.Join(a.resolveEditRoot(), plan.ID)
	if got := a.editWorkspaceDir(plan.ID); got != want {
		t.Errorf("workspace = %q, want it directly under the root (%q)", got, want)
	}
}

// The migration: workspaces created before seasons existed sit flat under the
// root, and must be filed under their season without losing the renders in
// them.
func TestRelocateMovesExistingWorkspacesUnderTheirSeason(t *testing.T) {
	a := newTestApp(t)
	plan := seedSeasonPlan(t, a, "1")

	// Put the workspace where the old flat layout left it, with a render and a
	// revision already archived inside.
	root := a.resolveEditRoot()
	flat := filepath.Join(root, plan.ID)
	if err := os.MkdirAll(filepath.Join(flat, "edit", "versions", "20260709-231601.000"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(flat, "edit", "final.mp4"), []byte("cut"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(flat, "edit", "versions", "20260709-231601.000", "final.mp4"),
		[]byte("old-cut"), 0o644); err != nil {
		t.Fatal(err)
	}

	a.relocateEditWorkspaces()

	want := filepath.Join(root, "Season 1", plan.ID)
	if !isDir(want) {
		t.Fatalf("the workspace was not filed under its season (%q)", want)
	}
	if isDir(flat) {
		t.Error("the old flat folder is still there — the workspace was copied, not moved")
	}
	// The renders — current and archived — came along.
	if raw, err := os.ReadFile(filepath.Join(want, "edit", "final.mp4")); err != nil ||
		string(raw) != "cut" {
		t.Errorf("the current video did not survive the move: %v", err)
	}
	versions, err := a.GetEditVersions(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 {
		t.Fatalf("the revision history did not survive the move, got %d", len(versions))
	}

	// Running it again is a no-op, not a second move.
	a.relocateEditWorkspaces()
	if !isDir(want) {
		t.Error("a second pass moved the workspace somewhere else")
	}
}

// Bumping the series to a new season re-files the videos cut from it.
func TestChangingTheSeasonRefilesTheWorkspace(t *testing.T) {
	a := newTestApp(t)
	plan := seedSeasonPlan(t, a, "1")

	root := a.resolveEditRoot()
	s1 := filepath.Join(root, "Season 1", plan.ID)
	if err := os.MkdirAll(filepath.Join(s1, "edit"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s1, "edit", "final.mp4"), []byte("cut"), 0o644); err != nil {
		t.Fatal(err)
	}

	// The show moves to season 2.
	series := a.GetContentSeries()
	if len(series) != 1 {
		t.Fatalf("want one series, got %d", len(series))
	}
	series[0].Season = "2"
	if _, err := a.SaveContentSeries(series[0]); err != nil {
		t.Fatal(err)
	}
	a.relocateEditWorkspaces() // SaveContentSeries also fires this in the background

	want := filepath.Join(root, "Season 2", plan.ID)
	if !isDir(want) {
		t.Fatalf("the workspace was not re-filed under Season 2 (%q)", want)
	}
	if raw, err := os.ReadFile(filepath.Join(want, "edit", "final.mp4")); err != nil ||
		string(raw) != "cut" {
		t.Errorf("the video did not survive the re-file: %v", err)
	}
	// The emptied Season 1 shelf is tidied away.
	if isDir(filepath.Join(root, "Season 1")) {
		t.Error("the emptied Season 1 folder was left behind")
	}
}

// TestCutsManifestRoundTrip: what an edit session writes is what the timeline
// reads back, and what a reprocess writes is readable again.
func TestCutsManifestRoundTrip(t *testing.T) {
	dir := t.TempDir()
	a := &App{}
	t.Setenv("USERPROFILE", dir)
	t.Setenv("HOME", dir)

	planID := "round-trip"
	if err := os.MkdirAll(filepath.Join(a.editWorkspaceDir(planID), "edit"), 0o755); err != nil {
		t.Fatal(err)
	}

	cut := PlanTimeline{
		File: "final.mp4",
		Segments: []TimelineSegment{
			{Start: 0, End: 13, Source: "EP04.mp4", SourceStart: 98, SourceEnd: 111, Label: "cold open"},
			{Start: 13, End: 18, Label: "title card"},
		},
	}
	a.writeCutsManifest(planID, cut)

	raw, err := os.ReadFile(filepath.Join(a.editWorkspaceDir(planID), "edit", cutsManifestName))
	if err != nil {
		t.Fatalf("the manifest was not written: %v", err)
	}
	var m cutsManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("the manifest is not valid JSON: %v\n%s", err, raw)
	}

	got := a.readCutsManifest(planID)
	if got.File != cut.File || len(got.Segments) != len(cut.Segments) {
		t.Fatalf("round trip lost the cut: %+v", got)
	}
	if got.Segments[0].Label != "cold open" || got.Segments[0].SourceStart != 98 {
		t.Errorf("round trip lost the source mapping: %+v", got.Segments[0])
	}
}

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Manual timeline editing
//
// The timeline lives inside the Editor tab, beneath the player: a cuts-focused
// pass over one video in the plan's workspace (a rendered output or a
// downloaded source). The producer splits, trims, deletes, and reorders
// segments — and, for segments the editing session traced back to their source
// footage, expands them into the frames on either side. Reprocessing renders
// the cut to edit/final.mp4 through ffmpeg, archiving the render it replaces
// like an edit session would (see the version history in editor.go).
//
// The video arrives pre-split from edit/cuts.json, the manifest every edit
// session writes (see the "Video edit sessions" skill): the segments of the
// finished video and, for each, the source span it came from. Reprocessing
// rewrites that manifest from what it rendered, so the next pass — manual or
// AI — sees the video as it now is. The in-progress timeline persists per plan,
// so half-finished cuts survive navigation.
// ---------------------------------------------------------------------------

// TimelineSegment is one kept span of the base video, in seconds.
type TimelineSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	// Source names the original video (in the workspace root) this span was
	// cut from, with SourceStart/SourceEnd the span it was taken from — the
	// edit session records them in edit/cuts.json. Empty for material with no
	// single source (title cards, generated overlays), which cannot expand.
	Source      string  `json:"source"`
	SourceStart float64 `json:"sourceStart"`
	SourceEnd   float64 `json:"sourceEnd"`
	// PadStart/PadEnd are seconds of original source footage restored before
	// and after the span — the expansion controls. The rendered span between
	// Start and End is always kept as-is, so burned-in captions and overlays
	// inside the segment survive; only the restored frames come raw from the
	// source.
	PadStart float64 `json:"padStart"`
	PadEnd   float64 `json:"padEnd"`
	// Label is the edit session's short description of the beat.
	Label string `json:"label"`
}

// PlanTimeline is a plan's manual cut: the base video and the kept segments
// in playback order.
type PlanTimeline struct {
	// File is the base video's name inside the plan's workspace: a render
	// output ("final.mp4", "preview.mp4" — resolved in edit/) or a source
	// video's file name (workspace root).
	File     string            `json:"file"`
	Segments []TimelineSegment `json:"segments"`
	// SavedAt is when the producer last touched this cut (RFC3339). It is what
	// tells an in-progress cut apart from a stale one: a cut describes the
	// video as it was when it was saved, so once that video is re-rendered the
	// cut's times mean nothing and the workspace's own manifest is the truth
	// again. Empty = saved before this was tracked, and therefore stale.
	SavedAt string `json:"savedAt"`
}

// keyPlanTimelines stores the planID → timeline map.
const keyPlanTimelines = "video_plan_timelines"

// cutsManifestName is the segment map an edit session writes next to its
// renders; it is what pre-splits the timeline.
const cutsManifestName = "cuts.json"

// planTimelines loads the saved timelines. Never nil.
func (a *App) planTimelines() map[string]PlanTimeline {
	m := map[string]PlanTimeline{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyPlanTimelines, &m); err != nil {
			log.Printf("jax: load plan timelines: %v", err)
		}
	}
	if m == nil {
		return map[string]PlanTimeline{}
	}
	return m
}

// GetPlanTimeline returns a plan's saved timeline (zero value when none).
func (a *App) GetPlanTimeline(planID string) PlanTimeline {
	t := a.planTimelines()[planID]
	if t.Segments == nil {
		t.Segments = []TimelineSegment{}
	}
	return t
}

// SavePlanTimeline persists a plan's in-progress manual cut. Only call it for
// an actual producer edit — a cut saved here outranks the workspace's own
// manifest until the video is re-rendered, so persisting a placeholder (say,
// the whole video as one segment, before anything has been touched) would
// shadow the segments the edit session recorded.
func (a *App) SavePlanTimeline(planID string, t PlanTimeline) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	if t.Segments == nil {
		t.Segments = []TimelineSegment{}
	}
	t.SavedAt = time.Now().UTC().Format(time.RFC3339)
	timelines := a.planTimelines()
	timelines[planID] = t
	return a.store.setJSON(keyPlanTimelines, timelines)
}

// resetPlanTimeline drops a plan's in-progress manual cut, so the timeline
// reopens from the workspace's own manifest (edit/cuts.json) instead.
//
// Called whenever the video underneath the timeline is replaced — a finished
// edit session, a restored revision. Without it the timeline would still be
// holding the segments of a cut that is no longer the video: the strip would
// pre-split the new video at the old video's boundaries, and reprocessing would
// cut it at times that mean nothing.
func (a *App) resetPlanTimeline(planID string) {
	if a.store == nil {
		return
	}
	timelines := a.planTimelines()
	if _, ok := timelines[planID]; !ok {
		return
	}
	delete(timelines, planID)
	if err := a.store.setJSON(keyPlanTimelines, timelines); err != nil {
		log.Printf("jax: reset timeline for %s: %v", planID, err)
	}
}

// cutsManifest is edit/cuts.json as the edit session writes it.
type cutsManifest struct {
	Video    string            `json:"video"`
	Segments []TimelineSegment `json:"segments"`
}

// readCutsManifest loads the edit session's segment map for a plan. Returns a
// zero timeline when there is no manifest (or it is unusable) — a plan whose
// video predates the manifest simply opens as one un-split segment.
func (a *App) readCutsManifest(planID string) PlanTimeline {
	raw, err := os.ReadFile(filepath.Join(a.editWorkspaceDir(planID), "edit", cutsManifestName))
	if err != nil {
		return PlanTimeline{}
	}
	var m cutsManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		log.Printf("jax: read cuts manifest for %s: %v", planID, err)
		return PlanTimeline{}
	}
	// The session is instructed to write final.mp4; tolerate a missing name.
	file := filepath.Base(strings.TrimSpace(m.Video))
	if file == "" || file == "." {
		file = "final.mp4"
	}
	segments := make([]TimelineSegment, 0, len(m.Segments))
	for _, s := range m.Segments {
		if s.End <= s.Start || s.Start < 0 {
			continue // a malformed span would corrupt the whole strip
		}
		// The manifest describes the render; padding is the producer's to add.
		s.PadStart, s.PadEnd = 0, 0
		s.Source = filepath.Base(strings.TrimSpace(s.Source))
		if s.Source == "." || s.Source == "/" {
			s.Source = ""
		}
		// A source span that doesn't describe a real range can't be expanded.
		if s.SourceEnd <= s.SourceStart || s.SourceStart < 0 {
			s.Source, s.SourceStart, s.SourceEnd = "", 0, 0
		}
		segments = append(segments, s)
	}
	if len(segments) == 0 {
		return PlanTimeline{}
	}
	return PlanTimeline{File: file, Segments: segments}
}

// writeCutsManifest records the timeline as the workspace's cuts.json, so the
// next pass — the editing session or another manual cut — sees the video as it
// now is.
func (a *App) writeCutsManifest(planID string, t PlanTimeline) {
	raw, err := json.MarshalIndent(cutsManifest{Video: t.File, Segments: t.Segments}, "", "  ")
	if err != nil {
		return
	}
	path := filepath.Join(a.editWorkspaceDir(planID), "edit", cutsManifestName)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		log.Printf("jax: write cuts manifest for %s: %v", planID, err)
	}
}

// timelineIsStale reports whether a saved cut describes a video that no longer
// exists — its base render has been re-rendered since the cut was saved, so its
// segment times point into a video that is gone.
//
// A cut with no SavedAt was stored before this was tracked and is treated as
// stale: those are exactly the placeholder cuts that used to shadow the
// manifest.
func (a *App) timelineIsStale(planID string, saved PlanTimeline) bool {
	if saved.SavedAt == "" {
		return true
	}
	savedAt, err := time.Parse(time.RFC3339, saved.SavedAt)
	if err != nil {
		return true
	}
	path, err := a.timelineBasePath(planID, saved.File)
	if err != nil {
		return true // the video it was cut from isn't there any more
	}
	fi, err := os.Stat(path)
	if err != nil {
		return true
	}
	// The render is newer than the cut: a session (or a reprocess) replaced the
	// video underneath it. One second of slack — the cut is saved moments after
	// an export writes the file it describes.
	return fi.ModTime().After(savedAt.Add(time.Second))
}

// GetPlanCuts is what the timeline opens with: the producer's in-progress cut
// when they have one and it still describes the current video, otherwise the
// edit session's own segment map (edit/cuts.json), which pre-splits the video
// at the cuts it actually made and traces each one back to its source footage —
// which is what makes a segment expandable. With neither, the timeline starts
// from the whole video as one un-split segment.
func (a *App) GetPlanCuts(planID string) PlanTimeline {
	saved := a.GetPlanTimeline(planID)
	if saved.File != "" && len(saved.Segments) > 0 && !a.timelineIsStale(planID, saved) {
		return saved
	}
	t := a.readCutsManifest(planID)
	if t.Segments == nil {
		t.Segments = []TimelineSegment{}
	}
	return t
}

// reprocessedCuts maps the segments just exported onto the timeline of the
// render they were exported into: each segment's new span is its padded length
// laid end to end, and its source span grows by the padding that was restored.
// baseSource names the base video when it is itself a source video, which makes
// segments cut straight from source footage expandable on the next pass.
func reprocessedCuts(segments []TimelineSegment, baseSource string) []TimelineSegment {
	out := make([]TimelineSegment, 0, len(segments))
	var at float64
	for _, s := range segments {
		length := s.PadStart + (s.End - s.Start) + s.PadEnd
		if length <= 0 {
			continue
		}
		next := TimelineSegment{Start: at, End: at + length, Label: s.Label}
		switch {
		case s.Source != "":
			next.Source = s.Source
			next.SourceStart = math.Max(0, s.SourceStart-s.PadStart)
			next.SourceEnd = s.SourceEnd + s.PadEnd
		case baseSource != "":
			// Cut straight from a source video: the base's own times are the
			// source's, so the new segment stays traceable.
			next.Source = baseSource
			next.SourceStart = s.Start
			next.SourceEnd = s.End
		}
		out = append(out, next)
		at = next.End
	}
	return out
}

// timelineBasePath resolves the timeline's base video inside the workspace.
func (a *App) timelineBasePath(planID, file string) (string, error) {
	file = filepath.Base(strings.TrimSpace(file))
	if file == "" || file == "." {
		return "", fmt.Errorf("pick the video to cut first")
	}
	dir := a.editWorkspaceDir(planID)
	for _, name := range editOutputNames {
		if strings.EqualFold(file, name) {
			p := filepath.Join(dir, "edit", name)
			if fileExists(p) {
				return p, nil
			}
			return "", fmt.Errorf("no rendered %s in the workspace yet", name)
		}
	}
	p := filepath.Join(dir, file)
	if fileExists(p) {
		return p, nil
	}
	return "", fmt.Errorf("%s is not in the plan's workspace — prepare the workspace first", file)
}

// validTimelineSegments orders and sanity-checks the cut.
func validTimelineSegments(segments []TimelineSegment) error {
	if len(segments) == 0 {
		return fmt.Errorf("the timeline has no segments to export")
	}
	if len(segments) > 200 {
		return fmt.Errorf("too many segments — merge some cuts first")
	}
	for _, s := range segments {
		if s.Start < 0 || s.End <= s.Start {
			return fmt.Errorf("a segment has an invalid range — adjust the cut")
		}
		if s.PadStart < 0 || s.PadEnd < 0 {
			return fmt.Errorf("a segment is expanded by a negative amount — reset it")
		}
		if (s.PadStart > 0 || s.PadEnd > 0) && s.Source == "" {
			return fmt.Errorf("a segment with no source footage cannot be expanded — reset it")
		}
	}
	return nil
}

// needsSourcePadding reports whether any segment was expanded into its source
// footage — the cut then has to be rendered from several inputs.
func needsSourcePadding(segments []TimelineSegment) bool {
	for _, s := range segments {
		if s.Source != "" && (s.PadStart > 0 || s.PadEnd > 0) {
			return true
		}
	}
	return false
}

// videoProps are the base render's properties, which every clip joined onto it
// is normalized to.
type videoProps struct {
	width, height int
	fps           string // ffmpeg r_frame_rate, e.g. "30000/1001"
	hasAudio      bool
}

// probeVideo reads a video's dimensions, frame rate, and whether it carries
// audio.
func probeVideo(path string) (videoProps, error) {
	var p videoProps
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		return p, fmt.Errorf("ffprobe was not found on PATH — it ships with ffmpeg and is needed to expand segments")
	}
	cmd := exec.Command(ffprobe,
		"-v", "error",
		"-show_entries", "stream=codec_type,width,height,r_frame_rate",
		"-of", "json", path)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return p, fmt.Errorf("could not read %s: %v", filepath.Base(path), err)
	}
	var probed struct {
		Streams []struct {
			CodecType  string `json:"codec_type"`
			Width      int    `json:"width"`
			Height     int    `json:"height"`
			RFrameRate string `json:"r_frame_rate"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &probed); err != nil {
		return p, fmt.Errorf("could not read %s: %v", filepath.Base(path), err)
	}
	for _, s := range probed.Streams {
		switch s.CodecType {
		case "video":
			if p.width == 0 && s.Width > 0 && s.Height > 0 {
				p.width, p.height, p.fps = s.Width, s.Height, s.RFrameRate
			}
		case "audio":
			p.hasAudio = true
		}
	}
	if p.width == 0 || p.height == 0 {
		return p, fmt.Errorf("%s has no video track", filepath.Base(path))
	}
	if p.fps == "" || p.fps == "0/0" {
		p.fps = "30"
	}
	return p, nil
}

// paddedClip is one span of one input file in the final playback order.
type paddedClip struct {
	input      int // ffmpeg input index
	start, end float64
}

// paddedClips expands the timeline into the flat list of clips the render
// concatenates: for every segment, the restored footage before it (raw from the
// source), the rendered span itself (from the base video, overlays intact), and
// the restored footage after it.
// Restored footage that runs past the end of its source is not clamped here —
// ffmpeg's trim simply stops at the last frame there is.
func paddedClips(segments []TimelineSegment, inputOf map[string]int) []paddedClip {
	clips := make([]paddedClip, 0, len(segments))
	for _, s := range segments {
		idx, expandable := inputOf[s.Source]
		if expandable && s.PadStart > 0 {
			if start := math.Max(0, s.SourceStart-s.PadStart); start < s.SourceStart {
				clips = append(clips, paddedClip{input: idx, start: start, end: s.SourceStart})
			}
		}
		clips = append(clips, paddedClip{input: 0, start: s.Start, end: s.End})
		if expandable && s.PadEnd > 0 {
			clips = append(clips, paddedClip{input: idx, start: s.SourceEnd, end: s.SourceEnd + s.PadEnd})
		}
	}
	return clips
}

// paddedFilter builds the filter_complex that trims every clip, normalizes it
// to the base render's format (clips restored from source footage can differ in
// resolution, frame rate, and audio layout), and concatenates the lot.
func paddedFilter(clips []paddedClip, p videoProps, audio bool) (filter, vOut, aOut string) {
	var b strings.Builder
	for i, c := range clips {
		fmt.Fprintf(&b,
			"[%d:v]trim=start=%.3f:end=%.3f,setpts=PTS-STARTPTS,"+
				"scale=%d:%d:force_original_aspect_ratio=decrease,"+
				"pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=%s[v%d];",
			c.input, c.start, c.end, p.width, p.height, p.width, p.height, p.fps, i)
		if audio {
			fmt.Fprintf(&b,
				"[%d:a]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS,"+
					"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a%d];",
				c.input, c.start, c.end, i)
		}
	}
	for i := range clips {
		fmt.Fprintf(&b, "[v%d]", i)
		if audio {
			fmt.Fprintf(&b, "[a%d]", i)
		}
	}
	if audio {
		fmt.Fprintf(&b, "concat=n=%d:v=1:a=1[v][a]", len(clips))
		return b.String(), "[v]", "[a]"
	}
	fmt.Fprintf(&b, "concat=n=%d:v=1:a=0[v]", len(clips))
	return b.String(), "[v]", ""
}

// emitTimelineProgress forwards one export progress line to the frontend.
func (a *App) emitTimelineProgress(planID, detail string) {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "timeline:progress", planID, detail)
	}
}

// timelineFilter builds the ffmpeg filter_complex that trims each segment and
// concatenates them, with or without audio.
func timelineFilter(segments []TimelineSegment, audio bool) (filter, vOut, aOut string) {
	var b strings.Builder
	for i, s := range segments {
		fmt.Fprintf(&b, "[0:v]trim=start=%.3f:end=%.3f,setpts=PTS-STARTPTS[v%d];", s.Start, s.End, i)
		if audio {
			fmt.Fprintf(&b, "[0:a]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS[a%d];", s.Start, s.End, i)
		}
	}
	for i := range segments {
		fmt.Fprintf(&b, "[v%d]", i)
		if audio {
			fmt.Fprintf(&b, "[a%d]", i)
		}
	}
	if audio {
		fmt.Fprintf(&b, "concat=n=%d:v=1:a=1[v][a]", len(segments))
		return b.String(), "[v]", "[a]"
	}
	fmt.Fprintf(&b, "concat=n=%d:v=1:a=0[v]", len(segments))
	return b.String(), "[v]", ""
}

// encodeArgs are the shared output settings of every timeline render.
func encodeArgs(audio bool, vOut, aOut, dst string) []string {
	args := []string{"-map", vOut}
	if audio {
		args = append(args, "-map", aOut, "-c:a", "aac", "-b:a", "192k")
	}
	return append(args,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
		"-movflags", "+faststart",
		"-progress", "pipe:1",
		dst,
	)
}

// runTimelineExport runs one ffmpeg render of the cut, reporting progress as
// a percentage of the cut's total duration.
func (a *App) runTimelineExport(planID, ffmpeg, src, dst string, segments []TimelineSegment, audio bool) error {
	filter, vOut, aOut := timelineFilter(segments, audio)
	args := append([]string{
		"-hide_banner", "-nostats", "-nostdin", "-y",
		"-i", src,
		"-filter_complex", filter,
	}, encodeArgs(audio, vOut, aOut, dst)...)

	var total float64
	for _, s := range segments {
		total += s.End - s.Start
	}
	return a.runFFmpegProgress(planID, ffmpeg, args, total)
}

// runPaddedExport renders a cut whose segments were expanded into their source
// footage: the base render and every source it borrows from feed one graph, so
// the rendered spans keep their overlays while the restored frames come raw
// from the original video.
func (a *App) runPaddedExport(planID, ffmpeg, src, dst string, segments []TimelineSegment) error {
	base, err := probeVideo(src)
	if err != nil {
		return err
	}

	// The sources borrowed from, in a stable order, become ffmpeg inputs 1..n
	// (the base render is input 0). Audio survives only if every input has it.
	dir := a.editWorkspaceDir(planID)
	inputOf := map[string]int{}
	var paths []string
	audio := base.hasAudio
	for _, s := range segments {
		if s.Source == "" || (s.PadStart <= 0 && s.PadEnd <= 0) {
			continue
		}
		if _, seen := inputOf[s.Source]; seen {
			continue
		}
		path := filepath.Join(dir, s.Source)
		if !fileExists(path) {
			return fmt.Errorf("%s is not in the plan's workspace — refresh the workspace on the Editor tab, then reprocess", s.Source)
		}
		props, err := probeVideo(path)
		if err != nil {
			return err
		}
		if !props.hasAudio {
			audio = false
		}
		inputOf[s.Source] = len(paths) + 1
		paths = append(paths, path)
	}

	clips := paddedClips(segments, inputOf)
	if len(clips) == 0 {
		return fmt.Errorf("the timeline has nothing to render")
	}
	if len(clips) > 600 {
		return fmt.Errorf("too many clips to render at once — merge some cuts or reset a few expansions")
	}

	filter, vOut, aOut := paddedFilter(clips, base, audio)
	args := []string{"-hide_banner", "-nostats", "-nostdin", "-y", "-i", src}
	for _, p := range paths {
		args = append(args, "-i", p)
	}
	args = append(args, "-filter_complex", filter)
	args = append(args, encodeArgs(audio, vOut, aOut, dst)...)

	var total float64
	for _, c := range clips {
		total += c.end - c.start
	}
	return a.runFFmpegProgress(planID, ffmpeg, args, total)
}

// runFFmpegProgress runs one ffmpeg render, reporting progress as a percentage
// of the cut's total duration.
func (a *App) runFFmpegProgress(planID, ffmpeg string, args []string, total float64) error {
	cmd := exec.Command(ffmpeg, args...)
	hideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var errTail strings.Builder
	cmd.Stderr = &errTail
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("ffmpeg could not start: %v", err)
	}

	scanner := bufio.NewScanner(stdout)
	lastPct := -1
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// ffmpeg's out_time_ms is microseconds (a long-standing quirk).
		if v, ok := strings.CutPrefix(line, "out_time_ms="); ok && total > 0 {
			if us, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
				pct := int(us / 10_000 / total)
				if pct > 99 {
					pct = 99
				}
				if pct != lastPct {
					lastPct = pct
					a.emitTimelineProgress(planID, fmt.Sprintf("Rendering the cut — %d%%", pct))
				}
			}
		}
	}
	if err := cmd.Wait(); err != nil {
		tail := strings.TrimSpace(errTail.String())
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		return fmt.Errorf("ffmpeg failed: %s", firstNonEmpty(tail, err.Error()))
	}
	return nil
}

// hasNoAudioStream reports whether an ffmpeg failure looks like the base
// video simply has no audio track (the filter then retries video-only).
func hasNoAudioStream(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "matches no streams") ||
		strings.Contains(msg, "cannot find a matching stream")
}

// ExportPlanTimeline renders the manual cut to edit/final.mp4 — the render it
// replaces is archived into the version history first. The timeline state is
// persisted as part of the export. Progress arrives as "timeline:progress"
// events; one export runs at a time.
func (a *App) ExportPlanTimeline(planID string, t PlanTimeline) (EditWorkspaceInfo, error) {
	if _, err := a.findVideoPlan(planID); err != nil {
		return EditWorkspaceInfo{}, err
	}
	if err := validTimelineSegments(t.Segments); err != nil {
		return EditWorkspaceInfo{}, err
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return EditWorkspaceInfo{}, fmt.Errorf("ffmpeg was not found on PATH — it renders the cut")
	}
	src, err := a.timelineBasePath(planID, t.File)
	if err != nil {
		return EditWorkspaceInfo{}, err
	}

	// The cut the producer started from, read before anything overwrites it —
	// the manual pass is only legible as the difference between the two.
	before := a.readCutsManifest(planID).Segments

	a.mu.Lock()
	if a.editCmd != nil && a.editPlanID == planID {
		a.mu.Unlock()
		return EditWorkspaceInfo{}, fmt.Errorf("an edit session is running on this plan — stop it before exporting")
	}
	if a.exportingPlan != "" {
		a.mu.Unlock()
		return EditWorkspaceInfo{}, fmt.Errorf("another timeline export is already rendering — wait for it to finish")
	}
	a.exportingPlan = planID
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.exportingPlan = ""
		a.mu.Unlock()
	}()

	if err := a.SavePlanTimeline(planID, t); err != nil {
		log.Printf("jax: save timeline on export: %v", err)
	}

	// Render to a scratch name first; the final rename is atomic enough that
	// a failed export never destroys the current final.mp4.
	dst := filepath.Join(a.editWorkspaceDir(planID), "edit", "final.mp4")
	tmp := filepath.Join(a.editWorkspaceDir(planID), "edit", ".timeline-export.mp4")
	defer os.Remove(tmp)

	a.emitTimelineProgress(planID, "Rendering the cut — 0%")
	if needsSourcePadding(t.Segments) {
		// Segments were expanded into their source footage: several inputs,
		// normalized and joined (see runPaddedExport).
		if err := a.runPaddedExport(planID, ffmpeg, src, tmp, t.Segments); err != nil {
			a.emitTimelineProgress(planID, "")
			return EditWorkspaceInfo{}, err
		}
	} else if err := a.runTimelineExport(planID, ffmpeg, src, tmp, t.Segments, true); err != nil {
		if !hasNoAudioStream(err) {
			a.emitTimelineProgress(planID, "")
			return EditWorkspaceInfo{}, err
		}
		// The base video has no audio track — cut video-only.
		if err := a.runTimelineExport(planID, ffmpeg, src, tmp, t.Segments, false); err != nil {
			a.emitTimelineProgress(planID, "")
			return EditWorkspaceInfo{}, err
		}
	}

	// Snapshot the revision being replaced (the cut and its manifest, as they
	// still are on disk), then move the new cut into place.
	a.archiveEditRevision(planID)
	_ = os.Remove(dst)
	if err := os.Rename(tmp, dst); err != nil {
		a.emitTimelineProgress(planID, "")
		return EditWorkspaceInfo{}, fmt.Errorf("the rendered cut could not be moved into place: %v", err)
	}

	// The cut is now the video: re-map the segments onto the new render and
	// record them, so the timeline reopens pre-split at these cuts and the next
	// edit session sees the video as it now is. A base that was itself a source
	// video makes its segments traceable (and expandable) from here on.
	baseSource := ""
	if !isEditOutput(t.File) {
		baseSource = filepath.Base(t.File)
	}
	cut := PlanTimeline{File: "final.mp4", Segments: reprocessedCuts(t.Segments, baseSource)}
	a.writeCutsManifest(planID, cut)
	// The manifest now describes the video exactly, so the producer has no
	// pending cut any more — drop it and let the timeline reopen from the
	// manifest, the same way it does after an edit session.
	a.resetPlanTimeline(planID)

	// The producer said nothing while cutting by hand, so their correction has
	// to be read out of the cut (see edits.go). Then the whole record is
	// re-summarized: "Reprocess and save" is the moment the video is what they
	// wanted, which is the moment the difference is worth stating.
	if note := describeTimelineEdit(before, t.Segments); note != "" {
		a.recordEditRequest(planID, "timeline", note)
	}
	go func() {
		if _, err := a.SummarizePlanChanges(planID); err != nil {
			log.Printf("jax: summarize changes for %s: %v", planID, err)
		}
	}()

	a.emitTimelineProgress(planID, "")
	return a.GetEditWorkspace(planID)
}

// isEditOutput reports whether a timeline's base video is a render (resolved in
// edit/) rather than a source video in the workspace root.
func isEditOutput(file string) bool {
	for _, name := range editOutputNames {
		if strings.EqualFold(filepath.Base(file), name) {
			return true
		}
	}
	return false
}

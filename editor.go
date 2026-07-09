package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// In-app video editor
//
// A video plan's Editor tab produces the actual video from its source
// streams' downloaded footage. The editing engine is browser-use/video-use
// (MIT), vendored as a library under ~/.jax/tools and driven headlessly by
// Claude Code — the same `claude -p` integration the app's other AI features
// use — inside a per-plan workspace. HyperFrames (heygen-com/hyperframes,
// Apache-2.0) is the skill's animation/overlay engine, fetched by it via npx
// when needed (Node 22+).
//
// The workspace feeds the skill everything the app already knows:
//
//   - Source videos: hardlinked (or copied) from the plan's downloaded
//     streams, named by episode.
//   - Transcripts: video-use caches word-level transcripts as
//     edit/transcripts/<stem>.json and never re-transcribes when the file
//     exists. The app's stored transcripts (local faster-whisper, see
//     transcribe_video.go) are converted into that format up front, so the
//     skill's ElevenLabs dependency is never exercised.
//   - project.md: seeded from the plan (title, format, description, tags,
//     episodes) — the skill treats it as session memory.
//
// Workspaces live under <downloadDir>/edits/<planID> so outputs stream
// through the existing /media server. Runs are reported via "editor:line"
// (planID, stream-json line) and "editor:exit" (planID, detail; empty =
// success); one edit runs at a time.
// ---------------------------------------------------------------------------

const videoUseRepo = "https://github.com/browser-use/video-use"

// editorToolsDir is where the editing libraries are vendored (~/.jax/tools).
func editorToolsDir() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	tools := filepath.Join(dir, "tools")
	if err := os.MkdirAll(tools, 0o700); err != nil {
		return "", err
	}
	return tools, nil
}

// videoUseDir is the vendored video-use checkout.
func videoUseDir() (string, error) {
	tools, err := editorToolsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(tools, "video-use"), nil
}

// keyEditWorkspaceDir is the Settings → Videos workspace-folder override
// ('' = the default). Shared with the frontend's SETTING_KEYS.
const keyEditWorkspaceDir = "edit_workspace_dir"

// DefaultEditWorkspaceDir is where edit workspaces land when no directory is
// configured: a "jax edits" folder inside the user's Videos directory —
// sibling of the default download folder, so moving one never drags the
// other along.
func (a *App) DefaultEditWorkspaceDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "jax edits"
	}
	return filepath.Join(home, "Videos", "jax edits")
}

// resolveEditRoot returns the configured workspace root, falling back to the
// default when none is set.
func (a *App) resolveEditRoot() string {
	if a.store != nil {
		if dir, err := a.store.getSetting(keyEditWorkspaceDir); err == nil {
			if trimmed := strings.TrimSpace(dir); trimmed != "" {
				return trimmed
			}
		}
	}
	return a.DefaultEditWorkspaceDir()
}

// EditorTools reports what the editor feature has to work with.
type EditorTools struct {
	Git    bool `json:"git"`
	FFmpeg bool `json:"ffmpeg"`
	Python bool `json:"python"`
	Claude bool `json:"claude"`
	// Node is the `node --version` output ("" when Node is missing). Only
	// needed for HyperFrames/Remotion animations, not for plain cuts.
	Node string `json:"node"`
	// VideoUse reports whether the video-use library is vendored yet.
	VideoUse    bool   `json:"videoUse"`
	VideoUseDir string `json:"videoUseDir"`
	// Ready means an edit run can start: ffmpeg + python + claude + video-use.
	Ready bool `json:"ready"`
}

// GetEditorTools probes the editor's dependencies.
func (a *App) GetEditorTools() EditorTools {
	t := EditorTools{}
	if _, err := exec.LookPath("git"); err == nil {
		t.Git = true
	}
	if _, err := exec.LookPath("ffmpeg"); err == nil {
		t.FFmpeg = true
	}
	if _, _, err := findPython(); err == nil {
		t.Python = true
	}
	if _, err := findClaudeCode(); err == nil {
		t.Claude = true
	}
	if node, err := exec.LookPath("node"); err == nil {
		cmd := exec.Command(node, "--version")
		hideWindow(cmd)
		if out, err := cmd.Output(); err == nil {
			t.Node = strings.TrimSpace(string(out))
		}
	}
	if dir, err := videoUseDir(); err == nil {
		t.VideoUseDir = dir
		t.VideoUse = fileExists(filepath.Join(dir, "SKILL.md"))
	}
	t.Ready = t.FFmpeg && t.Python && t.Claude && t.VideoUse
	return t
}

// emitEditorSetup forwards one setup progress line to the frontend.
func (a *App) emitEditorSetup(line string) {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "editor:setup", line)
	}
}

// InstallEditorTools vendors (or updates) the video-use library and installs
// its Python dependencies. Progress is reported via "editor:setup" events;
// the call returns when everything finished.
func (a *App) InstallEditorTools() (EditorTools, error) {
	git, err := exec.LookPath("git")
	if err != nil {
		return a.GetEditorTools(), fmt.Errorf("git was not found on PATH — it is needed to fetch the video-use library")
	}
	dir, err := videoUseDir()
	if err != nil {
		return a.GetEditorTools(), err
	}

	runStep := func(name string, cmd *exec.Cmd) error {
		a.emitEditorSetup(name + "…")
		hideWindow(cmd)
		out, err := cmd.CombinedOutput()
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if strings.TrimSpace(line) != "" {
				a.emitEditorSetup(strings.TrimSpace(line))
			}
		}
		if err != nil {
			return fmt.Errorf("%s failed: %v", name, err)
		}
		return nil
	}

	if fileExists(filepath.Join(dir, "SKILL.md")) {
		if err := runStep("Updating video-use", exec.Command(git, "-C", dir, "pull", "--ff-only")); err != nil {
			// A dirty or diverged checkout should not block editing with the
			// vendored version already on disk.
			a.emitEditorSetup(err.Error() + " — keeping the existing checkout")
		}
	} else {
		_ = os.RemoveAll(dir) // a partial clone would make git refuse
		if err := runStep("Fetching video-use", exec.Command(git, "clone", "--depth", "1", videoUseRepo, dir)); err != nil {
			return a.GetEditorTools(), err
		}
	}

	python, pyArgs, err := findPython()
	if err != nil {
		return a.GetEditorTools(), err
	}
	pipArgs := append(append([]string{}, pyArgs...), "-m", "pip", "install", "--user", "-e", dir)
	if err := runStep("Installing video-use dependencies", exec.Command(python, pipArgs...)); err != nil {
		return a.GetEditorTools(), err
	}

	a.emitEditorSetup("Editor tools are ready.")
	return a.GetEditorTools(), nil
}

// ---------------------------------------------------------------------------
// Workspace assembly
// ---------------------------------------------------------------------------

// EditSource is one of the plan's source streams as the workspace sees it.
type EditSource struct {
	StartedAt     string `json:"startedAt"`
	Title         string `json:"title"`
	EpisodeNumber int    `json:"episodeNumber"`
	// File is the video's filename inside the workspace ("" when the stream
	// has no downloaded copy yet).
	File          string `json:"file"`
	Downloaded    bool   `json:"downloaded"`
	HasTranscript bool   `json:"hasTranscript"`
	// Subfolder is the download's folder name ("" when not downloaded) — the
	// key the transcription queue reports progress under.
	Subfolder string `json:"subfolder"`
}

// EditOutput is one rendered artifact inside the workspace's edit/ folder.
type EditOutput struct {
	Name       string `json:"name"`
	MediaURL   string `json:"mediaUrl"`
	ModifiedAt string `json:"modifiedAt"` // RFC3339
	SizeBytes  int64  `json:"sizeBytes"`
}

// EditWorkspaceInfo is the Editor tab's view of a plan's workspace.
type EditWorkspaceInfo struct {
	PlanID   string       `json:"planId"`
	Dir      string       `json:"dir"`
	Prepared bool         `json:"prepared"`
	Sources  []EditSource `json:"sources"`
	Outputs  []EditOutput `json:"outputs"`
	Running  bool         `json:"running"`
}

// editWorkspaceDir is a plan's workspace folder inside the configured
// workspace root (Settings → Videos); outputs are served under /edits/ by
// the media server.
func (a *App) editWorkspaceDir(planID string) string {
	return filepath.Join(a.resolveEditRoot(), sanitizeFileName(planID))
}

// findVideoPlan resolves a plan by id.
func (a *App) findVideoPlan(planID string) (VideoPlan, error) {
	for _, p := range a.GetVideoPlans() {
		if p.ID == planID {
			return p, nil
		}
	}
	return VideoPlan{}, fmt.Errorf("that video plan no longer exists")
}

// resolveEditSources matches each of the plan's source streams to its past
// stream and downloaded copy — the same broadcast-URL lookup the frontend
// uses.
func (a *App) resolveEditSources(plan VideoPlan) []struct {
	ref      VideoPlanStream
	stream   *PastStream
	download *DownloadedVideo
} {
	pastStreams := a.GetPastStreams(false)
	downloads := a.GetDownloads()
	byURL := map[string]*DownloadedVideo{}
	for i := range downloads {
		for _, u := range downloads[i].URLs {
			if u != "" {
				byURL[u] = &downloads[i]
			}
		}
	}

	out := make([]struct {
		ref      VideoPlanStream
		stream   *PastStream
		download *DownloadedVideo
	}, 0, len(plan.Streams))
	for _, ref := range plan.Streams {
		entry := struct {
			ref      VideoPlanStream
			stream   *PastStream
			download *DownloadedVideo
		}{ref: ref}
		for i := range pastStreams {
			if pastStreams[i].StartedAt == ref.StartedAt {
				entry.stream = &pastStreams[i]
				break
			}
		}
		if entry.stream != nil {
			for _, b := range entry.stream.Broadcasts {
				if d, ok := byURL[b.URL]; ok {
					entry.download = d
					break
				}
			}
		}
		out = append(out, entry)
	}
	return out
}

// editSourceFileName names a source video inside the workspace: episode
// number when known, then the stream title.
func editSourceFileName(stream *PastStream, ref VideoPlanStream, ext string) string {
	title := ref.Title
	episode := 0
	if stream != nil {
		if stream.Title != "" {
			title = stream.Title
		}
		episode = stream.EpisodeNumber
	}
	if title == "" {
		title = "Stream " + downloadStamp(ref.StartedAt)
	}
	name := title
	if episode > 0 {
		name = fmt.Sprintf("EP%02d - %s", episode, title)
	}
	return sanitizeFileName(name) + ext
}

// sanitizeFileName makes a string safe as a Windows/Unix filename.
func sanitizeFileName(name string) string {
	repl := strings.NewReplacer(
		"<", "-", ">", "-", ":", "-", "\"", "-", "/", "-",
		"\\", "-", "|", "-", "?", "-", "*", "-",
	)
	name = strings.Trim(strings.TrimSpace(repl.Replace(name)), ". ")
	if len(name) > 120 {
		name = name[:120]
	}
	if name == "" {
		name = "video"
	}
	return name
}

// linkOrCopy hardlinks src to dst (same volume: instant, no extra disk),
// falling back to a copy. Existing destinations are kept.
func linkOrCopy(src, dst string) error {
	if fileExists(dst) {
		return nil
	}
	if err := os.Link(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(dst)
		return err
	}
	return out.Close()
}

// linkDir makes link point at target (junction on Windows, symlink
// elsewhere). NOTE: never delete a workspace with a recursive remove that
// follows links — the junction leads into the vendored tools.
func linkDir(link, target string) error {
	if _, err := os.Lstat(link); err == nil {
		return nil
	}
	if err := os.Symlink(target, link); err == nil {
		return nil
	}
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd", "/c", "mklink", "/J", link, target)
		hideWindow(cmd)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("could not link the video-use skill: %s",
				firstNonEmpty(strings.TrimSpace(string(out)), err.Error()))
		}
		return nil
	}
	return fmt.Errorf("could not link the video-use skill into the workspace")
}

// editSourceNotes renders the app's knowledge of the plan's source streams —
// each episode's overview (its episode description) and its stored AI
// outline with stream-relative timestamps — as a markdown document. Written
// into the workspace for the editing agent and fed to the directions
// generator, so both work from what actually happened in the footage.
func (a *App) editSourceNotes(plan VideoPlan) string {
	var b strings.Builder
	b.WriteString("# Source stream notes\n\n")
	b.WriteString("App-maintained context for this plan's source streams: what each one was about and its timestamped outline (timestamps are stream-relative, matching the source video and its transcript).\n")
	for _, s := range a.resolveEditSources(plan) {
		title := firstNonEmpty(s.ref.Title, "Untitled stream")
		episode := 0
		if s.stream != nil {
			title = firstNonEmpty(s.stream.Title, title)
			episode = s.stream.EpisodeNumber
		}
		if episode > 0 {
			fmt.Fprintf(&b, "\n## EP%02d — %s (streamed %s)\n", episode, title, downloadStamp(s.ref.StartedAt))
		} else {
			fmt.Fprintf(&b, "\n## %s (streamed %s)\n", title, downloadStamp(s.ref.StartedAt))
		}
		// The key the app's MCP tools (get_stream_transcript,
		// get_stream_outline) take to dig into this stream.
		fmt.Fprintf(&b, "startedAt: %s\n", s.ref.StartedAt)
		if s.stream != nil && strings.TrimSpace(s.stream.EpisodeDescription) != "" {
			fmt.Fprintf(&b, "Overview: %s\n", strings.TrimSpace(s.stream.EpisodeDescription))
		}
		// The stored AI outline (summary + timestamped items; see outline.go).
		if outline := a.storedOutlineText(s.ref.StartedAt); outline != "" {
			b.WriteString(outline)
		}
		switch {
		case s.download == nil:
			b.WriteString("Footage: NOT downloaded yet.\n")
		case len(a.GetTranscriptForStream(s.ref.StartedAt)) == 0:
			b.WriteString("Footage: downloaded; no transcript yet.\n")
		default:
			b.WriteString("Footage: downloaded, transcript available.\n")
		}
	}
	return b.String()
}

// scribeTranscript converts the app's utterance-level transcript into the
// word-level Scribe JSON video-use caches (edit/transcripts/<stem>.json).
// Word timings are interpolated inside each utterance, weighted by word
// length — approximate, which is why the seeded notes tell the editor to pad
// cuts generously.
func scribeTranscript(lines []TranscriptLineRec, baseMs int64) ([]byte, bool) {
	type scribeWord struct {
		Text      string  `json:"text"`
		Type      string  `json:"type"`
		Start     float64 `json:"start"`
		End       float64 `json:"end"`
		SpeakerID string  `json:"speaker_id"`
	}
	sorted := append([]TranscriptLineRec(nil), lines...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At < sorted[j].At })

	var words []scribeWord
	var full strings.Builder
	for _, rec := range sorted {
		start := float64(rec.At-baseMs) / 1000
		end := float64(rec.EndAt-baseMs) / 1000
		toks := strings.Fields(rec.Text)
		if len(toks) == 0 || end <= 0 {
			continue
		}
		if start < 0 {
			start = 0
		}
		if end <= start {
			end = start + 0.3*float64(len(toks))
		}
		total := 0
		for _, t := range toks {
			total += len([]rune(t))
		}
		cursor := start
		used := 0
		for i, t := range toks {
			used += len([]rune(t))
			wEnd := start + (end-start)*float64(used)/float64(total)
			if i == len(toks)-1 {
				wEnd = end
			}
			words = append(words, scribeWord{
				Text:      t,
				Type:      "word",
				Start:     cursor,
				End:       wEnd,
				SpeakerID: "speaker_0",
			})
			if full.Len() > 0 {
				full.WriteString(" ")
			}
			full.WriteString(t)
			cursor = wEnd
		}
	}
	if len(words) == 0 {
		return nil, false
	}
	raw, err := json.MarshalIndent(map[string]any{
		"text":  full.String(),
		"words": words,
	}, "", " ")
	if err != nil {
		return nil, false
	}
	return raw, true
}

// PrepareEditWorkspace assembles (or refreshes) a plan's edit workspace:
// source videos linked in, transcripts pre-cached in video-use's format, the
// video-use skill linked, and project.md seeded from the plan. Idempotent —
// existing files are kept, so re-preparing after a new download or transcript
// only fills the gaps.
func (a *App) PrepareEditWorkspace(planID string) (EditWorkspaceInfo, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return EditWorkspaceInfo{}, err
	}
	a.mu.Lock()
	moving := a.movingEdits
	a.mu.Unlock()
	if moving {
		return EditWorkspaceInfo{}, fmt.Errorf("the workspace folder is being moved — try again once it finishes")
	}
	tools := a.GetEditorTools()
	if !tools.VideoUse {
		return EditWorkspaceInfo{}, fmt.Errorf("the editor tools are not installed yet — install them first")
	}

	dir := a.editWorkspaceDir(planID)
	transcriptsDir := filepath.Join(dir, "edit", "transcripts")
	if err := os.MkdirAll(transcriptsDir, 0o755); err != nil {
		return EditWorkspaceInfo{}, fmt.Errorf("could not create the workspace: %w", err)
	}

	// The skill resolves from the workspace's own .claude/skills, keeping the
	// vendored library out of the user's global skill set.
	skillsDir := filepath.Join(dir, ".claude", "skills")
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		return EditWorkspaceInfo{}, err
	}
	if err := linkDir(filepath.Join(skillsDir, "video-use"), tools.VideoUseDir); err != nil {
		return EditWorkspaceInfo{}, err
	}

	downloadDir := a.resolveDownloadDir()
	var seedSources []string
	for _, s := range a.resolveEditSources(plan) {
		if s.download == nil {
			continue
		}
		src := filepath.Join(downloadDir, s.download.Subfolder, s.download.VideoFile)
		if !fileExists(src) {
			continue
		}
		name := editSourceFileName(s.stream, s.ref, filepath.Ext(s.download.VideoFile))
		if err := linkOrCopy(src, filepath.Join(dir, name)); err != nil {
			return EditWorkspaceInfo{}, fmt.Errorf("could not add %q to the workspace: %w", name, err)
		}

		// Pre-cache the transcript in Scribe form so video-use never
		// re-transcribes (its cache rule) — the app's local faster-whisper
		// work stands in for ElevenLabs.
		stem := strings.TrimSuffix(name, filepath.Ext(name))
		transcriptPath := filepath.Join(transcriptsDir, stem+".json")
		hasTranscript := fileExists(transcriptPath)
		if !hasTranscript {
			if base, err := time.Parse(time.RFC3339, s.download.StartedAt); err == nil {
				if raw, ok := scribeTranscript(a.GetTranscriptForStream(s.ref.StartedAt), base.UnixMilli()); ok {
					if err := os.WriteFile(transcriptPath, raw, 0o644); err == nil {
						hasTranscript = true
					}
				}
			}
		}

		note := name + " — streamed " + downloadStamp(s.ref.StartedAt)
		if hasTranscript {
			note += ", transcript pre-cached"
		} else {
			note += ", NO transcript yet"
		}
		seedSources = append(seedSources, note)
	}

	// The app's per-source context (overviews and timestamped outlines) is
	// regenerated on every prepare — it mirrors app state, unlike project.md
	// which belongs to the editing agent.
	if err := os.WriteFile(
		filepath.Join(dir, "edit", "source-notes.md"),
		[]byte(a.editSourceNotes(plan)), 0o644,
	); err != nil {
		return EditWorkspaceInfo{}, err
	}

	// Seed project.md (video-use's session memory) once; later sessions
	// append to it and must not be clobbered.
	projectPath := filepath.Join(dir, "project.md")
	if !fileExists(projectPath) {
		var b strings.Builder
		fmt.Fprintf(&b, "# %s\n\n", plan.Title)
		fmt.Fprintf(&b, "A planned %s-form video produced from past broadcast footage.\n\n", plan.Format)
		if strings.TrimSpace(plan.Description) != "" {
			fmt.Fprintf(&b, "## Plan description\n\n%s\n\n", strings.TrimSpace(plan.Description))
		}
		if len(plan.Tags) > 0 {
			fmt.Fprintf(&b, "Tags: %s\n\n", strings.Join(plan.Tags, ", "))
		}
		if len(seedSources) > 0 {
			b.WriteString("## Source material\n\n")
			for _, s := range seedSources {
				fmt.Fprintf(&b, "- %s\n", s)
			}
			b.WriteString("\n")
		}
		b.WriteString(`## Editing constraints

- Transcripts in edit/transcripts/ are pre-cached from the app's local
  transcription; treat them as authoritative and never re-transcribe (no
  ElevenLabs available).
- Word timings inside utterances are interpolated, not measured — pad every
  cut by at least 150ms and prefer cutting in silence.
`)
		if err := os.WriteFile(projectPath, []byte(b.String()), 0o644); err != nil {
			return EditWorkspaceInfo{}, err
		}
	}

	return a.GetEditWorkspace(planID)
}

// GetEditWorkspace reports a plan's workspace state without mutating it.
func (a *App) GetEditWorkspace(planID string) (EditWorkspaceInfo, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return EditWorkspaceInfo{}, err
	}
	dir := a.editWorkspaceDir(planID)
	info := EditWorkspaceInfo{PlanID: planID, Dir: dir}
	if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
		info.Prepared = true
	}

	for _, s := range a.resolveEditSources(plan) {
		src := EditSource{
			StartedAt: s.ref.StartedAt,
			Title:     s.ref.Title,
		}
		if s.stream != nil {
			if s.stream.Title != "" {
				src.Title = s.stream.Title
			}
			src.EpisodeNumber = s.stream.EpisodeNumber
		}
		if s.download != nil {
			src.Downloaded = true
			src.Subfolder = s.download.Subfolder
			name := editSourceFileName(s.stream, s.ref, filepath.Ext(s.download.VideoFile))
			if fileExists(filepath.Join(dir, name)) {
				src.File = name
			}
			stem := strings.TrimSuffix(name, filepath.Ext(name))
			src.HasTranscript = fileExists(filepath.Join(dir, "edit", "transcripts", stem+".json")) ||
				len(a.GetTranscriptForStream(s.ref.StartedAt)) > 0
		}
		info.Sources = append(info.Sources, src)
	}

	// Rendered artifacts, newest first.
	a.mu.Lock()
	base := a.mediaBaseURL
	info.Running = a.editCmd != nil && a.editPlanID == planID
	a.mu.Unlock()
	for _, name := range []string{"final.mp4", "preview.mp4"} {
		p := filepath.Join(dir, "edit", name)
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			info.Outputs = append(info.Outputs, EditOutput{
				Name: name,
				MediaURL: base + editsPrefix + url.PathEscape(sanitizeFileName(planID)) +
					"/edit/" + url.PathEscape(name),
				ModifiedAt: fi.ModTime().UTC().Format(time.RFC3339),
				SizeBytes:  fi.Size(),
			})
		}
	}
	if info.Sources == nil {
		info.Sources = []EditSource{}
	}
	if info.Outputs == nil {
		info.Outputs = []EditOutput{}
	}
	return info, nil
}

// ---------------------------------------------------------------------------
// Edit-session directions
// ---------------------------------------------------------------------------

// editDirectionsSkillID is the Application Skill whose content is the system
// prompt for direction drafting (user-tunable in Settings → Skills).
const editDirectionsSkillID = "video-edit-directions"

// directionsTools are the app MCP tools the directions builder may call —
// enough to review the source streams' transcripts and outlines, nothing
// that mutates state.
const directionsTools = "mcp__jax__get_stream_transcript,mcp__jax__get_stream_outline,mcp__jax__list_past_streams,mcp__jax__list_brand_links"

// directionsMCPArgs builds the Claude Code arguments that attach the app's
// own MCP server to a directions run, so the model can pull stream
// transcripts and outlines on demand. Returns nil (no tool access, static
// context only) when the MCP server isn't up.
func (a *App) directionsMCPArgs() []string {
	return a.claudeMCPArgs(directionsTools)
}

// GenerateEditDirections drafts (or revises) the edit session's directions on
// the connected Anthropic service: the plan, the per-source overviews and
// timestamped outlines, the current draft when iterating, and the producer's
// notes all feed the prompt. Returns the directions as plain markdown.
func (a *App) GenerateEditDirections(planID, notes, current string) (string, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return "", err
	}
	skill, err := a.getAppSkill(editDirectionsSkillID)
	if err != nil {
		return "", err
	}
	system := skill.Content +
		"\n\nRespond with ONLY the session directions in plain markdown — no commentary, no code fences."
	// Account mode gets the app's MCP tools; teach the prompt to use them.
	mcpArgs := a.directionsMCPArgs()
	if len(mcpArgs) > 0 {
		system += "\n\nYou have the app's tools available: get_stream_outline and get_stream_transcript (keyed by each source's startedAt, listed in the input) let you review what actually happened before writing directions. Check the outline of every source, and pull the transcript around the moments you reference so timestamps and quotes are real."
	}

	var b strings.Builder
	b.WriteString("# Video plan\n")
	fmt.Fprintf(&b, "Title: %s\n", plan.Title)
	fmt.Fprintf(&b, "Format: %s form\n", plan.Format)
	if len(plan.Tags) > 0 {
		fmt.Fprintf(&b, "Tags: %s\n", strings.Join(plan.Tags, ", "))
	}
	if strings.TrimSpace(plan.Description) != "" {
		fmt.Fprintf(&b, "Description:\n%s\n", strings.TrimSpace(plan.Description))
	}
	b.WriteString("\n")
	b.WriteString(a.editSourceNotes(plan))
	// The brand's outward links (Profile → Links) always ride along, so
	// outro/CTA beats point at the real socials/site.
	if links := a.brandLinksText(); links != "" {
		b.WriteString("\n")
		b.WriteString(links)
	}
	if strings.TrimSpace(current) != "" {
		fmt.Fprintf(&b, "\n# Current draft directions\n%s\n", strings.TrimSpace(current))
	}
	if strings.TrimSpace(notes) != "" {
		fmt.Fprintf(&b, "\n# Producer notes for this iteration\n%s\n", strings.TrimSpace(notes))
	}

	// A Claude account runs through Claude Code with the app's MCP server
	// attached (tool-assisted review of transcripts/outlines); every other
	// connection (Anthropic API key, OpenAI) answers from the static context
	// alone via askAI.
	service, conn, err := a.aiConn()
	if err != nil {
		return "", err
	}
	if service == anthropicService && conn.login != anthropicModeAPIKey && len(mcpArgs) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		text, err := askClaudeCode(ctx, system, b.String(), mcpArgs...)
		if err != nil {
			return "", err
		}
		if text = strings.TrimSpace(text); text == "" {
			return "", fmt.Errorf("the model returned no text — try again")
		}
		return text, nil
	}
	return a.askAIText(system, b.String())
}

// ---------------------------------------------------------------------------
// Edit runs
// ---------------------------------------------------------------------------

// editPrompt is the headless instruction handed to Claude Code for a run.
func editPrompt(plan VideoPlan, instruction string) string {
	var b strings.Builder
	b.WriteString("Use the video-use skill (in .claude/skills/video-use) to edit the videos in this directory.\n\n")
	fmt.Fprintf(&b, "The deliverable: %q, a %s-form video.\n", plan.Title, plan.Format)
	if strings.TrimSpace(plan.Description) != "" {
		fmt.Fprintf(&b, "Plan description:\n%s\n", strings.TrimSpace(plan.Description))
	}
	if len(plan.Tags) > 0 {
		fmt.Fprintf(&b, "Tags: %s\n", strings.Join(plan.Tags, ", "))
	}
	b.WriteString(`
Ground rules:
- Word-level transcripts for every source are pre-cached in edit/transcripts/.
  Never re-transcribe and never call ElevenLabs — treat the cached transcripts
  as authoritative. Their word timings are interpolated, so pad cuts by at
  least 150ms and prefer cutting in silence.
- Read project.md first; it carries the plan and prior session notes.
- Read edit/source-notes.md next: the app's per-source overviews and
  timestamped outlines of what happened in each stream — use them with the
  transcripts to locate the moments worth keeping.
- Run non-interactively: never ask questions, pick sensible defaults, and note
  every decision in project.md.
- Produce edit/final.mp4 (and edit/preview.mp4 for drafts).
`)
	if strings.TrimSpace(instruction) != "" {
		fmt.Fprintf(&b, "\nDirection for this session:\n%s\n", strings.TrimSpace(instruction))
	}
	return b.String()
}

// StartEditRun prepares the plan's workspace and starts a headless Claude
// Code editing session in it. Progress arrives as "editor:line" events (one
// stream-json line each), the end as "editor:exit"; only one edit runs at a
// time.
func (a *App) StartEditRun(planID, instruction string) error {
	a.mu.Lock()
	busy := a.editCmd != nil
	a.mu.Unlock()
	if busy {
		return fmt.Errorf("an edit session is already running")
	}

	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return err
	}
	info, err := a.PrepareEditWorkspace(planID)
	if err != nil {
		return err
	}
	ready := 0
	for _, s := range info.Sources {
		if s.File != "" {
			ready++
		}
	}
	if ready == 0 {
		return fmt.Errorf("none of the plan's source streams have a downloaded video — download them from their stream pages first")
	}

	// The editing session runs shell/ffmpeg commands, so it needs Claude
	// Code's permission gate lifted; the run is confined to the workspace.
	cmd, err := claudeHeadlessCmd(context.Background(), editPrompt(plan, instruction),
		"--output-format", "stream-json", "--verbose",
		"--dangerously-skip-permissions")
	if err != nil {
		return err
	}
	cmd.Dir = info.Dir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start the editing session: %w", err)
	}

	a.mu.Lock()
	a.editCmd = cmd
	a.editPlanID = planID
	a.mu.Unlock()

	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" && a.ctx != nil {
				wruntime.EventsEmit(a.ctx, "editor:line", planID, line)
			}
		}
	}()

	errTail := make(chan string, 1)
	go func() {
		raw, _ := io.ReadAll(stderr)
		tail := strings.TrimSpace(string(raw))
		if len(tail) > 600 {
			tail = tail[len(tail)-600:]
		}
		errTail <- tail
	}()

	go func() {
		waitErr := cmd.Wait()
		tail := <-errTail

		a.mu.Lock()
		current := a.editCmd == cmd
		if current {
			a.editCmd = nil
			a.editPlanID = ""
		}
		a.mu.Unlock()

		if current && a.ctx != nil {
			detail := ""
			if waitErr != nil {
				detail = firstNonEmpty(tail, waitErr.Error())
			}
			wruntime.EventsEmit(a.ctx, "editor:exit", planID, detail)
		}
	}()

	return nil
}

// CancelEditRun stops the in-progress editing session, if any.
func (a *App) CancelEditRun() {
	a.mu.Lock()
	cmd := a.editCmd
	a.editCmd = nil
	a.editPlanID = ""
	a.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

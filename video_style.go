package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Video styles
//
// A style is how our videos should be made, written from what the Inspiration
// library already learned. Naming a style picks the takeaways that bear on it
// (see SuggestVideoStyleTakeaways); building it hands those takeaways to the
// AI runner and stores the document it writes back.
//
// The build runs in the background and reports through "videostyle:status",
// so the status bar carries it and leaving the page never abandons a run —
// the style's own record holds its state, so coming back reads the same
// progress the page was showing.
// ---------------------------------------------------------------------------

// keyVideoStyles holds the stored styles.
const keyVideoStyles = "video_styles"

// Video style build states.
const (
	videoStyleBuilding = "building"
	videoStyleReady    = "ready"
	videoStyleError    = "error"
)

// videoStyleMaxSources is a safety stop on how many takeaways one build
// reads. Every takeaway the library holds goes into a style; this only keeps
// an enormous library from becoming a prompt that cannot be answered.
const videoStyleMaxSources = 200

// VideoStyleSource is one takeaway a style was built from, snapshotted so the
// style still says where its advice came from after the library moves on.
type VideoStyleSource struct {
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	Apply      string `json:"apply"`
	VideoID    string `json:"videoId"`
	VideoTitle string `json:"videoTitle"`
	VideoURL   string `json:"videoUrl"`
}

// VideoStyleDirective is one rule of our own: a takeaway turned into an
// instruction for our videos. Takeaways describe what someone else did;
// directives say what we do, and they are what the style is actually held to.
type VideoStyleDirective struct {
	Kind   string `json:"kind"` // pacing | sound | look | structure | packaging | other
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// VideoStyle is one written style: the takeaways it was built from, the
// directives derived from them, and the document the model wrote.
type VideoStyle struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Status is building | ready | error; StatusDetail carries the step (or
	// the failure) for the status bar.
	Status       string `json:"status"`
	StatusDetail string `json:"statusDetail"`
	// Sources are the takeaways the build read, in the order they were given.
	Sources []VideoStyleSource `json:"sources"`
	// Directives are our own rules, derived from those takeaways.
	Directives []VideoStyleDirective `json:"directives"`
	// Body is the style itself, markdown.
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// fillVideoStyle keeps a style's slices non-nil for the frontend.
func fillVideoStyle(s *VideoStyle) {
	if s.Sources == nil {
		s.Sources = []VideoStyleSource{}
	}
	if s.Directives == nil {
		s.Directives = []VideoStyleDirective{}
	}
}

// getVideoStyles reads the stored styles. Never nil.
func (a *App) getVideoStyles() []VideoStyle {
	out := []VideoStyle{}
	if a.store == nil {
		return out
	}
	if _, err := a.store.getJSON(keyVideoStyles, &out); err != nil {
		log.Printf("jax: getVideoStyles: %v", err)
	}
	if out == nil {
		return []VideoStyle{}
	}
	return out
}

// GetVideoStyles returns the saved styles, newest first. Never nil.
func (a *App) GetVideoStyles() []VideoStyle {
	styles := a.getVideoStyles()
	for i := range styles {
		fillVideoStyle(&styles[i])
	}
	sort.SliceStable(styles, func(i, j int) bool {
		return styles[i].CreatedAt > styles[j].CreatedAt
	})
	return styles
}

// GetVideoStyle returns one style by id.
func (a *App) GetVideoStyle(id string) (VideoStyle, error) {
	for _, s := range a.getVideoStyles() {
		if s.ID == id {
			fillVideoStyle(&s)
			return s, nil
		}
	}
	return VideoStyle{}, fmt.Errorf("that style is no longer saved")
}

// VideoStylesInFlight returns the styles currently being built, so a page or
// the status bar can draw a run that started before it mounted. Never nil.
func (a *App) VideoStylesInFlight() []VideoStyle {
	out := []VideoStyle{}
	for _, s := range a.getVideoStyles() {
		if s.Status != videoStyleBuilding {
			continue
		}
		fillVideoStyle(&s)
		out = append(out, s)
	}
	return out
}

// saveVideoStyle upserts a style (matched by id) and returns it.
func (a *App) saveVideoStyle(s VideoStyle) (VideoStyle, error) {
	if a.store == nil {
		return VideoStyle{}, fmt.Errorf("storage unavailable")
	}
	fillVideoStyle(&s)
	s.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	styles := a.getVideoStyles()
	for i := range styles {
		if styles[i].ID != s.ID {
			continue
		}
		if s.CreatedAt == "" {
			s.CreatedAt = styles[i].CreatedAt
		}
		styles[i] = s
		if err := a.store.setJSON(keyVideoStyles, styles); err != nil {
			return VideoStyle{}, err
		}
		return s, nil
	}
	if s.ID == "" {
		s.ID = "style_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	if s.CreatedAt == "" {
		s.CreatedAt = s.UpdatedAt
	}
	styles = append(styles, s)
	if err := a.store.setJSON(keyVideoStyles, styles); err != nil {
		return VideoStyle{}, err
	}
	return s, nil
}

// SaveVideoStyle stores an edited style — its name and its body. The sources
// and the build state belong to the build, so they are kept as stored.
func (a *App) SaveVideoStyle(s VideoStyle) (VideoStyle, error) {
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		return VideoStyle{}, fmt.Errorf("name the style first")
	}
	stored, err := a.GetVideoStyle(s.ID)
	if err != nil {
		return VideoStyle{}, err
	}
	stored.Name = s.Name
	stored.Body = s.Body
	return a.saveVideoStyle(stored)
}

// DeleteVideoStyle removes a style.
func (a *App) DeleteVideoStyle(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	styles := a.getVideoStyles()
	out := make([]VideoStyle, 0, len(styles))
	for _, s := range styles {
		if s.ID != id {
			out = append(out, s)
		}
	}
	return a.store.setJSON(keyVideoStyles, out)
}

// SuggestVideoStyleTakeaways picks the takeaways a style of this name should
// be built from: the library's takeaways ranked by how well they speak to the
// name, best first. A name that matches nothing in particular still returns
// the library, so a style always has something to be written from.
func (a *App) SuggestVideoStyleTakeaways(name string) []VideoStyleSource {
	terms := inspirationTerms(name)
	type scored struct {
		src   VideoStyleSource
		score int
		order int
	}
	ranked := []scored{}
	for i, t := range a.GetInspirationTakeaways("") {
		src := VideoStyleSource{
			Kind: t.Kind, Title: t.Title, Detail: t.Detail, Apply: t.Apply,
			VideoID: t.VideoID, VideoTitle: t.VideoTitle, VideoURL: t.VideoURL,
		}
		hay := strings.ToLower(strings.Join(
			[]string{t.Kind, t.Title, t.Detail, t.Apply, t.VideoTitle}, " "))
		score := 0
		for _, term := range terms {
			score += strings.Count(hay, term)
		}
		ranked = append(ranked, scored{src: src, score: score, order: i})
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].order < ranked[j].order
	})
	out := []VideoStyleSource{}
	for _, r := range ranked {
		if len(out) >= videoStyleMaxSources {
			break
		}
		out = append(out, r.src)
	}
	return out
}

// CreateVideoStyle saves a new style and starts building it in the
// background, returning the record immediately: the build reports through
// "videostyle:status" and writes its progress to the style, so the status bar
// carries the run and the page reads it back whenever it is opened.
func (a *App) CreateVideoStyle(name string, sources []VideoStyleSource) (VideoStyle, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return VideoStyle{}, fmt.Errorf("name the style first")
	}
	if len(sources) == 0 {
		sources = a.SuggestVideoStyleTakeaways(name)
	}
	if len(sources) == 0 {
		return VideoStyle{}, fmt.Errorf(
			"there are no takeaways to build a style from yet — study an inspiration video first")
	}
	if len(sources) > videoStyleMaxSources {
		sources = sources[:videoStyleMaxSources]
	}
	style, err := a.saveVideoStyle(VideoStyle{
		Name:         name,
		Status:       videoStyleBuilding,
		StatusDetail: videoStyleReadingDetail(len(sources)),
		Sources:      sources,
	})
	if err != nil {
		return VideoStyle{}, err
	}
	a.emitVideoStyleStatus(style)
	go a.buildVideoStyle(style.ID)
	return style, nil
}

// RebuildVideoStyle runs the build again over the style's stored takeaways —
// after the library has learned more, or after a failed run.
func (a *App) RebuildVideoStyle(id string) (VideoStyle, error) {
	style, err := a.GetVideoStyle(id)
	if err != nil {
		return VideoStyle{}, err
	}
	if style.Status == videoStyleBuilding {
		return style, nil
	}
	// Take the library's current answer for the style's name, so a rebuild
	// picks up takeaways lifted since it was created.
	if fresh := a.SuggestVideoStyleTakeaways(style.Name); len(fresh) > 0 {
		style.Sources = fresh
	}
	style.Status = videoStyleBuilding
	style.StatusDetail = videoStyleReadingDetail(len(style.Sources))
	saved, err := a.saveVideoStyle(style)
	if err != nil {
		return VideoStyle{}, err
	}
	a.emitVideoStyleStatus(saved)
	go a.buildVideoStyle(saved.ID)
	return saved, nil
}

// videoStyleReadingDetail is the first step's status line.
func videoStyleReadingDetail(n int) string {
	if n == 1 {
		return "Reading 1 takeaway"
	}
	return fmt.Sprintf("Reading %d takeaways", n)
}

// buildVideoStyle writes the style from its takeaways. It runs on its own
// goroutine: the call that started it has already returned, and everything
// this reports rides on the style record plus the status event.
func (a *App) buildVideoStyle(id string) {
	style, err := a.GetVideoStyle(id)
	if err != nil {
		return
	}
	a.setVideoStyleStatus(id, videoStyleBuilding, "Writing the style")
	written, err := a.askAIText(videoStyleInstructions, videoStylePrompt(style))
	if err != nil {
		a.setVideoStyleStatus(id, videoStyleError, err.Error())
		return
	}
	body, directives := parseVideoStyleAnswer(written)
	current, err := a.GetVideoStyle(id)
	if err != nil {
		// Deleted while it was being written; nothing to store.
		return
	}
	current.Body = body
	current.Directives = directives
	current.Status = videoStyleReady
	current.StatusDetail = ""
	saved, err := a.saveVideoStyle(current)
	if err != nil {
		a.setVideoStyleStatus(id, videoStyleError, err.Error())
		return
	}
	a.emitVideoStyleStatus(saved)
}

// setVideoStyleStatus writes a build step to the style and reports it.
func (a *App) setVideoStyleStatus(id, status, detail string) {
	style, err := a.GetVideoStyle(id)
	if err != nil {
		return
	}
	style.Status = status
	style.StatusDetail = detail
	saved, err := a.saveVideoStyle(style)
	if err != nil {
		log.Printf("jax: video style status: %v", err)
		return
	}
	a.emitVideoStyleStatus(saved)
}

// emitVideoStyleStatus tells the open pages where a build has got to.
func (a *App) emitVideoStyleStatus(s VideoStyle) {
	if a.ctx == nil {
		return
	}
	wruntime.EventsEmit(a.ctx, "videostyle:status", s.ID, s.Name, s.Status, s.StatusDetail)
}

// EditVideoStyle revises a style to an instruction — "cut the rules about
// music", "make the directives shorter" — against the document and the
// directives as they currently stand. The takeaways it was built from ride
// along, so an edit can reach back to the advice the style came out of rather
// than only reshuffling the words already on the page. The revision is stored
// and the updated style returned.
func (a *App) EditVideoStyle(id, body, instruction string) (VideoStyle, error) {
	if strings.TrimSpace(instruction) == "" {
		return VideoStyle{}, fmt.Errorf("describe the edit you want")
	}
	style, err := a.GetVideoStyle(id)
	if err != nil {
		return VideoStyle{}, err
	}
	// The caller passes the field's current text, which may hold keystrokes
	// that were never saved; fall back to what is stored.
	if strings.TrimSpace(body) == "" {
		body = style.Body
	}
	if strings.TrimSpace(body) == "" {
		return VideoStyle{}, fmt.Errorf("there is no style to edit yet")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# Style\nName: %s\n\n## The style as it stands\n%s\n", style.Name, body)
	b.WriteString("\n## Its directives\n")
	for _, d := range style.Directives {
		fmt.Fprintf(&b, "- [%s] %s — %s\n", d.Kind, d.Title, d.Detail)
	}
	b.WriteString("\n## The takeaways it was built from\n")
	for _, src := range style.Sources {
		fmt.Fprintf(&b, "- %s", src.Title)
		if src.Detail != "" {
			fmt.Fprintf(&b, " — %s", src.Detail)
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "\n## Instruction\n%s\n", instruction)

	written, err := a.askAIText(videoStyleEditInstructions, b.String())
	if err != nil {
		return VideoStyle{}, err
	}
	revised, directives := parseVideoStyleAnswer(written)
	style.Body = revised
	if len(directives) > 0 {
		style.Directives = directives
	}
	return a.saveVideoStyle(style)
}

// parseVideoStyleAnswer reads the model's answer: the JSON object it is asked
// for, carrying the document and the directives derived from the takeaways.
// An answer that is plain markdown instead (a model that ignored the shape)
// is kept as the document, so a style is never lost to a parse.
func parseVideoStyleAnswer(text string) (string, []VideoStyleDirective) {
	var out struct {
		Body       string                `json:"body"`
		Directives []VideoStyleDirective `json:"directives"`
	}
	if err := json.Unmarshal([]byte(extractJSONObject(text)), &out); err != nil ||
		strings.TrimSpace(out.Body) == "" {
		return strings.TrimSpace(text), nil
	}
	kept := []VideoStyleDirective{}
	for _, d := range out.Directives {
		d.Title = strings.TrimSpace(d.Title)
		if d.Title == "" {
			continue
		}
		d.Kind = strings.TrimSpace(strings.ToLower(d.Kind))
		d.Detail = strings.TrimSpace(d.Detail)
		kept = append(kept, d)
	}
	return strings.TrimSpace(out.Body), kept
}

// videoStyleContext renders a style for another feature's prompt: the
// document it was written as, and the directives our videos are held to.
// Blank when the id names no style, so a caller can add it unconditionally.
func (a *App) videoStyleContext(styleID string) string {
	if strings.TrimSpace(styleID) == "" {
		return ""
	}
	style, err := a.GetVideoStyle(styleID)
	if err != nil {
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# Video style: %s\n", style.Name)
	b.WriteString("This video is made to the style below. Follow it — it is the producer's own standard, not a suggestion.\n")
	if strings.TrimSpace(style.Body) != "" {
		fmt.Fprintf(&b, "\n%s\n", strings.TrimSpace(style.Body))
	}
	if len(style.Directives) > 0 {
		b.WriteString("\n## Directives — every one of these applies to this video\n")
		for _, d := range style.Directives {
			fmt.Fprintf(&b, "- ")
			if d.Kind != "" {
				fmt.Fprintf(&b, "[%s] ", d.Kind)
			}
			fmt.Fprintf(&b, "%s", d.Title)
			if d.Detail != "" {
				fmt.Fprintf(&b, " — %s", d.Detail)
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

// videoStylePrompt lays the style's name and its takeaways out for the model.
func videoStylePrompt(s VideoStyle) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Style\nName: %s\n\n## Takeaways from the reference library\n", s.Name)
	for _, src := range s.Sources {
		fmt.Fprintf(&b, "\n### %s", src.Title)
		if src.Kind != "" {
			fmt.Fprintf(&b, " (%s)", src.Kind)
		}
		b.WriteString("\n")
		if src.Detail != "" {
			fmt.Fprintf(&b, "%s\n", src.Detail)
		}
		if src.Apply != "" {
			fmt.Fprintf(&b, "Apply: %s\n", src.Apply)
		}
		if src.VideoTitle != "" {
			fmt.Fprintf(&b, "Seen in: %s\n", src.VideoTitle)
		}
	}
	return b.String()
}

// videoStyleInstructions brief the model that turns takeaways into a style.
const videoStyleInstructions = `You are writing a video style guide for one creator, from the takeaways their reference library has lifted out of other people's videos.

The takeaways are observations about how other creators work. Your job is to turn them into rules this creator's own videos are held to — not a summary of what was observed, and never a list of who does what.

Respond with one JSON object and nothing else — no preamble, no code fences:

{
  "body": "<the style guide, markdown>",
  "directives": [{"kind": "<pacing|sound|look|structure|packaging|other>", "title": "<the rule in a few words>", "detail": "<one or two sentences saying exactly what to do>"}]
}

"body" follows this shape:

## What this style is
<Two or three sentences: what a video made to this style feels like to watch.>

## Rules
- <Six to twelve rules, each one specific enough to follow or break on a real edit. Say the number, the length, the placement, the setting — whatever the takeaways made concrete.>

## Structure
<How a video in this style is laid out, start to finish.>

## Avoid
- <Three to five things this style deliberately does not do.>

"directives" is the same advice as discrete rules — six to fifteen of them, each one a single instruction this creator's edit either follows or breaks. A directive is our own version of a takeaway: written as what WE do, never as what someone else did.

Write in the second person, plainly, with no marketing tone. Where the takeaways disagree, pick the position that suits a creator building a recognisable style and say so in one clause. Where they are vague, leave the rule out rather than inventing a number.`

// videoStyleEditInstructions brief the model that edits a written style.
const videoStyleEditInstructions = `You are editing a creator's video style guide to their instruction.

Return one JSON object and nothing else — no preamble, no code fences:

{
  "body": "<the complete style guide with the edit applied, markdown>",
  "directives": [{"kind": "<pacing|sound|look|structure|packaging|other>", "title": "<the rule in a few words>", "detail": "<one or two sentences saying exactly what to do>"}]
}

Keep everything the instruction did not ask you to change, including the headings and the order they are in, and return the directives in full — the edited ones and the untouched ones together, since what you return replaces the set.

The takeaways the style was built from are given for reference: when the instruction asks for something the style does not currently cover, take it from that advice rather than inventing it. Keep the rules specific — numbers, lengths, placements — and keep the second-person, plain voice.`

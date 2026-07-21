package main

import (
	"embed"
	"fmt"
	"log"
)

// ---------------------------------------------------------------------------
// Application Skills
//
// Instruction documents that teach how to use the app's features — both for
// people and for Claude clients connected over MCP (which read them through
// the list_skills/get_skill tools). Defaults ship embedded in the binary;
// editing one in Settings stores an override in the settings table, and
// resetting removes the override to fall back to the embedded default.
// ---------------------------------------------------------------------------

//go:embed skills/*.md
var skillFiles embed.FS

// appSkillDefs is the fixed skill catalog. Titles and descriptions are not
// user-editable; only the markdown content can be overridden.
var appSkillDefs = []struct {
	ID          string
	Title       string
	Description string
}{
	{"app-overview", "Jax at a glance", "What the app does, its main areas, and the ground rules for working over MCP."},
	{"plan-streams", "Planning streams", "Create and maintain stream plans: titles, run-of-show descriptions, tags, and series/episode assignment."},
	{"stream-thumbnails", "Stream thumbnails", "The creative brief behind generated plan thumbnails: composition, text, and style rules the image model follows."},
	{"stream-descriptions", "Stream descriptions", "The writing guide behind AI-drafted descriptions: one voice, two modes — planned streams announce what's coming, past streams are optimized for YouTube search."},
	{"brand-assets", "Brand assets", "What the uploaded brand files are, the naming/description conventions that make them usable, and how features apply them."},
	{"content-series", "Content series & episodes", "Define recurring shows, keep episode numbering consistent, and assign streams to series."},
	{"go-live", "Going live", "The broadcast-day flow: applying a plan, monitoring while live, and concluding the episode."},
	{"past-streams", "Reviewing past streams", "Work the stream archive: transcripts, chat logs, and AI outlines for recaps and clip hunting."},
	{"download-transcribe", "Downloads & transcription", "Pull VODs to disk and re-transcribe them locally for cleaner transcripts."},
	{"inspiration", "Inspiration library", "Study other creators' videos: what has been indexed, what was derived from each, and how to search the library and cite it."},
	{"videos", "Videos & video plans", "Browse the channels' catalogue, review performance, and prepare video plans for the editor."},
	{"video-edit-directions", "Video edit script", "Turn a video plan, its source-stream context, and the producer's notes into the outline/script the edit session executes — including the short- and long-form runtime targets."},
	{"video-script-ideas", "Video script ideas", "How the three candidate scripts pitched on a past stream's Clips tab are written — distinct angles, hooks, runtime targets — refined automatically by which pitch the producer picks."},
	{"video-edit-session", "Video edit sessions", "The ground rules the automated editing session works to: source material, the first cut, revision passes, the cuts manifest, and rendering discipline."},
	{"video-edit-timeline", "Video edit timeline", "The manual timeline pass over a rendered video: the segment model, expanding a segment into the footage on either side of it, and reprocessing the cut."},
	{"video-edits-short", "Short-form editing preferences", "Standing corrections for short-form videos — grown from the edits you request, so the next short needs fewer of them."},
	{"video-edits-long", "Long-form editing preferences", "Standing corrections for long-form videos — grown from the edits you request, so the next video needs fewer of them."},
	{"video-descriptions", "Published video descriptions", "The writing guide for produced videos published to YouTube — hook-first search copy with the original full-length broadcast link above the brand links."},
	{"video-publish-prep", "Preparing videos to publish", "How the Publish tab's title, description, tags, and category are drafted — all at once, one field at a time, or revised from the producer's feedback."},
	{"projects", "Projects & docs", "Use projects as the writing and reference space: doc trees, conventions, and what stays app-only."},
	{"project-images", "Project images", "The creative brief behind generated project cover images: logo-style, led by the project's name and tagline, drawn from its description."},
	{"project-brief", "Project brief chat", "How the Overview tab's chat collaborator behaves: the questions that turn a bare project title into a description, and how the draft is maintained turn over turn."},
	{"obs-setup", "OBS, routines & smart sources", "How Jax drives OBS: routines around going live, and token-templated smart sources."},
	{skillAIDebugging, "AI Debugging", "Work the debug-report queue over MCP: find open reports, reproduce, fix, verify, then delete the resolved report."},
}

// skillAIDebugging is the optional developer skill, listed only while the
// Settings → Development toggle (keyDevDebugSkillEnabled) is on.
const skillAIDebugging = "ai-debugging"

// devDebugSkillEnabled reports whether the AI Debugging skill is switched on.
func (a *App) devDebugSkillEnabled() bool {
	if a.store == nil {
		return false
	}
	v, err := a.store.getSetting(keyDevDebugSkillEnabled)
	if err != nil {
		log.Printf("jax: dev debug skill setting: %v", err)
		return false
	}
	return v == "true"
}

// AppSkill is an Application Skill as served to the frontend and MCP:
// catalog metadata plus the effective markdown content.
type AppSkill struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
	Overridden  bool   `json:"overridden"`
}

// defaultSkillContent reads a skill's embedded default markdown.
func defaultSkillContent(id string) (string, error) {
	raw, err := skillFiles.ReadFile("skills/" + id + ".md")
	if err != nil {
		return "", fmt.Errorf("no default content for skill %q: %v", id, err)
	}
	return string(raw), nil
}

// skillOverrides loads the id → content override map ({} when none exist).
func (a *App) skillOverrides() map[string]string {
	overrides := map[string]string{}
	if a.store == nil {
		return overrides
	}
	if _, err := a.store.getJSON(keyAppSkillOverrides, &overrides); err != nil {
		log.Printf("jax: skill overrides: %v", err)
	}
	return overrides
}

// ListAppSkills returns every Application Skill with its effective content.
func (a *App) ListAppSkills() ([]AppSkill, error) {
	overrides := a.skillOverrides()
	devDebug := a.devDebugSkillEnabled()
	out := make([]AppSkill, 0, len(appSkillDefs))
	for _, def := range appSkillDefs {
		if def.ID == skillAIDebugging && !devDebug {
			continue
		}
		content, overridden := overrides[def.ID]
		if !overridden {
			var err error
			if content, err = defaultSkillContent(def.ID); err != nil {
				return nil, err
			}
		}
		out = append(out, AppSkill{
			ID:          def.ID,
			Title:       def.Title,
			Description: def.Description,
			Content:     content,
			Overridden:  overridden,
		})
	}
	// Widget field types each publish a dynamic skill alongside the fixed
	// catalog — the brief behind producing that field's content (see
	// widget_fields.go). They override and reset like any other skill.
	for _, ft := range a.getWidgetFieldTypes() {
		id := widgetFieldSkillID(ft)
		content, overridden := overrides[id]
		if !overridden {
			content = widgetFieldSkillContent(ft)
		}
		out = append(out, AppSkill{
			ID:          id,
			Title:       "Widget field: " + ft.Name,
			Description: widgetFieldSkillDescription(ft),
			Content:     content,
			Overridden:  overridden,
		})
	}
	// So does each stream widget: its skill is the creative brief behind
	// generating the widget's imagery (see widget_images.go).
	for _, w := range a.getStreamWidgets() {
		id := widgetSkillID(w)
		content, overridden := overrides[id]
		if !overridden {
			content = widgetSkillContent(w)
		}
		out = append(out, AppSkill{
			ID:          id,
			Title:       "Stream widget: " + w.Name,
			Description: widgetSkillDescription(w),
			Content:     content,
			Overridden:  overridden,
		})
	}
	return out, nil
}

// defaultContentFor returns a skill's default content: the embedded markdown
// for catalog skills, or the generated brief for a widget field type's or
// stream widget's dynamic skill.
func (a *App) defaultContentFor(id string) (string, error) {
	if ft, ok := a.widgetFieldBySkillID(id); ok {
		return widgetFieldSkillContent(ft), nil
	}
	if w, ok := a.widgetBySkillID(id); ok {
		return widgetSkillContent(w), nil
	}
	return defaultSkillContent(id)
}

// getAppSkill returns one skill by id.
func (a *App) getAppSkill(id string) (AppSkill, error) {
	skills, err := a.ListAppSkills()
	if err != nil {
		return AppSkill{}, err
	}
	for _, s := range skills {
		if s.ID == id {
			return s, nil
		}
	}
	return AppSkill{}, fmt.Errorf("no application skill with id %q", id)
}

// SaveAppSkill stores content as the skill's override and returns the updated
// skill. Saving content identical to the embedded default clears the override
// instead, so the skill reads as unmodified.
func (a *App) SaveAppSkill(id, content string) (AppSkill, error) {
	def, err := a.defaultContentFor(id)
	if err != nil {
		return AppSkill{}, err
	}
	if a.store == nil {
		return AppSkill{}, fmt.Errorf("store is not open")
	}
	overrides := a.skillOverrides()
	if content == def {
		delete(overrides, id)
	} else {
		overrides[id] = content
	}
	if err := a.store.setJSON(keyAppSkillOverrides, overrides); err != nil {
		return AppSkill{}, err
	}
	return a.getAppSkill(id)
}

// ResetAppSkill removes the skill's override, restoring the embedded default.
func (a *App) ResetAppSkill(id string) (AppSkill, error) {
	if _, err := a.defaultContentFor(id); err != nil {
		return AppSkill{}, err
	}
	if a.store == nil {
		return AppSkill{}, fmt.Errorf("store is not open")
	}
	overrides := a.skillOverrides()
	delete(overrides, id)
	if err := a.store.setJSON(keyAppSkillOverrides, overrides); err != nil {
		return AppSkill{}, err
	}
	return a.getAppSkill(id)
}

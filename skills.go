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
	{"brand-assets", "Brand assets", "What the uploaded brand files are, the naming/description conventions that make them usable, and how features apply them."},
	{"content-series", "Content series & episodes", "Define recurring shows, keep episode numbering consistent, and assign streams to series."},
	{"go-live", "Going live", "The broadcast-day flow: applying a plan, monitoring while live, and concluding the episode."},
	{"past-streams", "Reviewing past streams", "Work the stream archive: transcripts, chat logs, and AI outlines for recaps and clip hunting."},
	{"download-transcribe", "Downloads & transcription", "Pull VODs to disk and re-transcribe them locally for cleaner transcripts."},
	{"videos", "Videos & video plans", "Browse the channels' catalogue, review performance, and prepare video plans for the editor."},
	{"video-edit-directions", "Video edit session directions", "Turn a video plan, its source-stream context, and the producer's notes into the brief handed to the automated edit session."},
	{"projects", "Projects & docs", "Use projects as the writing and reference space: doc trees, conventions, and what stays app-only."},
	{"obs-setup", "OBS, routines & smart sources", "How Jax drives OBS: routines around going live, and token-templated smart sources."},
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
	out := make([]AppSkill, 0, len(appSkillDefs))
	for _, def := range appSkillDefs {
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
	return out, nil
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
	def, err := defaultSkillContent(id)
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
	if _, err := defaultSkillContent(id); err != nil {
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

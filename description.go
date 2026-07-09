package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// AI-suggested plan descriptions
//
// The stream-plan form can ask for a suggested description: the model reads
// the plan's series context and the previous episodes — their titles, episode
// descriptions, and stored AI outlines (see outline.go) — and drafts a
// description that continues the arc and proposes what the next stream should
// cover. A second endpoint applies requested edits, either to a highlighted
// section or to the whole text.
//
// Like outlines, calls run on the connected AI service via askAI (see
// ai.go): subscription accounts through Claude Code / Codex headless, API
// keys against the raw APIs.
// ---------------------------------------------------------------------------

// How many previous episodes of the series feed the prompt.
const descriptionEpisodeLookback = 5

// descriptionTools are the app MCP tools a Claude-account description run may
// call — read access to the series, past streams, and their transcripts and
// outlines, so drafts and edits are grounded in what actually happened
// instead of invented.
const descriptionTools = "mcp__jax__get_app_status," +
	"mcp__jax__list_content_series," +
	"mcp__jax__list_past_streams," +
	"mcp__jax__get_episode_numbers," +
	"mcp__jax__get_stream_outline," +
	"mcp__jax__get_stream_transcript," +
	"mcp__jax__list_brand_links"

const generateSuggestionInstructions = `You help a broadcaster plan their next live stream.

The input contains the series' context and the previous episodes — their titles, descriptions, and outlines of what actually happened. Propose the NEXT stream.

Respond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:
{"title": "...", "description": "...", "tags": ["...", "..."]}

Rules:
- "title": a concise stream title. No episode number — the app composes that in. When the input carries a working title, refine that topic rather than replacing it.
- "description": plain markdown — 2-4 short paragraphs or a brief intro plus a bulleted list of the items planned for this stream. Continue naturally from where the previous episodes left off: pick up loose threads, unfinished work, and questions the outlines surface, and propose the concrete next items to cover. Written in the streamer's voice to their audience; don't mention "episodes", "outlines", or this prompt.
- "tags": 5-10 short lowercase tags for this stream (single words or short phrases).
- When the input includes a "# Brand links" section, close the description with a short links line (e.g. a "Follow along" list) using the relevant ones — URLs verbatim, only from that list, never invented.`

const editSelectionInstructions = `You edit stream descriptions. The input contains a full description, one highlighted section from it, and an instruction.

Rewrite ONLY the highlighted section following the instruction, keeping it coherent with the surrounding text.

The input may include a "# Brand links" section for reference — when linking to the brand's socials or site, use those URLs verbatim and never invent others.

Respond with ONLY the replacement text for the highlighted section — no commentary, no code fences, no surrounding text.`

const editWholeInstructions = `You edit stream descriptions. The input contains a full description and an instruction.

Revise the description following the instruction.

The input may include a "# Brand links" section for reference — when linking to the brand's socials or site, use those URLs verbatim and never invent others.

Respond with ONLY the full revised description in plain markdown — no commentary, no code fences.`

// planOutline mirrors the stored stream outline (see outline.go) closely
// enough to read it for prompt context.
type planOutline struct {
	Summary string `json:"summary"`
	Items   []struct {
		At    string `json:"at"`
		Title string `json:"title"`
		Note  string `json:"note"`
	} `json:"items"`
}

// PlanSuggestion is a generated draft for the stream being planned.
type PlanSuggestion struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}

// GeneratePlanSuggestion drafts a title, description, and tags for the stream
// being planned, from the series context and the previous episodes' outlines.
func (a *App) GeneratePlanSuggestion(title, seriesID string, episodeNumber int) (PlanSuggestion, error) {
	var s PlanSuggestion
	input := a.descriptionContext(title, seriesID, episodeNumber)
	text, err := a.askAIText(
		generateSuggestionInstructions, input,
		a.claudeMCPArgs(descriptionTools)...,
	)
	if err != nil {
		return s, err
	}
	// Tolerate stray prose or fences around the JSON object.
	lo := strings.Index(text, "{")
	hi := strings.LastIndex(text, "}")
	if lo < 0 || hi <= lo {
		return s, fmt.Errorf("the model returned an unexpected format — try again")
	}
	if err := json.Unmarshal([]byte(text[lo:hi+1]), &s); err != nil {
		return s, fmt.Errorf("the model returned an unexpected format — try again")
	}
	s.Title = strings.TrimSpace(s.Title)
	s.Description = strings.TrimSpace(s.Description)
	if s.Tags == nil {
		s.Tags = []string{}
	}
	if s.Title == "" && s.Description == "" {
		return s, fmt.Errorf("the model returned an empty suggestion — try again")
	}
	return s, nil
}

// EditPlanDescription applies a requested edit to a plan description. With a
// selection it returns ONLY the replacement for that highlighted section (the
// caller splices it in); without one it returns the full revised description.
func (a *App) EditPlanDescription(description, selection, instruction string) (string, error) {
	if strings.TrimSpace(instruction) == "" {
		return "", fmt.Errorf("describe the edit you want")
	}
	if strings.TrimSpace(description) == "" {
		return "", fmt.Errorf("there is no description to edit yet")
	}

	var system string
	var b strings.Builder
	b.WriteString("# Description\n")
	b.WriteString(description)
	if strings.TrimSpace(selection) != "" {
		system = editSelectionInstructions
		b.WriteString("\n\n# Highlighted section\n")
		b.WriteString(selection)
	} else {
		system = editWholeInstructions
	}
	// The brand's outward links (Profile → Links) always ride along, so edits
	// that add socials/site references use the real URLs.
	if links := a.brandLinksText(); links != "" {
		b.WriteString("\n\n")
		b.WriteString(links)
	}
	b.WriteString("\n\n# Instruction\n")
	b.WriteString(instruction)

	return a.askAIText(system, b.String(), a.claudeMCPArgs(descriptionTools)...)
}

// descriptionContext assembles the series + previous-episodes document the
// model reads. Missing pieces (no series, no outlines) simply thin the
// context rather than failing.
func (a *App) descriptionContext(title, seriesID string, episodeNumber int) string {
	var b strings.Builder

	b.WriteString("# Next stream\n")
	if strings.TrimSpace(title) != "" {
		fmt.Fprintf(&b, "Title: %s\n", title)
	} else {
		b.WriteString("Title: (not decided yet)\n")
	}
	if episodeNumber > 0 {
		fmt.Fprintf(&b, "Episode: %d\n", episodeNumber)
	}

	if seriesID != "" {
		for _, s := range a.GetContentSeries() {
			if s.ID != seriesID {
				continue
			}
			b.WriteString("\n# Series\n")
			fmt.Fprintf(&b, "Title: %s\n", s.Title)
			if s.Description != "" {
				fmt.Fprintf(&b, "About: %s\n", s.Description)
			}
			if len(s.Tags) > 0 {
				fmt.Fprintf(&b, "Tags: %s\n", strings.Join(s.Tags, ", "))
			}
			if s.Notes != "" {
				fmt.Fprintf(&b, "Notes:\n%s\n", s.Notes)
			}
			break
		}

		// The most recent episodes, oldest first so the arc reads forward.
		episodes := []PastStream{}
		for _, s := range a.GetPastStreams(false) {
			if s.SeriesID == seriesID {
				episodes = append(episodes, s)
			}
		}
		sort.Slice(episodes, func(i, j int) bool {
			return episodes[i].StartedAt > episodes[j].StartedAt
		})
		if len(episodes) > descriptionEpisodeLookback {
			episodes = episodes[:descriptionEpisodeLookback]
		}
		for i, j := 0, len(episodes)-1; i < j; i, j = i+1, j-1 {
			episodes[i], episodes[j] = episodes[j], episodes[i]
		}

		if len(episodes) > 0 {
			b.WriteString("\n# Previous episodes\n")
		}
		for _, ep := range episodes {
			fmt.Fprintf(&b, "\n## %s", firstNonEmpty(ep.Title, "Untitled stream"))
			if ep.EpisodeNumber > 0 {
				fmt.Fprintf(&b, " (episode %d)", ep.EpisodeNumber)
			}
			b.WriteString("\n")
			if ep.EpisodeDescription != "" {
				fmt.Fprintf(&b, "Description: %s\n", ep.EpisodeDescription)
			}
			b.WriteString(a.storedOutlineText(ep.StartedAt))
		}
	}

	// The brand's outward links (Profile → Links) always ride along, so the
	// drafted description can point the audience at the real socials/site.
	if links := a.brandLinksText(); links != "" {
		b.WriteString("\n")
		b.WriteString(links)
	}
	return b.String()
}

// storedOutlineText renders a past stream's stored AI outline for the prompt
// ("" when none was generated).
func (a *App) storedOutlineText(startedAt string) string {
	if a.store == nil {
		return ""
	}
	var out planOutline
	// Same key the outline feature persists under (keyOutlinePrefix).
	if ok, err := a.store.getJSON("stream_outline|"+startedAt, &out); err != nil || !ok {
		return ""
	}
	var b strings.Builder
	if out.Summary != "" {
		fmt.Fprintf(&b, "Summary: %s\n", out.Summary)
	}
	if len(out.Items) > 0 {
		b.WriteString("Outline:\n")
		for _, item := range out.Items {
			fmt.Fprintf(&b, "- [%s] %s", item.At, item.Title)
			if item.Note != "" {
				fmt.Fprintf(&b, " — %s", item.Note)
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}


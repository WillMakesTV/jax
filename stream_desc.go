package main

import (
	"fmt"
	"log"
	"strings"
)

// ---------------------------------------------------------------------------
// Past-stream descriptions
//
// A past stream's description defaults to its concluded plan's, but streams
// without a plan (or whose plan text no longer fits what actually aired) can
// carry their own: written in the markdown editor or drafted by AI. AI drafts
// work like plan suggestions (see description.go) with one difference — the
// stream already happened, so its stored outline is the primary grounding and
// the copy must read as a recording, not an announcement.
// ---------------------------------------------------------------------------

// keyStreamDescriptions stores the startedAt → custom description map.
const keyStreamDescriptions = "past_stream_descriptions"

// streamDescriptions loads the saved startedAt → description map. Never nil.
func (a *App) streamDescriptions() map[string]string {
	m := map[string]string{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyStreamDescriptions, &m); err != nil {
			log.Printf("jax: load stream descriptions: %v", err)
		}
	}
	if m == nil {
		return map[string]string{}
	}
	return m
}

// SetStreamDescription stores a custom description for the past stream that
// started at startedAt. Clearing the text removes the override, falling back
// to the concluded plan's description when the stream has one.
func (a *App) SetStreamDescription(startedAt, description string) error {
	if a.store == nil {
		return fmt.Errorf("storage is unavailable")
	}
	if strings.TrimSpace(startedAt) == "" {
		return fmt.Errorf("no stream identified")
	}
	m := a.streamDescriptions()
	if strings.TrimSpace(description) == "" {
		delete(m, startedAt)
	} else {
		m[startedAt] = description
	}
	return a.store.setJSON(keyStreamDescriptions, m)
}

// applyStreamDescriptions resolves each past stream's effective description:
// the stored custom text when present, otherwise the concluded plan's.
func (a *App) applyStreamDescriptions(out []PastStream) {
	m := a.streamDescriptions()
	pushes := a.descPushes()
	for i := range out {
		if d, ok := m[out[i].StartedAt]; ok && strings.TrimSpace(d) != "" {
			out[i].Description = d
		} else if out[i].Plan != nil {
			out[i].Description = out[i].Plan.Description
		}
		out[i].DescriptionPushed = pushes[out[i].StartedAt]
	}
}

const generateStreamDescriptionInstructions = `You write the public YouTube description for a broadcaster's PAST live stream — it already happened and is published as a recording.

The input contains the stream's title, an outline of what actually happened on it (with timestamps), and (when available) its series context and previous episodes for voice and continuity. When it carries a "# Description style guide" section, follow it — this is a PAST stream, so its "Past streams" rules apply.

Respond with ONLY the description as plain text — no commentary, no code fences, and no markdown syntax (YouTube renders descriptions literally; bare URLs are fine).

Rules:
- Optimize for YouTube search and recommendations: the first 1-2 sentences carry the main keywords (they show above the fold and weigh heaviest), and every keyword or phrase someone would search to find this content — tools, technologies, project names, activities — appears naturally in the text. Never a keyword dump.
- Ground everything in this stream's outline — describe what actually happened; never invent events or results.
- Include a "Chapters" block built from the outline's timestamps, one chapter per line in YouTube's format: the first line "0:00" plus a title, then each outline timestamp with a short title.
- Past framing: the stream is over. No "join me", "going live", or countdown language.
- Written in the streamer's voice to their audience; don't mention "episodes", "outlines", or this prompt.
- When the input includes a "# Brand links" section, include the relevant URLs verbatim (bare, on their own lines or a short list) near the end — only from that list, never invented.
- Close with 2-3 relevant #hashtags on one line.`

// GenerateStreamDescription drafts a description for a past stream. The
// stream's stored outline is required — it is what grounds the copy in what
// actually aired — and the series context the plan generator uses rides
// along for voice and continuity.
func (a *App) GenerateStreamDescription(startedAt, title, seriesID string, episodeNumber int) (string, error) {
	outlineText := a.storedOutlineText(startedAt)
	if outlineText == "" {
		return "", fmt.Errorf("this stream has no outline yet — generate one on the Outline tab first, it's what the description is grounded in")
	}

	var b strings.Builder
	b.WriteString("# This stream\n")
	if strings.TrimSpace(title) != "" {
		fmt.Fprintf(&b, "Title: %s\n", strings.TrimSpace(title))
	}
	if episodeNumber > 0 {
		fmt.Fprintf(&b, "Episode: %d\n", episodeNumber)
	}
	b.WriteString(outlineText)
	b.WriteString(a.seriesEpisodesContext(seriesID, startedAt))
	if links := a.brandLinksText(); links != "" {
		b.WriteString("\n")
		b.WriteString(links)
	}
	b.WriteString(a.descriptionStyleGuide())

	text, err := a.askAIText(
		generateStreamDescriptionInstructions, b.String(),
		a.claudeMCPArgs(descriptionTools)...,
	)
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("the model returned an empty description — try again")
	}
	return text, nil
}

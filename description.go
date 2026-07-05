package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
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
// Like outlines, calls run on the connected Anthropic service: account mode
// through Claude Code headless, API-key mode against the Messages API.
// ---------------------------------------------------------------------------

const (
	messagesAPIURL   = "https://api.anthropic.com/v1/messages"
	descriptionModel = "claude-opus-4-8" // API-key mode; account mode uses Claude Code's default

	// How many previous episodes of the series feed the prompt.
	descriptionEpisodeLookback = 5
)

var descriptionHTTP = &http.Client{Timeout: 3 * time.Minute}

const generateDescriptionInstructions = `You write stream descriptions for a broadcaster planning their next live stream.

The input contains the series' context and the previous episodes — their titles, descriptions, and outlines of what actually happened. Draft the description for the NEXT stream.

Rules:
- Respond with ONLY the description text in plain markdown — no headings, no code fences, no commentary, no title line.
- 2-4 short paragraphs or a brief intro plus a bulleted list of the items planned for this stream.
- Continue naturally from where the previous episodes left off: pick up loose threads, unfinished work, and questions the outlines surface, and propose the concrete next items to cover.
- Write in the streamer's voice to their audience; don't mention "episodes", "outlines", or this prompt.`

const editSelectionInstructions = `You edit stream descriptions. The input contains a full description, one highlighted section from it, and an instruction.

Rewrite ONLY the highlighted section following the instruction, keeping it coherent with the surrounding text.

Respond with ONLY the replacement text for the highlighted section — no commentary, no code fences, no surrounding text.`

const editWholeInstructions = `You edit stream descriptions. The input contains a full description and an instruction.

Revise the description following the instruction.

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

// GeneratePlanDescription drafts a description for the stream being planned,
// from the series context and the previous episodes' outlines.
func (a *App) GeneratePlanDescription(title, seriesID string, episodeNumber int) (string, error) {
	input := a.descriptionContext(title, seriesID, episodeNumber)
	return a.askClaude(generateDescriptionInstructions, input)
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
	b.WriteString("\n\n# Instruction\n")
	b.WriteString(instruction)

	return a.askClaude(system, b.String())
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

// askClaude runs a system+input prompt on the connected Anthropic service and
// returns the response text, trimmed.
func (a *App) askClaude(system, input string) (string, error) {
	conn, connected := a.getConn(anthropicService)
	if !connected {
		return "", fmt.Errorf("connect Anthropic in Settings → AI first")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	var text string
	var err error
	if conn.login == anthropicModeAPIKey {
		text, err = a.askClaudeAPI(ctx, system, input)
	} else {
		text, err = askClaudeCode(ctx, system, input)
	}
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("the model returned no text — try again")
	}
	return text, nil
}

// askClaudeCode runs the prompt through Claude Code headless (subscription
// usage); the document goes in on stdin.
func askClaudeCode(ctx context.Context, system, input string) (string, error) {
	cmd, err := claudeHeadlessCmd(ctx, system)
	if err != nil {
		return "", err
	}
	// A neutral working directory keeps Claude Code from picking up this
	// app's (or any) project context.
	cmd.Dir = os.TempDir()
	cmd.Stdin = strings.NewReader(input)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := firstNonEmpty(strings.TrimSpace(stderr.String()), err.Error())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return "", fmt.Errorf("Claude Code could not respond: %s", msg)
	}
	return stdout.String(), nil
}

// askClaudeAPI runs the prompt against the Messages API with the stored key.
func (a *App) askClaudeAPI(ctx context.Context, system, input string) (string, error) {
	headers, err := a.anthropicAuthHeaders()
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(map[string]any{
		"model":      descriptionModel,
		"max_tokens": 4096,
		"system":     system,
		"messages": []map[string]any{
			{"role": "user", "content": input},
		},
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, messagesAPIURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := descriptionHTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not reach the Anthropic API: %v", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		msg := string(raw)
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return "", fmt.Errorf("Anthropic API error (%d): %s", resp.StatusCode, msg)
	}

	var r struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return "", err
	}
	var b strings.Builder
	for _, block := range r.Content {
		if block.Type == "text" {
			b.WriteString(block.Text)
		}
	}
	if b.Len() == 0 {
		return "", fmt.Errorf("the model returned no text (stop reason: %s)", r.StopReason)
	}
	return b.String(), nil
}

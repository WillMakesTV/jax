package main

import (
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Project brief chat
//
// The Overview tab's description-building conversation: the producer creates
// a project with only a title, then talks it through with the connected AI
// service. Every turn the model answers conversationally AND rewrites the
// full description draft, which the page drops straight into the markdown
// editor. The chat itself is not persisted — the description is the record.
// ---------------------------------------------------------------------------

// projectBriefSkillID is the Application Skill whose content is the system
// prompt for the chat (user-tunable in Settings → Skills).
const projectBriefSkillID = "project-brief"

// projectChatTools are the app MCP tools the brief chat may call (account
// mode only) — the live app documentation plus read access to the app's
// state, so the chat can describe any detail of Jax and ground the brief in
// what actually exists. Nothing that mutates state.
const projectChatTools = "mcp__jax__describe_app," +
	"mcp__jax__list_app_pages," +
	"mcp__jax__list_app_functions," +
	"mcp__jax__list_app_models," +
	"mcp__jax__search_app_docs," +
	"mcp__jax__get_app_status," +
	"mcp__jax__list_projects," +
	"mcp__jax__get_project," +
	"mcp__jax__list_skills," +
	"mcp__jax__get_skill," +
	"mcp__jax__list_content_series," +
	"mcp__jax__list_past_streams," +
	"mcp__jax__list_brand_links"

// ProjectChatMessage is one prior turn of the description-building chat.
type ProjectChatMessage struct {
	Role string `json:"role"` // "user" or "assistant"
	Text string `json:"text"`
}

// ProjectChatReply is the assistant's turn: the conversational reply and the
// full replacement description draft (empty when the model left it alone).
type ProjectChatReply struct {
	Reply       string `json:"reply"`
	Description string `json:"description"`
}

// chatDescriptionMarker separates the reply from the description draft in the
// model's output. Kept in code (not the skill) so a skill override can't
// break the parsing.
const chatDescriptionMarker = "---DESCRIPTION---"

// ChatProjectDescription runs one turn of a project's brief chat: the history
// and the producer's new message go to the connected AI service, which
// replies conversationally and rewrites the description draft in full.
func (a *App) ChatProjectDescription(projectID string, history []ProjectChatMessage, message string) (ProjectChatReply, error) {
	if strings.TrimSpace(message) == "" {
		return ProjectChatReply{}, fmt.Errorf("write a message first")
	}
	var project *Project
	for _, p := range a.getProjects() {
		if p.ID == projectID {
			project = &p
			break
		}
	}
	if project == nil {
		return ProjectChatReply{}, fmt.Errorf("no project with id %q", projectID)
	}
	skill, err := a.getAppSkill(projectBriefSkillID)
	if err != nil {
		return ProjectChatReply{}, err
	}
	system := skill.Content + "\n\nRespond in two parts separated by a line containing exactly " +
		chatDescriptionMarker + ": above it your conversational reply, below it the complete " +
		"current draft of the project description in plain markdown. Always include both parts, " +
		"and always write the description in full — it replaces the previous draft. No code fences."

	// Old turns fall off the front; the description draft carries what they
	// established, so the model loses color, not facts.
	if len(history) > 40 {
		history = history[len(history)-40:]
	}

	var b strings.Builder
	b.WriteString("# Project\n")
	fmt.Fprintf(&b, "Title: %s\n", project.Title)
	if desc := strings.TrimSpace(project.Description); desc != "" {
		fmt.Fprintf(&b, "\nCurrent description draft:\n%s\n", desc)
	}
	if len(history) > 0 {
		b.WriteString("\n# Conversation so far\n")
		for _, m := range history {
			speaker := "Producer"
			if m.Role == "assistant" {
				speaker = "You"
			}
			fmt.Fprintf(&b, "%s: %s\n\n", speaker, strings.TrimSpace(m.Text))
		}
	}
	b.WriteString("\n# The producer's new message\n")
	b.WriteString(strings.TrimSpace(message))
	b.WriteString("\n")

	// Account-mode runs get the app's own MCP tools: the live application
	// documentation and read access to app state, so the chat can answer
	// questions about Jax itself while building the brief.
	text, err := a.askAIText(system, b.String(), a.claudeMCPArgs(projectChatTools)...)
	if err != nil {
		return ProjectChatReply{}, err
	}
	return parseProjectChatReply(text), nil
}

// parseProjectChatReply splits the model's output at the description marker.
// With no marker the whole text is the reply and the draft is left alone.
func parseProjectChatReply(text string) ProjectChatReply {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == chatDescriptionMarker {
			return ProjectChatReply{
				Reply:       strings.TrimSpace(strings.Join(lines[:i], "\n")),
				Description: strings.TrimSpace(strings.Join(lines[i+1:], "\n")),
			}
		}
	}
	return ProjectChatReply{Reply: strings.TrimSpace(text)}
}

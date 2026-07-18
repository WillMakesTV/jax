package main

import (
	"fmt"
	"log"
	"strings"
)

// ---------------------------------------------------------------------------
// About Jax
//
// The app's own description — what Jax is and what it can do, written by the
// producer with the same description-building chat projects use. It lives in
// Settings → About (not as a regular project), persists as a setting, and
// feeds describe_app so MCP clients read the producer's own portrait of the
// application alongside the generated docs.
// ---------------------------------------------------------------------------

// aboutProjectTitle matches the legacy "Project Jax …" project the app
// description used to live in, adopted as the About seed on first read.
const aboutProjectTitle = "project jax"

// GetAppAbout returns the stored About description. When it has never been
// set, the legacy "Project Jax …" project's description (if such a project
// exists) is adopted and persisted as the starting point, so the move into
// Settings loses nothing.
func (a *App) GetAppAbout() string {
	if a.store == nil {
		return ""
	}
	about, err := a.store.getSetting(keyAppAbout)
	if err != nil {
		log.Printf("jax: read app about: %v", err)
		return ""
	}
	if strings.TrimSpace(about) != "" {
		return about
	}
	for _, p := range a.getProjects() {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(p.Title)), aboutProjectTitle) &&
			strings.TrimSpace(p.Description) != "" {
			if err := a.store.setSetting(keyAppAbout, p.Description); err != nil {
				log.Printf("jax: adopt app about: %v", err)
				return p.Description
			}
			return p.Description
		}
	}
	return ""
}

// SetAppAbout stores the About description.
func (a *App) SetAppAbout(description string) error {
	if a.store == nil {
		return fmt.Errorf("store is not open")
	}
	return a.store.setSetting(keyAppAbout, strings.TrimSpace(description))
}

// ChatAppAbout runs one turn of the About page's description chat — the same
// engine as a project brief, with the application itself as the subject. The
// live app-documentation tools ground what the chat says about features in
// the real build.
func (a *App) ChatAppAbout(history []ProjectChatMessage, message string) (ProjectChatReply, error) {
	var b strings.Builder
	b.WriteString("# Subject\n")
	b.WriteString("This conversation's subject is the Jax application itself — the AI content " +
		"producer & dashboard this chat runs inside. The description being built is the app's " +
		"About page: what Jax is, what it can do, and how its pieces fit together. When the app " +
		"documentation tools are available (describe_app, list_app_pages, list_app_functions, " +
		"list_app_models, search_app_docs), use them to ground every feature claim in the real " +
		"build instead of guessing.\n")
	if about := strings.TrimSpace(a.GetAppAbout()); about != "" {
		fmt.Fprintf(&b, "\nCurrent description draft:\n%s\n", about)
	}
	return a.runDescriptionChat(b.String(), history, message)
}

package main

import (
	"fmt"
	"strings"

	"bp-temp/internal/widgetfmt"
)

// ---------------------------------------------------------------------------
// System widget AI display generation
//
// System widgets get the same AI display generation the producer's own
// widgets do (widget_source.go): describe the display you want and the model
// writes it. Template widgets (Issue Tracker, Active Project) get a full JSX
// template plus CSS and JS; page widgets (Unified Chat, Sponsors, Event Feed)
// get CSS and JS layered onto their fixed overlay. The brief is the matching
// custom widget's own skill when one is adopted, else a built-in one — the
// "same skills" a custom widget's generation uses.
// ---------------------------------------------------------------------------

// systemWidgetAdopted returns the custom widget a system widget adopts the
// design of, if any — so generation can borrow that widget's skill.
func (a *App) systemWidgetAdopted(id string) (*StreamWidget, bool) {
	if id == systemWidgetActiveProject {
		return a.customWidgetByName([]string{"active project"})
	}
	return nil, false
}

// systemWidgetGenBrief is the built-in briefing for a system widget's display
// generation: what the widget shows and the values its template binds to,
// used when no adopted custom widget lends its skill. The current template
// (passed as the edit base) carries the exact bindings, so this stays short.
func systemWidgetGenBrief(id string) string {
	switch id {
	case systemWidgetIssueTracker:
		return `You are designing the Issue Tracker overlay: the bug queue live on
stream. It is a list-style widget — render items (newest first), each an
entry {id, createdAt, values} whose values carry "Message" (the report or
work summary) and "Status" ("Queued", a working "Working #<n>", or a
resolved "Done #<n>"). The queue drives the items; there are no fields.`
	case systemWidgetActiveProject:
		return `You are designing the Active Project overlay: the project being worked
on right now, following it live. Its template renders the active project's
name and cover image.`
	case systemWidgetUnifiedChat:
		return `You are restyling the Unified Chat overlay: every connected channel's
chat merged into one feed. Its markup is fixed — write CSS (and optionally
JS) layered on top of it.`
	case systemWidgetSponsors:
		return `You are restyling the Sponsors overlay: the saved sponsors on rotation
under a "Sponsored By" heading. Its markup is fixed — write CSS (and
optionally JS) layered on top of it.`
	case systemWidgetEventFeed:
		return `You are restyling the Event Feed overlay: every earned follow, sub,
gift, cheer and raid as one scrolling history, grouped by stream. Its
markup is fixed — write CSS (and optionally JS) layered on top of it.`
	}
	return "You are designing a system widget's display."
}

// GenerateSystemWidgetDisplay produces (or revises) a system widget's display
// from the producer's description, briefed the same way a custom widget's
// generation is. Template widgets get template/CSS/JS; page widgets get
// CSS/JS layered on their fixed overlay. The result is stored and the updated
// display returned.
func (a *App) GenerateSystemWidgetDisplay(id, description string) (SystemWidgetDisplay, error) {
	description = strings.TrimSpace(description)
	if description == "" {
		return SystemWidgetDisplay{}, fmt.Errorf("describe the display you want first")
	}
	kind := systemWidgetDisplayKind(id)
	if kind == "" {
		return SystemWidgetDisplay{}, fmt.Errorf("system widget %q has no editable display", id)
	}
	cur, err := a.GetSystemWidgetDisplay(id)
	if err != nil {
		return SystemWidgetDisplay{}, err
	}

	// Brief with the adopted custom widget's own skill when there is one — the
	// same skill that widget's generation uses — else the built-in brief.
	brief := systemWidgetGenBrief(id)
	if cw, ok := a.systemWidgetAdopted(id); ok {
		if skill, err := a.getAppSkill(widgetSkillID(*cw)); err == nil &&
			strings.TrimSpace(skill.Content) != "" {
			brief = skill.Content
		}
	}

	system := brief + widgetDisplayFormatBrief
	if kind == displayKindPage {
		system += "\n\nThis overlay's markup is fixed — you cannot change its template. " +
			"Return an empty template (\"\") and put every change in css and js, which " +
			"are layered onto the built-in overlay."
	}

	var in strings.Builder
	fmt.Fprintf(&in, "# Widget\nName: %s\n", cur.Name)
	if strings.TrimSpace(cur.Template) != "" {
		fmt.Fprintf(&in, "\n## Current template\n%s\n", cur.Template)
	}
	if strings.TrimSpace(cur.CSS) != "" {
		fmt.Fprintf(&in, "\n## Current CSS\n%s\n", cur.CSS)
	}
	if strings.TrimSpace(cur.JS) != "" {
		fmt.Fprintf(&in, "\n## Current JS\n%s\n", cur.JS)
	}
	fmt.Fprintf(&in, "\n# Requested display\n%s\n", description)

	text, err := a.askAIText(system, in.String())
	if err != nil {
		return SystemWidgetDisplay{}, err
	}
	parsed, err := parseWidgetDisplay(text, kind == displayKindTemplate)
	if err != nil {
		return SystemWidgetDisplay{}, err
	}
	// Page widgets keep an empty template — their CSS/JS is additive.
	template := ""
	if kind == displayKindTemplate {
		template = widgetfmt.JSX(parsed.Template)
	}
	return a.SetSystemWidgetDisplay(id, template, widgetfmt.CSS(parsed.CSS), widgetfmt.JS(parsed.JS))
}

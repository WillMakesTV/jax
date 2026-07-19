package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Widget field types
//
// The catalog of field kinds a stream widget can carry, managed from the
// Stream Widgets tab's "Manage Field Types" dialog. Four defaults seed the
// catalog on first read (an image/animation, a markdown message, a short
// status line, and a sound); the producer can add, rename, or remove types
// after that.
//
// Every field type also publishes a dynamic Application Skill — the brief
// behind generating that field's content — listed alongside the fixed skill
// catalog and overridable like any other skill (see skills.go).
// ---------------------------------------------------------------------------

// Widget field kinds: what variety of input the field takes.
const (
	// widgetFieldImage is an image or animation (jpeg/gif/webp), filled by
	// file upload or AI generation.
	widgetFieldImage = "image"
	// widgetFieldMessage is a long markdown text area.
	widgetFieldMessage = "message"
	// widgetFieldStatus is a short plain-text line.
	widgetFieldStatus = "status"
	// widgetFieldSound is an uploaded audio file (mp3/wav/ogg/…) the widget
	// plays when called upon.
	widgetFieldSound = "sound"
)

// Default caps for the text kinds.
const (
	widgetMessageMaxLen = 255
	widgetStatusMaxLen  = 110
)

// WidgetFieldType describes one kind of field available to stream widgets.
type WidgetFieldType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Kind is the input variety: "image", "message", "status", or "sound".
	Kind string `json:"kind"`
	// MaxLength caps the text kinds' content; 0 for image kinds.
	MaxLength int    `json:"maxLength"`
	CreatedAt string `json:"createdAt"` // RFC3339
}

// defaultWidgetFieldTypes are the catalog's seed entries. Their ids are
// fixed so the dynamic skills they publish keep stable identities.
func defaultWidgetFieldTypes() []WidgetFieldType {
	now := time.Now().UTC().Format(time.RFC3339)
	return []WidgetFieldType{
		{ID: "field_image", Name: "Image/Animation", Kind: widgetFieldImage, CreatedAt: now},
		{ID: "field_message", Name: "Message", Kind: widgetFieldMessage, MaxLength: widgetMessageMaxLen, CreatedAt: now},
		{ID: "field_status", Name: "Status", Kind: widgetFieldStatus, MaxLength: widgetStatusMaxLen, CreatedAt: now},
		{ID: "field_sound", Name: "Sound", Kind: widgetFieldSound, CreatedAt: now},
	}
}

// keyWidgetSoundSeeded marks that the sound default has been offered to a
// catalog stored before the kind existed — once, so a producer who removes
// it is not fighting a reseed.
const keyWidgetSoundSeeded = "widget_field_sound_seeded"

// topUpWidgetFieldTypes appends later-added defaults to a catalog stored
// before they existed. Each new default is offered exactly once.
func (a *App) topUpWidgetFieldTypes(types []WidgetFieldType) []WidgetFieldType {
	if done, _ := a.store.getSetting(keyWidgetSoundSeeded); done != "" {
		return types
	}
	present := false
	for _, ft := range types {
		if ft.ID == "field_sound" {
			present = true
			break
		}
	}
	if !present {
		now := time.Now().UTC().Format(time.RFC3339)
		types = append(types, WidgetFieldType{
			ID: "field_sound", Name: "Sound", Kind: widgetFieldSound, CreatedAt: now,
		})
		if err := a.store.setJSON(keyWidgetFieldTypes, types); err != nil {
			log.Printf("jax: top up widget field types: %v", err)
		}
	}
	if err := a.store.setSetting(keyWidgetSoundSeeded, "1"); err != nil {
		log.Printf("jax: mark sound default seeded: %v", err)
	}
	return types
}

// getWidgetFieldTypes reads the stored catalog, seeding the defaults the
// first time it is ever read. A catalog the producer has emptied on purpose
// stays empty. Never nil.
func (a *App) getWidgetFieldTypes() []WidgetFieldType {
	if a.store == nil {
		return []WidgetFieldType{}
	}
	var types []WidgetFieldType
	ok, err := a.store.getJSON(keyWidgetFieldTypes, &types)
	if err != nil {
		log.Printf("jax: getWidgetFieldTypes: %v", err)
		return []WidgetFieldType{}
	}
	if !ok {
		types = defaultWidgetFieldTypes()
		if err := a.store.setJSON(keyWidgetFieldTypes, types); err != nil {
			log.Printf("jax: seed widget field types: %v", err)
		}
		if err := a.store.setSetting(keyWidgetSoundSeeded, "1"); err != nil {
			log.Printf("jax: mark sound default seeded: %v", err)
		}
		return types
	}
	if types == nil {
		types = []WidgetFieldType{}
	}
	return a.topUpWidgetFieldTypes(types)
}

// GetWidgetFieldTypes returns the field types available to stream widgets,
// seeding the defaults on first read. Never nil.
func (a *App) GetWidgetFieldTypes() []WidgetFieldType {
	return a.getWidgetFieldTypes()
}

// normalizeWidgetFieldType validates the kind and applies the kind's cap
// defaults.
func normalizeWidgetFieldType(ft WidgetFieldType) (WidgetFieldType, error) {
	switch ft.Kind {
	case widgetFieldImage, widgetFieldSound:
		ft.MaxLength = 0
	case widgetFieldMessage:
		if ft.MaxLength <= 0 {
			ft.MaxLength = widgetMessageMaxLen
		}
	case widgetFieldStatus:
		if ft.MaxLength <= 0 {
			ft.MaxLength = widgetStatusMaxLen
		}
	default:
		return ft, fmt.Errorf("unknown field kind %q", ft.Kind)
	}
	return ft, nil
}

// SaveWidgetFieldType upserts a field type (matched by ID), assigning an ID
// and creation time on first save, and returns the stored value. A name and
// a valid kind are required.
func (a *App) SaveWidgetFieldType(ft WidgetFieldType) (WidgetFieldType, error) {
	if a.store == nil {
		return ft, fmt.Errorf("storage unavailable")
	}
	ft.Name = strings.TrimSpace(ft.Name)
	if ft.Name == "" {
		return ft, fmt.Errorf("a field type name is required")
	}
	ft, err := normalizeWidgetFieldType(ft)
	if err != nil {
		return ft, err
	}

	all := a.getWidgetFieldTypes()
	if ft.ID == "" {
		ft.ID = fmt.Sprintf("field_%d", time.Now().UnixNano())
	}
	if ft.CreatedAt == "" {
		ft.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, existing := range all {
		if existing.ID == ft.ID {
			all[i] = ft
			replaced = true
			break
		}
	}
	if !replaced {
		all = append(all, ft)
	}

	if err := a.store.setJSON(keyWidgetFieldTypes, all); err != nil {
		return ft, err
	}
	return ft, nil
}

// DeleteWidgetFieldType removes a field type (its dynamic skill goes with
// it). Defaults are not reseeded once the catalog has been touched.
func (a *App) DeleteWidgetFieldType(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.getWidgetFieldTypes()
	out := make([]WidgetFieldType, 0, len(all))
	for _, ft := range all {
		if ft.ID != id {
			out = append(out, ft)
		}
	}
	return a.store.setJSON(keyWidgetFieldTypes, out)
}

// --- Dynamic skills ----------------------------------------------------------

// widgetFieldSkillPrefix namespaces the dynamic skills field types publish.
const widgetFieldSkillPrefix = "widget-field-"

// widgetFieldSkillID is the dynamic skill id for a field type.
func widgetFieldSkillID(ft WidgetFieldType) string {
	return widgetFieldSkillPrefix + ft.ID
}

// widgetFieldBySkillID resolves a dynamic skill id back to its field type.
func (a *App) widgetFieldBySkillID(id string) (WidgetFieldType, bool) {
	raw, ok := strings.CutPrefix(id, widgetFieldSkillPrefix)
	if !ok {
		return WidgetFieldType{}, false
	}
	for _, ft := range a.getWidgetFieldTypes() {
		if ft.ID == raw {
			return ft, true
		}
	}
	return WidgetFieldType{}, false
}

// widgetFieldSkillContent is a field type's default skill content: the brief
// behind producing that field's value on a stream widget.
func widgetFieldSkillContent(ft WidgetFieldType) string {
	var b strings.Builder
	fmt.Fprintf(&b, "This is the brief for the %q stream-widget field. ", ft.Name)
	b.WriteString("When this field's content is generated for a widget, this document rides along — edit it to change what every generation produces.\n\n")
	switch ft.Kind {
	case widgetFieldImage:
		b.WriteString(`## What to produce

An image or animation (JPEG, GIF, or WebP) shown on stream as part of a widget.

## Guidelines

- Design for on-stream legibility: bold shapes, high contrast, readable at overlay size.
- Match the brand's identity — its assets and palette ride along when available, and they win over generic style choices.
- Keep the composition self-contained; the image sits inside a widget, not full-screen.
- No platform logos, no watermark text, no fine print.
`)
	case widgetFieldMessage:
		fmt.Fprintf(&b, `## What to produce

A markdown message shown on stream as part of a widget — at most %d characters.

## Guidelines

- Write for the audience watching live: present tense, direct, energetic but honest.
- Markdown stays simple — emphasis and a link at most; no headings, lists, or tables in a widget-sized space.
- Stay within the character cap; a truncated message on stream is worse than a short one.
`, ft.MaxLength)
	case widgetFieldStatus:
		fmt.Fprintf(&b, `## What to produce

A short plain-text status line shown on stream as part of a widget — at most %d characters.

## Guidelines

- One line, no markup, no emoji spam — a status reads at a glance.
- Present tense and concrete ("Building the parser", not "Working on stuff").
- Stay within the character cap.
`, ft.MaxLength)
	case widgetFieldSound:
		b.WriteString(`## What this field holds

An uploaded audio file (MP3, WAV, OGG, …) the widget plays when called upon — an alert, a sting, a jingle.

## Guidelines

- Keep alerts short: a sound that outstays its moment talks over the stream.
- Normalize loudness against stream audio — an alert should cut through without clipping or startling.
- Pick sounds that stay pleasant on the fiftieth play of the night.
`)
	}
	return b.String()
}

// widgetFieldSkillDescription is the catalog line for a field type's skill.
func widgetFieldSkillDescription(ft WidgetFieldType) string {
	switch ft.Kind {
	case widgetFieldImage:
		return fmt.Sprintf("The brief behind generating the %q widget field's image/animation.", ft.Name)
	case widgetFieldMessage:
		return fmt.Sprintf("The writing guide behind the %q widget field (markdown, max %d characters).", ft.Name, ft.MaxLength)
	case widgetFieldSound:
		return fmt.Sprintf("The brief behind the %q widget field's alert sound.", ft.Name)
	default:
		return fmt.Sprintf("The writing guide behind the %q widget field (text, max %d characters).", ft.Name, ft.MaxLength)
	}
}

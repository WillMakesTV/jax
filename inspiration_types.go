package main

import (
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Inspiration types
//
// A type is what a source channel is being studied FOR: process advice, the
// way its videos are cut, the way it packages a topic. Tagging a channel with
// one steers what the takeaway pass looks for in its videos — the type's
// brief rides along with the extraction instructions.
//
// Each type publishes its brief as an Application Skill (see skills.go), so
// it edits, overrides, and resets like every other skill and is readable over
// MCP; the type's own page is the same document with a markdown editor around
// it.
// ---------------------------------------------------------------------------

// keyInspirationTypes holds the stored types.
const keyInspirationTypes = "inspiration_types"

// inspirationTypeSkillPrefix namespaces the dynamic skill each type publishes.
const inspirationTypeSkillPrefix = "inspiration-type-"

// InspirationType is one lens the library studies a channel through.
type InspirationType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Summary is the one-liner shown on the type's card.
	Summary string `json:"summary"`
	// Brief is the markdown that steers extraction for tagged channels.
	Brief     string `json:"brief"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// defaultInspirationTypes seed the library the first time it is read: the two
// lenses the producer asked for, as a worked example of the shape.
func defaultInspirationTypes() []InspirationType {
	now := time.Now().UTC().Format(time.RFC3339)
	return []InspirationType{
		{
			ID:      "tips",
			Name:    "Tips",
			Summary: "Process and craft advice worth stealing.",
			Brief: `Study this channel for **how the work gets done**.

Look for:
- Concrete process: the steps, the order, the setup, the shortcut.
- Rules of thumb the creator states outright, and the ones their behaviour implies.
- Tools and settings named in service of a result, and what the result was.
- Mistakes called out, and what to do instead.

Skip:
- Personality, banter, and anything that is only entertaining.
- Gear lists with no reason attached.

A takeaway here should read like an instruction the producer could follow tomorrow.`,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:      "editing-style",
			Name:    "Editing Style",
			Summary: "How the video is cut, graded, paced, and packaged.",
			Brief: `Study this channel for **how the video is made**, not what it says.

Look for:
- Cutting: pacing, cut length, when it holds and when it jumps, how B-roll enters.
- Sound: music choice and level, sound design, silence, how voice sits in the mix.
- Look: colour and grade, lighting, lens and framing, camera movement.
- Graphics: titles, captions, motion, the visual grammar it repeats.
- Structure and packaging: cold open, hook, chapters, how it signs off.

Skip:
- The subject matter itself, except where it explains a production choice.

A takeaway here should describe a production decision precisely enough to reproduce it.`,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
}

// getInspirationTypes reads the stored types, seeding the defaults the first
// time. Never returns nil.
func (a *App) getInspirationTypes() []InspirationType {
	types := []InspirationType{}
	if a.store == nil {
		return defaultInspirationTypes()
	}
	found, err := a.store.getJSON(keyInspirationTypes, &types)
	if err != nil {
		log.Printf("jax: inspiration types: %v", err)
	}
	if !found {
		types = defaultInspirationTypes()
		if err := a.store.setJSON(keyInspirationTypes, types); err != nil {
			log.Printf("jax: seed inspiration types: %v", err)
		}
	}
	if types == nil {
		types = []InspirationType{}
	}
	return types
}

// GetInspirationTypes returns the types, newest first.
func (a *App) GetInspirationTypes() []InspirationType {
	types := a.getInspirationTypes()
	sort.SliceStable(types, func(i, j int) bool {
		return types[i].CreatedAt > types[j].CreatedAt
	})
	return types
}

// GetInspirationType returns one type by id.
func (a *App) GetInspirationType(id string) (InspirationType, error) {
	for _, t := range a.getInspirationTypes() {
		if t.ID == id {
			return t, nil
		}
	}
	return InspirationType{}, fmt.Errorf("that inspiration type no longer exists")
}

// SaveInspirationType creates or updates a type and returns it stored.
func (a *App) SaveInspirationType(t InspirationType) (InspirationType, error) {
	if a.store == nil {
		return InspirationType{}, fmt.Errorf("storage unavailable")
	}
	t.Name = strings.TrimSpace(t.Name)
	if t.Name == "" {
		return InspirationType{}, fmt.Errorf("give the type a name first")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	types := a.getInspirationTypes()
	for i := range types {
		if types[i].ID != t.ID || t.ID == "" {
			continue
		}
		t.CreatedAt = types[i].CreatedAt
		t.UpdatedAt = now
		types[i] = t
		if err := a.store.setJSON(keyInspirationTypes, types); err != nil {
			return InspirationType{}, err
		}
		return t, nil
	}
	if t.ID == "" {
		t.ID = inspirationTypeID(t.Name, types)
	}
	t.CreatedAt = now
	t.UpdatedAt = now
	types = append(types, t)
	if err := a.store.setJSON(keyInspirationTypes, types); err != nil {
		return InspirationType{}, err
	}
	return t, nil
}

// DeleteInspirationType removes a type and untags every channel using it.
func (a *App) DeleteInspirationType(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	types := a.getInspirationTypes()
	out := make([]InspirationType, 0, len(types))
	for _, t := range types {
		if t.ID != id {
			out = append(out, t)
		}
	}
	if err := a.store.setJSON(keyInspirationTypes, out); err != nil {
		return err
	}

	lib := a.getInspiration()
	changed := false
	for i := range lib.Channels {
		kept := make([]string, 0, len(lib.Channels[i].TypeIDs))
		for _, tid := range lib.Channels[i].TypeIDs {
			if tid != id {
				kept = append(kept, tid)
			}
		}
		if len(kept) != len(lib.Channels[i].TypeIDs) {
			lib.Channels[i].TypeIDs = kept
			changed = true
		}
	}
	if changed {
		if err := a.saveInspiration(lib); err != nil {
			return err
		}
	}
	return nil
}

// SetInspirationChannelTypes tags a channel with the types it is studied for.
func (a *App) SetInspirationChannelTypes(channelID string, typeIDs []string) (InspirationChannel, error) {
	if typeIDs == nil {
		typeIDs = []string{}
	}
	lib := a.getInspiration()
	for i := range lib.Channels {
		if lib.Channels[i].ID != channelID {
			continue
		}
		lib.Channels[i].TypeIDs = typeIDs
		if err := a.saveInspiration(lib); err != nil {
			return InspirationChannel{}, err
		}
		out := lib.Channels[i]
		fillInspirationChannel(&out)
		return out, nil
	}
	return InspirationChannel{}, fmt.Errorf("that channel is no longer indexed")
}

// inspirationTypeID slugs a name into an id that is not already taken.
func inspirationTypeID(name string, existing []InspirationType) string {
	slug := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		case r >= 'A' && r <= 'Z':
			return r + 32
		case r == ' ' || r == '-' || r == '_':
			return '-'
		}
		return -1
	}, strings.TrimSpace(name))
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "type"
	}
	taken := map[string]bool{}
	for _, t := range existing {
		taken[t.ID] = true
	}
	if !taken[slug] {
		return slug
	}
	for n := 2; ; n++ {
		candidate := slug + "-" + strconv.Itoa(n)
		if !taken[candidate] {
			return candidate
		}
	}
}

// --- Per-type dynamic skills -------------------------------------------------

// inspirationTypeSkillID is the dynamic skill id for a type.
func inspirationTypeSkillID(t InspirationType) string {
	return inspirationTypeSkillPrefix + t.ID
}

// inspirationTypeBySkillID resolves a dynamic skill id back to its type.
func (a *App) inspirationTypeBySkillID(id string) (InspirationType, bool) {
	raw, ok := strings.CutPrefix(id, inspirationTypeSkillPrefix)
	if !ok {
		return InspirationType{}, false
	}
	for _, t := range a.getInspirationTypes() {
		if t.ID == raw {
			return t, true
		}
	}
	return InspirationType{}, false
}

// inspirationTypeSkillContent is a type's brief as its skill reads.
func inspirationTypeSkillContent(t InspirationType) string {
	var b strings.Builder
	fmt.Fprintf(&b, "This is the %q lens the Inspiration library studies a channel through.", t.Name)
	if t.Summary != "" {
		fmt.Fprintf(&b, " %s", t.Summary)
	}
	b.WriteString(" A channel tagged with this type has this brief added to its videos' takeaway extraction — it is the same document the type's own page edits.\n\n")
	b.WriteString(t.Brief)
	return b.String()
}

// inspirationTypeSkillDescription is the catalog line for a type's skill.
func inspirationTypeSkillDescription(t InspirationType) string {
	if t.Summary != "" {
		return t.Summary
	}
	return fmt.Sprintf("What the library looks for in a channel studied as %q.", t.Name)
}

// inspirationTypeBriefs returns the briefs of the types a channel is tagged
// with, in the order the types were defined.
func (a *App) inspirationTypeBriefs(channelID string) []InspirationType {
	if channelID == "" {
		return nil
	}
	var tagged []string
	for _, c := range a.getInspiration().Channels {
		if c.ID == channelID {
			tagged = c.TypeIDs
			break
		}
	}
	if len(tagged) == 0 {
		return nil
	}
	want := map[string]bool{}
	for _, id := range tagged {
		want[id] = true
	}
	out := []InspirationType{}
	for _, t := range a.getInspirationTypes() {
		if want[t.ID] {
			out = append(out, t)
		}
	}
	return out
}

// inspirationTypeBriefInstructions briefs the model that drafts a new type's
// document from a name and whatever notes the producer typed.
const inspirationTypeBriefInstructions = `You are writing the brief for one "inspiration type" in a creator's reference library.

A type is a lens: it tells the library what to look for when it studies a channel tagged with it, and what to ignore. The brief is sent to the model that mines a studied video for takeaways, so it has to be specific about what counts.

Respond with markdown and nothing else — no preamble, no code fences. Follow this shape:

Study this channel for **<what this lens is after>**.

Look for:
- <four to six concrete things, each one a category of observation>

Skip:
- <one to three things this lens deliberately ignores>

<One closing line describing what a takeaway under this lens should read like.>

Keep it under 200 words. Write in the second person, plainly, with no marketing tone.`

// GenerateInspirationTypeBrief drafts a type's brief with the connected AI.
func (a *App) GenerateInspirationTypeBrief(name, notes string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("name the type first — the brief is written around it")
	}
	var in strings.Builder
	fmt.Fprintf(&in, "# Type\nName: %s\n", name)
	if strings.TrimSpace(notes) != "" {
		fmt.Fprintf(&in, "\n## What the producer said it is for\n%s\n", notes)
	}
	in.WriteString("\n## Types already defined\n")
	for _, t := range a.getInspirationTypes() {
		fmt.Fprintf(&in, "- %s: %s\n", t.Name, t.Summary)
	}
	return a.askAIText(inspirationTypeBriefInstructions, in.String())
}

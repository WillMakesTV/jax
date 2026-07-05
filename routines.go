package main

import (
	"fmt"
	"log"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Routines
//
// A Routine is a sequence of broadcast actions the app can run — switching
// scenes, waiting, muting inputs, starting/stopping the stream. Two built-in
// routines ("Start Stream" / "End Stream") are tied to the app's go-live and
// stop-stream buttons; additional routines can be added and run manually from
// the OBS Studio → Routines tab.
//
// A routine is managed either by Jax (its steps are defined in the app) or by
// a Stream Deck Multi Action (the steps are read from the Stream Deck's own
// profile files and replayed by Jax — see streamdeck.go). Stored as a single
// JSON blob in the settings table.
// ---------------------------------------------------------------------------

// The retired "manage with Streamdeck" mode, recognised by migrateRoutine.
const routineManagerStreamdeck = "streamdeck"

// Reserved IDs (and triggers) of the two built-in routines.
const (
	routineStartStream = "start-stream"
	routineEndStream   = "end-stream"
)

// RoutineStep is one normalized action in a routine. Kind decides which of
// the other fields apply. The same shape is used for steps authored in Jax
// and steps parsed out of a Stream Deck Multi Action.
type RoutineStep struct {
	// Kind: "obs-scene" | "obs-source" | "obs-mute" | "obs-stream" |
	// "obs-record" | "delay" | "streamdeck" | "unsupported".
	Kind string `json:"kind"`
	// Scene name (obs-scene: the scene to switch to; obs-source: the scene
	// holding the item).
	Scene string `json:"scene,omitempty"`
	// Target of a scene switch: "program" (default) or "preview".
	Target string `json:"target,omitempty"`
	// Source name (obs-source: the scene item; obs-mute: the input).
	Source string `json:"source,omitempty"`
	// SceneItemID of an obs-source step ("0" = resolve by Source name).
	SceneItemID int `json:"sceneItemId,omitempty"`
	// Mode: obs-mute "toggle"|"mute"|"unmute"; obs-stream/obs-record
	// "toggle"|"start"|"stop".
	Mode string `json:"mode,omitempty"`
	// DelayMs of a delay step.
	DelayMs int `json:"delayMs,omitempty"`
	// StreamdeckActionID references a Stream Deck Multi Action whose steps
	// are replayed in place of this step at run time (kind "streamdeck");
	// Description carries its title for display when the deck is unavailable.
	StreamdeckActionID string `json:"streamdeckActionId,omitempty"`
	// Description of an unsupported step (e.g. "Philips Hue: Color") — these
	// steps still run on the Stream Deck itself but are skipped when Jax
	// replays the routine — or a streamdeck step's Multi Action title.
	Description string `json:"description,omitempty"`
}

// Routine is one runnable routine.
type Routine struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Trigger ties the routine to an app action: "start-stream" and
	// "end-stream" run with the corresponding stream buttons; "" is manual.
	Trigger string `json:"trigger"`
	// BuiltIn routines are pinned: they always exist and cannot be deleted.
	BuiltIn bool `json:"builtIn"`
	// Deprecated: routines used to be managed either "with Jax" (authored
	// steps) or "with Streamdeck" (bound to Multi Actions). A Multi Action is
	// now just a step kind; these fields only remain so previously stored
	// routines decode, and normalizeRoutines migrates them into Steps.
	Manager                 string `json:"manager,omitempty"`
	StreamdeckActionID      string `json:"streamdeckActionId,omitempty"`
	StreamdeckTitle         string `json:"streamdeckTitle,omitempty"`
	StreamdeckAfterActionID string `json:"streamdeckAfterActionId,omitempty"`
	StreamdeckAfterTitle    string `json:"streamdeckAfterTitle,omitempty"`
	// The built-in routines run in two phases around their stream transition:
	// Steps runs before it, AfterSteps once it has happened. Custom routines
	// have no transition and only use Steps.
	Steps      []RoutineStep `json:"steps"`
	AfterSteps []RoutineStep `json:"afterSteps"`
	CreatedAt  string        `json:"createdAt"`
}

// builtinRoutines returns the two pinned routines in display order.
func builtinRoutines() []Routine {
	return []Routine{
		{
			ID:         routineStartStream,
			Name:       "Start Stream",
			Trigger:    routineStartStream,
			BuiltIn:    true,
			Steps:      []RoutineStep{},
			AfterSteps: []RoutineStep{},
		},
		{
			ID:         routineEndStream,
			Name:       "End Stream",
			Trigger:    routineEndStream,
			BuiltIn:    true,
			Steps:      []RoutineStep{},
			AfterSteps: []RoutineStep{},
		},
	}
}

// normalizeRoutines overlays the stored routines on the built-in set, so the
// two pinned routines always exist (keeping any stored configuration) and
// custom routines follow in their stored order. Routines stored in the
// retired two-manager shape are migrated on the way out.
func normalizeRoutines(stored []Routine) []Routine {
	out := builtinRoutines()
	custom := []Routine{}
	for _, r := range stored {
		r = migrateRoutine(r)
		switch r.ID {
		case routineStartStream:
			r.BuiltIn, r.Trigger = true, routineStartStream
			out[0] = r
		case routineEndStream:
			r.BuiltIn, r.Trigger = true, routineEndStream
			out[1] = r
		default:
			r.BuiltIn = false
			custom = append(custom, r)
		}
	}
	return append(out, custom...)
}

// migrateRoutine converts the retired two-manager shape into the unified step
// list: a routine that was "managed with Streamdeck" becomes one whose phases
// each hold a single streamdeck step referencing its Multi Action. Authored
// steps stored while that manager was active never ran, so they are dropped
// to preserve behaviour.
func migrateRoutine(r Routine) Routine {
	if r.Manager == routineManagerStreamdeck {
		r.Steps = []RoutineStep{}
		r.AfterSteps = []RoutineStep{}
		if r.StreamdeckActionID != "" {
			r.Steps = append(r.Steps, RoutineStep{
				Kind:               "streamdeck",
				StreamdeckActionID: r.StreamdeckActionID,
				Description:        r.StreamdeckTitle,
			})
		}
		if r.StreamdeckAfterActionID != "" {
			r.AfterSteps = append(r.AfterSteps, RoutineStep{
				Kind:               "streamdeck",
				StreamdeckActionID: r.StreamdeckAfterActionID,
				Description:        r.StreamdeckAfterTitle,
			})
		}
	}
	r.Manager = ""
	r.StreamdeckActionID, r.StreamdeckTitle = "", ""
	r.StreamdeckAfterActionID, r.StreamdeckAfterTitle = "", ""
	return r
}

// GetRoutines returns every routine, the two built-ins first. Never nil.
func (a *App) GetRoutines() []Routine {
	if a.store == nil {
		return builtinRoutines()
	}
	var stored []Routine
	if _, err := a.store.getJSON(keyRoutines, &stored); err != nil {
		log.Printf("jax: GetRoutines: %v", err)
	}
	return normalizeRoutines(stored)
}

// SaveRoutine upserts a routine (matched by ID), assigning an ID and creation
// time on first save, and returns the stored value.
func (a *App) SaveRoutine(routine Routine) (Routine, error) {
	if a.store == nil {
		return routine, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(routine.Name) == "" {
		return routine, fmt.Errorf("give the routine a name")
	}
	routine = migrateRoutine(routine)
	if routine.Steps == nil {
		routine.Steps = []RoutineStep{}
	}
	if routine.AfterSteps == nil {
		routine.AfterSteps = []RoutineStep{}
	}
	for _, s := range append(append([]RoutineStep{}, routine.Steps...), routine.AfterSteps...) {
		if s.Kind == "streamdeck" && s.StreamdeckActionID == "" {
			return routine, fmt.Errorf("choose a Multi Action for each Stream Deck step")
		}
	}

	all := a.GetRoutines()
	if routine.ID == "" {
		routine.ID = fmt.Sprintf("routine_%d", time.Now().UnixNano())
	}
	if routine.CreatedAt == "" {
		routine.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, r := range all {
		if r.ID == routine.ID {
			// The pinned identity of a built-in survives whatever the form sent.
			routine.BuiltIn, routine.Trigger = r.BuiltIn, r.Trigger
			all[i] = routine
			replaced = true
			break
		}
	}
	if !replaced {
		all = append(all, routine)
	}

	if err := a.store.setJSON(keyRoutines, all); err != nil {
		return routine, err
	}
	return routine, nil
}

// DeleteRoutine removes a custom routine by ID; the built-ins are pinned.
func (a *App) DeleteRoutine(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	if id == routineStartStream || id == routineEndStream {
		return fmt.Errorf("the built-in stream routines cannot be deleted")
	}
	all := a.GetRoutines()
	out := make([]Routine, 0, len(all))
	for _, r := range all {
		if r.ID != id {
			out = append(out, r)
		}
	}
	return a.store.setJSON(keyRoutines, out)
}

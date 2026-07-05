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

// Routine managers.
const (
	routineManagerJax        = "jax"
	routineManagerStreamdeck = "streamdeck"
)

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
	// "obs-record" | "delay" | "unsupported".
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
	// Description of an unsupported step (e.g. "Philips Hue: Color"). These
	// steps still run on the Stream Deck itself but are skipped when Jax
	// replays the routine.
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
	// Manager: "jax" (Steps are authored in the app) or "streamdeck" (steps
	// come from the referenced Stream Deck Multi Action at run time).
	Manager string `json:"manager"`
	// The referenced Multi Actions (manager == "streamdeck"): stable ActionIDs
	// plus the titles shown when the Stream Deck is unavailable. The built-in
	// routines run in two phases around their stream transition — the "after"
	// pair is the phase that runs once the stream has started/stopped. Custom
	// routines have no transition, so they only use the first pair.
	StreamdeckActionID      string `json:"streamdeckActionId"`
	StreamdeckTitle         string `json:"streamdeckTitle"`
	StreamdeckAfterActionID string `json:"streamdeckAfterActionId"`
	StreamdeckAfterTitle    string `json:"streamdeckAfterTitle"`
	// Steps authored in Jax (manager == "jax"), split the same way: Steps runs
	// before the stream transition, AfterSteps once it has happened.
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
			Manager:    routineManagerJax,
			Steps:      []RoutineStep{},
			AfterSteps: []RoutineStep{},
		},
		{
			ID:         routineEndStream,
			Name:       "End Stream",
			Trigger:    routineEndStream,
			BuiltIn:    true,
			Manager:    routineManagerJax,
			Steps:      []RoutineStep{},
			AfterSteps: []RoutineStep{},
		},
	}
}

// normalizeRoutines overlays the stored routines on the built-in set, so the
// two pinned routines always exist (keeping any stored configuration) and
// custom routines follow in their stored order.
func normalizeRoutines(stored []Routine) []Routine {
	out := builtinRoutines()
	custom := []Routine{}
	for _, r := range stored {
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
	if routine.Manager != routineManagerJax && routine.Manager != routineManagerStreamdeck {
		return routine, fmt.Errorf("unknown routine manager %q", routine.Manager)
	}
	if routine.Manager == routineManagerStreamdeck &&
		routine.StreamdeckActionID == "" && routine.StreamdeckAfterActionID == "" {
		return routine, fmt.Errorf("choose a Stream Deck Multi Action for this routine")
	}
	if routine.Steps == nil {
		routine.Steps = []RoutineStep{}
	}
	if routine.AfterSteps == nil {
		routine.AfterSteps = []RoutineStep{}
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

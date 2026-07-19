package main

import (
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Stream widgets
//
// A stream widget is an on-stream element the producer defines and manages
// from the OBS section's Stream Widgets tab. The model starts minimal — a
// required name — and grows properties as the feature does. Widgets are
// stored as a single JSON blob in the settings table, like routines.
// ---------------------------------------------------------------------------

// WidgetField is one field on a stream widget: an instance of a field type
// (see widget_fields.go) with its own label and value.
type WidgetField struct {
	ID string `json:"id"`
	// TypeID references the WidgetFieldType this field instantiates.
	TypeID string `json:"typeId"`
	// Label names the field on the widget; defaults to the type's name.
	Label string `json:"label"`
	// Value is the field's content: text for the message/status kinds, or
	// the image file's bare name (in ~/.jax/widgets/<widgetID>) for image
	// kinds. ValueURL is the image's served address, derived on read.
	Value    string `json:"value"`
	ValueURL string `json:"valueUrl"`
}

// StreamWidget is one stream widget.
type StreamWidget struct {
	ID     string        `json:"id"`
	Name   string        `json:"name"`
	Fields []WidgetField `json:"fields"`
	// Template is the widget's JSX display template ("" = no custom
	// display). It receives `widget` (the widget itself) and `fields` (a
	// label → value map of the widget's fields); authored on the widget's
	// details page, stored verbatim.
	Template  string `json:"template"`
	CreatedAt string `json:"createdAt"` // RFC3339
}

// fillWidgetURLs stamps each file-backed field's served URL (derived per
// read, never persisted). Fields whose type is not a file kind (image or
// sound) carry none.
func (a *App) fillWidgetURLs(w *StreamWidget) {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()

	fileTypes := map[string]bool{}
	for _, ft := range a.getWidgetFieldTypes() {
		if ft.Kind == widgetFieldImage || ft.Kind == widgetFieldSound {
			fileTypes[ft.ID] = true
		}
	}
	for i := range w.Fields {
		w.Fields[i].ValueURL = ""
		if base == "" || w.Fields[i].Value == "" || !fileTypes[w.Fields[i].TypeID] {
			continue
		}
		w.Fields[i].ValueURL = base + widgetFilesPrefix +
			url.PathEscape(w.ID) + "/" + url.PathEscape(w.Fields[i].Value)
	}
}

// getStreamWidgets reads the raw stored widget list. Never nil.
func (a *App) getStreamWidgets() []StreamWidget {
	if a.store == nil {
		return []StreamWidget{}
	}
	var widgets []StreamWidget
	if _, err := a.store.getJSON(keyStreamWidgets, &widgets); err != nil {
		log.Printf("jax: getStreamWidgets: %v", err)
	}
	if widgets == nil {
		return []StreamWidget{}
	}
	for i := range widgets {
		if widgets[i].Fields == nil {
			widgets[i].Fields = []WidgetField{}
		}
	}
	return widgets
}

// GetStreamWidgets returns the saved stream widgets, newest first. Never nil.
func (a *App) GetStreamWidgets() []StreamWidget {
	widgets := a.getStreamWidgets()
	for i := range widgets {
		a.fillWidgetURLs(&widgets[i])
	}
	return widgets
}

// validateWidgetFields checks each field's value against its type's cap and
// normalises labels. Fields whose type no longer exists keep working — the
// value just goes uncapped.
func (a *App) validateWidgetFields(fields []WidgetField) ([]WidgetField, error) {
	if fields == nil {
		return []WidgetField{}, nil
	}
	types := map[string]WidgetFieldType{}
	for _, ft := range a.getWidgetFieldTypes() {
		types[ft.ID] = ft
	}
	for i := range fields {
		fields[i].Label = strings.TrimSpace(fields[i].Label)
		// Derived on read, never stored; a round-tripped value is dropped.
		fields[i].ValueURL = ""
		ft, ok := types[fields[i].TypeID]
		if !ok {
			continue
		}
		if fields[i].Label == "" {
			fields[i].Label = ft.Name
		}
		if ft.MaxLength > 0 && len([]rune(fields[i].Value)) > ft.MaxLength {
			return nil, fmt.Errorf("%s is over the %d-character limit",
				fields[i].Label, ft.MaxLength)
		}
	}
	return fields, nil
}

// SaveStreamWidget upserts a stream widget (matched by ID), assigning an ID
// and creation time on first save, and returns the stored value. A name is
// required; field values are checked against their type's caps.
func (a *App) SaveStreamWidget(w StreamWidget) (StreamWidget, error) {
	if a.store == nil {
		return w, fmt.Errorf("storage unavailable")
	}
	w.Name = strings.TrimSpace(w.Name)
	if w.Name == "" {
		return w, fmt.Errorf("a widget name is required")
	}
	fields, err := a.validateWidgetFields(w.Fields)
	if err != nil {
		return w, err
	}
	w.Fields = fields

	all := a.getStreamWidgets()
	if w.ID == "" {
		w.ID = fmt.Sprintf("widget_%d", time.Now().UnixNano())
	}
	if w.CreatedAt == "" {
		w.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	replaced := false
	for i, existing := range all {
		if existing.ID == w.ID {
			all[i] = w
			replaced = true
			break
		}
	}
	if !replaced {
		all = append([]StreamWidget{w}, all...)
	}

	if err := a.store.setJSON(keyStreamWidgets, all); err != nil {
		return w, err
	}
	a.fillWidgetURLs(&w)
	return w, nil
}

// mutateStreamWidget loads the stored widgets, applies fn to the one
// matching id, and persists the set.
func (a *App) mutateStreamWidget(id string, fn func(w *StreamWidget) error) (StreamWidget, error) {
	if a.store == nil {
		return StreamWidget{}, fmt.Errorf("storage unavailable")
	}
	all := a.getStreamWidgets()
	for i := range all {
		if all[i].ID != id {
			continue
		}
		if err := fn(&all[i]); err != nil {
			return StreamWidget{}, err
		}
		if err := a.store.setJSON(keyStreamWidgets, all); err != nil {
			return StreamWidget{}, err
		}
		out := all[i]
		a.fillWidgetURLs(&out)
		return out, nil
	}
	return StreamWidget{}, fmt.Errorf("that stream widget no longer exists")
}

// AddWidgetField attaches a new field of the given type to a widget and
// returns the updated widget. label names the field; blank falls back to the
// type's name, so one widget can carry several fields of the same type told
// apart by their labels.
func (a *App) AddWidgetField(widgetID, typeID, label string) (StreamWidget, error) {
	var fieldType *WidgetFieldType
	for _, ft := range a.getWidgetFieldTypes() {
		if ft.ID == typeID {
			t := ft
			fieldType = &t
			break
		}
	}
	if fieldType == nil {
		return StreamWidget{}, fmt.Errorf("that field type no longer exists")
	}
	label = strings.TrimSpace(label)
	if label == "" {
		label = fieldType.Name
	}
	return a.mutateStreamWidget(widgetID, func(w *StreamWidget) error {
		w.Fields = append(w.Fields, WidgetField{
			ID:     fmt.Sprintf("wf_%d", time.Now().UnixNano()),
			TypeID: typeID,
			Label:  label,
		})
		return nil
	})
}

// RemoveWidgetField detaches a field from a widget and returns the updated
// widget.
func (a *App) RemoveWidgetField(widgetID, fieldID string) (StreamWidget, error) {
	return a.mutateStreamWidget(widgetID, func(w *StreamWidget) error {
		out := w.Fields[:0]
		for _, f := range w.Fields {
			if f.ID != fieldID {
				out = append(out, f)
			}
		}
		w.Fields = out
		return nil
	})
}

// DeleteStreamWidget removes a stream widget.
func (a *App) DeleteStreamWidget(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.getStreamWidgets()
	out := make([]StreamWidget, 0, len(all))
	for _, w := range all {
		if w.ID != id {
			out = append(out, w)
		}
	}
	return a.store.setJSON(keyStreamWidgets, out)
}

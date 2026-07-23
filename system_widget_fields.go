package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// System widget assets
//
// A system widget can carry its own image and sound assets, the same way a
// producer's widget carries fields (widgets.go). Each asset is a named
// instance of an image or sound field type; several of one kind are allowed,
// told apart by their names. The files live in the widget's own folder under
// ~/.jax/widgets/<id> and are served like any widget file, so a template
// widget's display reads them through fields['Name'] / playSound('Name') and a
// page widget's injected CSS/JS reads them through the assets block below.
// ---------------------------------------------------------------------------

// keySystemWidgetFields stores the producer's asset fields per system widget.
const keySystemWidgetFields = "system_widget_fields"

// storedSystemWidgetFields reads the id→fields map. Never nil.
func (a *App) storedSystemWidgetFields() map[string][]WidgetField {
	m := map[string][]WidgetField{}
	if a.store != nil {
		if _, err := a.store.getJSON(keySystemWidgetFields, &m); err != nil {
			log.Printf("jax: system widget fields: %v", err)
		}
	}
	if m == nil {
		return map[string][]WidgetField{}
	}
	return m
}

// systemWidgetFieldURLs stamps each file-backed asset's served URL, derived
// per read from the widget's own folder (never persisted).
func (a *App) systemWidgetFieldURLs(id string, fields []WidgetField) {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()
	fileTypes := map[string]bool{}
	for _, ft := range a.getWidgetFieldTypes() {
		if ft.Kind == widgetFieldImage || ft.Kind == widgetFieldSound {
			fileTypes[ft.ID] = true
		}
	}
	for i := range fields {
		fields[i].ValueURL = ""
		if base == "" || fields[i].Value == "" || !fileTypes[fields[i].TypeID] {
			continue
		}
		fields[i].ValueURL = base + widgetFilesPrefix +
			url.PathEscape(id) + "/" + url.PathEscape(fields[i].Value)
	}
}

// GetSystemWidgetFields returns a system widget's assets, URLs filled.
func (a *App) GetSystemWidgetFields(id string) []WidgetField {
	fields := a.storedSystemWidgetFields()[id]
	if fields == nil {
		fields = []WidgetField{}
	}
	a.systemWidgetFieldURLs(id, fields)
	return fields
}

// mutateSystemWidgetFields applies fn to a system widget's assets, persists
// the whole map, and returns the widget's assets with URLs filled.
func (a *App) mutateSystemWidgetFields(id string, fn func(fields *[]WidgetField) error) ([]WidgetField, error) {
	if a.store == nil {
		return nil, fmt.Errorf("storage unavailable")
	}
	all := a.storedSystemWidgetFields()
	fields := all[id]
	if fields == nil {
		fields = []WidgetField{}
	}
	if err := fn(&fields); err != nil {
		return nil, err
	}
	all[id] = fields
	if err := a.store.setJSON(keySystemWidgetFields, all); err != nil {
		return nil, err
	}
	a.systemWidgetFieldURLs(id, fields)
	return fields, nil
}

// AddSystemWidgetField adds a named image or sound asset to a system widget. A
// name is required, and several assets of the same kind are allowed — the name
// tells them apart, and is how the display refers to each.
func (a *App) AddSystemWidgetField(id, typeID, label string) ([]WidgetField, error) {
	if !systemWidgetEditable(id) {
		return nil, fmt.Errorf("system widget %q has no editable display", id)
	}
	var ft *WidgetFieldType
	for _, t := range a.getWidgetFieldTypes() {
		if t.ID == typeID {
			cp := t
			ft = &cp
			break
		}
	}
	if ft == nil {
		return nil, fmt.Errorf("that field type no longer exists")
	}
	if ft.Kind != widgetFieldImage && ft.Kind != widgetFieldSound {
		return nil, fmt.Errorf("only image and sound assets can be added to a system widget")
	}
	label = strings.TrimSpace(label)
	if label == "" {
		return nil, fmt.Errorf("give the asset a name")
	}
	return a.mutateSystemWidgetFields(id, func(fields *[]WidgetField) error {
		*fields = append(*fields, WidgetField{
			ID:     fmt.Sprintf("swf_%d", time.Now().UnixNano()),
			TypeID: typeID,
			Label:  label,
		})
		return nil
	})
}

// RemoveSystemWidgetField drops an asset from a system widget.
func (a *App) RemoveSystemWidgetField(id, fieldID string) ([]WidgetField, error) {
	return a.mutateSystemWidgetFields(id, func(fields *[]WidgetField) error {
		kept := (*fields)[:0]
		for _, f := range *fields {
			if f.ID != fieldID {
				kept = append(kept, f)
			}
		}
		*fields = kept
		return nil
	})
}

// setSystemWidgetFieldFile records an uploaded/generated file as an asset's
// value and returns the widget's assets.
func (a *App) setSystemWidgetFieldFile(id, fieldID, name string) ([]WidgetField, error) {
	return a.mutateSystemWidgetFields(id, func(fields *[]WidgetField) error {
		for i := range *fields {
			if (*fields)[i].ID == fieldID {
				(*fields)[i].Value = name
				return nil
			}
		}
		return fmt.Errorf("that asset no longer exists")
	})
}

// systemWidgetAsset finds an asset's label and current file by id.
func (a *App) systemWidgetAsset(id, fieldID string) (label, current string, ok bool) {
	for _, f := range a.storedSystemWidgetFields()[id] {
		if f.ID == fieldID {
			return f.Label, f.Value, true
		}
	}
	return "", "", false
}

// copyPickedAsset opens a native file picker and copies the chosen file into
// the system widget's folder, returning the bare file name ("" when the
// picker is cancelled).
func (a *App) copyPickedAsset(id, title, displayName, pattern string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("no window context")
	}
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:   title,
		Filters: []wruntime.FileFilter{{DisplayName: displayName, Pattern: pattern}},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // cancelled
	}
	dir, err := widgetFilesDir(id)
	if err != nil {
		return "", err
	}
	name, _, err := copyIntoDir(path, dir)
	if err != nil {
		return "", fmt.Errorf("could not copy %s: %w", filepath.Base(path), err)
	}
	return name, nil
}

// UploadSystemWidgetFieldImage picks an image and records it as the asset's
// value. Returns the assets unchanged when the picker is cancelled.
func (a *App) UploadSystemWidgetFieldImage(id, fieldID string) ([]WidgetField, error) {
	name, err := a.copyPickedAsset(id, "Choose the asset image", "Images",
		"*.jpg;*.jpeg;*.gif;*.webp;*.png")
	if err != nil {
		return nil, err
	}
	if name == "" {
		return a.GetSystemWidgetFields(id), nil
	}
	return a.setSystemWidgetFieldFile(id, fieldID, name)
}

// UploadSystemWidgetFieldSound picks an audio file and records it as the
// asset's value. Returns the assets unchanged when the picker is cancelled.
func (a *App) UploadSystemWidgetFieldSound(id, fieldID string) ([]WidgetField, error) {
	name, err := a.copyPickedAsset(id, "Choose the asset sound", "Audio",
		"*.mp3;*.wav;*.ogg;*.m4a;*.aac;*.flac;*.webm")
	if err != nil {
		return nil, err
	}
	if name == "" {
		return a.GetSystemWidgetFields(id), nil
	}
	return a.setSystemWidgetFieldFile(id, fieldID, name)
}

// GenerateSystemWidgetFieldSound speaks a line into a system widget's sound
// asset — OpenAI TTS when connected, else the local Windows synthesizer.
func (a *App) GenerateSystemWidgetFieldSound(id, fieldID, text string) ([]WidgetField, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, fmt.Errorf("type the line to speak first")
	}
	dir, err := widgetFilesDir(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var name string
	if conn, ok := a.getConn(openaiService); ok && conn.login == openaiModeAPIKey {
		name, err = a.openaiSpeech(ctx, dir, text)
	} else {
		name, err = localSpeech(ctx, dir, text)
	}
	if err != nil {
		return nil, err
	}
	return a.setSystemWidgetFieldFile(id, fieldID, name)
}

// systemWidgetImageBrief guides asset image generation: an on-stream overlay
// element, not a thumbnail or scene.
const systemWidgetImageBrief = `An image generated for one of this system widget's assets is an overlay element shown on stream — not a thumbnail, not a full scene.

- Design for on-stream legibility at overlay size: bold shapes, high contrast, no fine detail that vanishes small.
- Match the brand's identity — its assets and palette ride along when available, and win over generic style choices.
- Keep the composition self-contained and free of surrounding chrome; the widget frames it.
- No platform logos, no watermark text, no fine print.`

// GenerateSystemWidgetFieldImage produces (or revises) a system widget's image
// asset with the shared image engine, briefed to make an on-stream overlay.
func (a *App) GenerateSystemWidgetFieldImage(id, fieldID, feedback string) ([]WidgetField, error) {
	conn, ok := a.getConn(openaiService)
	if !ok {
		return nil, fmt.Errorf("connect OpenAI in Settings → AI to generate images")
	}
	label, currentFile, ok := a.systemWidgetAsset(id, fieldID)
	if !ok {
		return nil, fmt.Errorf("that asset no longer exists")
	}
	name := id
	for _, sw := range systemWidgetCatalog {
		if sw.ID == id {
			name = sw.Name
		}
	}

	var b strings.Builder
	b.WriteString(systemWidgetImageBrief)
	fmt.Fprintf(&b, "\n\n# Widget\nName: %s\nAsset being generated: %s\n", name, label)
	if strings.TrimSpace(feedback) != "" {
		fmt.Fprintf(&b, "\n# Requested changes\n%s\n", strings.TrimSpace(feedback))
	}
	brandImages, brandSection := a.brandThumbRefs()
	b.WriteString(brandSection)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// The asset's current image feeds revisions; when it is gone the request
	// degrades to a fresh generation.
	var current []byte
	if base := filepath.Base(strings.TrimSpace(currentFile)); base != "" && base != "." {
		if dir, dirErr := widgetFilesDir(id); dirErr == nil {
			current, _ = os.ReadFile(filepath.Join(dir, base))
		}
	}

	shape := landscapeThumb
	var png []byte
	var err error
	if conn.login == openaiModeAPIKey {
		var refs []namedImage
		if current != nil {
			refs = append(refs, namedImage{name: "current.png", data: current})
		}
		refs = append(refs, brandImages...)
		if len(refs) > 0 {
			png, err = a.editImages(ctx, conn.token, b.String(), refs, shape.size)
		} else {
			png, err = a.generateImage(ctx, conn.token, b.String(), shape.size)
		}
	} else {
		png, err = generateThumbViaCodex(ctx, b.String(), current, brandImages, shape)
	}
	if err != nil {
		return nil, err
	}

	dir, err := widgetFilesDir(id)
	if err != nil {
		return nil, err
	}
	fname := fmt.Sprintf("field_%d.png", time.Now().UnixNano())
	if err := os.WriteFile(filepath.Join(dir, fname), png, 0o600); err != nil {
		return nil, fmt.Errorf("could not save the image: %v", err)
	}
	return a.setSystemWidgetFieldFile(id, fieldID, fname)
}

// systemWidgetSourceFields maps a system widget's assets into the display
// pipeline's field shape (file kinds carry their served URL as the value).
func (a *App) systemWidgetSourceFields(id string) []widgetSourceField {
	kinds := map[string]string{}
	for _, ft := range a.getWidgetFieldTypes() {
		kinds[ft.ID] = ft.Kind
	}
	out := []widgetSourceField{}
	for _, f := range a.GetSystemWidgetFields(id) {
		value := f.Value
		if f.ValueURL != "" {
			value = f.ValueURL
		}
		out = append(out, widgetSourceField{Label: f.Label, Kind: kinds[f.TypeID], Value: value})
	}
	return out
}

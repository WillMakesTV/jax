package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Widget images
//
// Image fields on a stream widget hold a file in the widget's own folder
// (~/.jax/widgets/<id>), served under /widgetfiles/ by the media server.
// The file arrives by upload or AI generation; generation runs the shared
// image engine under the widget's own dynamic skill (see widgetSkillContent),
// and a field that already has an image is revised rather than replaced
// blind — the current image rides along with the feedback.
// ---------------------------------------------------------------------------

// widgetsDir returns the root directory holding per-widget files
// (~/.jax/widgets), creating it if necessary.
func widgetsDir() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(dir, "widgets")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	return root, nil
}

// widgetFilesDir returns a widget's file directory, creating it if needed.
func widgetFilesDir(widgetID string) (string, error) {
	root, err := widgetsDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, widgetID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// UploadWidgetFieldImage opens a native image picker and copies the chosen
// file into the widget's folder, recording it as the field's value. Returns
// the updated widget (unchanged when the picker is cancelled).
func (a *App) UploadWidgetFieldImage(widgetID, fieldID string) (StreamWidget, error) {
	if a.ctx == nil {
		return StreamWidget{}, fmt.Errorf("no window context")
	}
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose the field's image",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Images", Pattern: "*.jpg;*.jpeg;*.gif;*.webp;*.png"},
		},
	})
	if err != nil {
		return StreamWidget{}, err
	}
	if path == "" {
		// Cancelled; hand back the current state so the frontend can no-op.
		return a.mutateStreamWidget(widgetID, func(*StreamWidget) error { return nil })
	}

	dir, err := widgetFilesDir(widgetID)
	if err != nil {
		return StreamWidget{}, err
	}
	name, _, err := copyIntoDir(path, dir)
	if err != nil {
		return StreamWidget{}, fmt.Errorf("could not copy %s: %w", filepath.Base(path), err)
	}
	return a.setWidgetFieldFile(widgetID, fieldID, name)
}

// UploadWidgetFieldSound opens a native audio picker and copies the chosen
// file into the widget's folder, recording it as the field's value. Returns
// the updated widget (unchanged when the picker is cancelled).
func (a *App) UploadWidgetFieldSound(widgetID, fieldID string) (StreamWidget, error) {
	if a.ctx == nil {
		return StreamWidget{}, fmt.Errorf("no window context")
	}
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose the field's sound",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Audio", Pattern: "*.mp3;*.wav;*.ogg;*.m4a;*.aac;*.flac;*.webm"},
		},
	})
	if err != nil {
		return StreamWidget{}, err
	}
	if path == "" {
		// Cancelled; hand back the current state so the frontend can no-op.
		return a.mutateStreamWidget(widgetID, func(*StreamWidget) error { return nil })
	}

	dir, err := widgetFilesDir(widgetID)
	if err != nil {
		return StreamWidget{}, err
	}
	name, _, err := copyIntoDir(path, dir)
	if err != nil {
		return StreamWidget{}, fmt.Errorf("could not copy %s: %w", filepath.Base(path), err)
	}
	return a.setWidgetFieldFile(widgetID, fieldID, name)
}

// setWidgetFieldFile records name as a field's value and returns the widget.
func (a *App) setWidgetFieldFile(widgetID, fieldID, name string) (StreamWidget, error) {
	return a.mutateStreamWidget(widgetID, func(w *StreamWidget) error {
		for i := range w.Fields {
			if w.Fields[i].ID == fieldID {
				w.Fields[i].Value = name
				return nil
			}
		}
		return fmt.Errorf("that field no longer exists")
	})
}

// GenerateWidgetFieldImage produces (or revises) an image field's content
// with the shared image engine, briefed by the widget's own skill. The
// finished file lands in the widget's folder and becomes the field's value;
// the updated widget is returned.
func (a *App) GenerateWidgetFieldImage(widgetID, fieldID, feedback string) (StreamWidget, error) {
	conn, ok := a.getConn(openaiService)
	if !ok {
		return StreamWidget{}, fmt.Errorf("connect OpenAI in Settings → AI to generate images")
	}

	var widget *StreamWidget
	for _, w := range a.getStreamWidgets() {
		if w.ID == widgetID {
			cp := w
			widget = &cp
			break
		}
	}
	if widget == nil {
		return StreamWidget{}, fmt.Errorf("that stream widget no longer exists")
	}
	var fieldLabel, currentFile string
	found := false
	for _, f := range widget.Fields {
		if f.ID == fieldID {
			fieldLabel, currentFile, found = f.Label, f.Value, true
			break
		}
	}
	if !found {
		return StreamWidget{}, fmt.Errorf("that field no longer exists")
	}

	// The widget's own skill leads the prompt; the widget and field context
	// follow, then the revision feedback and the brand's reference images.
	skill, err := a.getAppSkill(widgetSkillID(*widget))
	if err != nil {
		return StreamWidget{}, err
	}
	var b strings.Builder
	b.WriteString(skill.Content)
	fmt.Fprintf(&b, "\n\n# Widget\nName: %s\nField being generated: %s\n", widget.Name, fieldLabel)
	if strings.TrimSpace(feedback) != "" {
		fmt.Fprintf(&b, "\n# Requested changes\n%s\n", strings.TrimSpace(feedback))
	}
	brandImages, brandSection := a.brandThumbRefs()
	b.WriteString(brandSection)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// The field's current image feeds revisions; when it is gone the request
	// degrades to a fresh generation.
	var current []byte
	if base := filepath.Base(strings.TrimSpace(currentFile)); base != "" && base != "." {
		if dir, dirErr := widgetFilesDir(widgetID); dirErr == nil {
			current, _ = os.ReadFile(filepath.Join(dir, base))
		}
	}

	shape := landscapeThumb
	var png []byte
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
		return StreamWidget{}, err
	}

	dir, err := widgetFilesDir(widgetID)
	if err != nil {
		return StreamWidget{}, err
	}
	name := fmt.Sprintf("field_%d.png", time.Now().UnixNano())
	if err := os.WriteFile(filepath.Join(dir, name), png, 0o600); err != nil {
		return StreamWidget{}, fmt.Errorf("could not save the image: %v", err)
	}
	return a.setWidgetFieldFile(widgetID, fieldID, name)
}

// --- Per-widget dynamic skills -----------------------------------------------

// widgetSkillPrefix namespaces the dynamic skills stream widgets publish.
const widgetSkillPrefix = "stream-widget-"

// widgetSkillID is the dynamic skill id for a stream widget.
func widgetSkillID(w StreamWidget) string {
	return widgetSkillPrefix + w.ID
}

// widgetBySkillID resolves a dynamic skill id back to its widget.
func (a *App) widgetBySkillID(id string) (StreamWidget, bool) {
	raw, ok := strings.CutPrefix(id, widgetSkillPrefix)
	if !ok {
		return StreamWidget{}, false
	}
	for _, w := range a.getStreamWidgets() {
		if w.ID == raw {
			return w, true
		}
	}
	return StreamWidget{}, false
}

// widgetSkillContent is a widget's default skill content: the creative brief
// behind generating this widget's imagery and its display template.
func widgetSkillContent(w StreamWidget) string {
	var b strings.Builder
	fmt.Fprintf(&b, "This is the creative brief for the %q stream widget. ", w.Name)
	b.WriteString("When an image or a display template is generated for this widget, this document is sent to the model together with the widget's context — edit it to change the style every generation follows.\n\n")
	b.WriteString(`## Widget images

An image generated for one of this widget's fields is an overlay element shown on stream — not a thumbnail, not a full scene.

- Design for on-stream legibility at overlay size: bold shapes, high contrast, no fine detail that vanishes small.
- Match the brand's identity — its assets and palette ride along when available, and they win over generic style choices.
- Keep the composition self-contained and free of surrounding chrome; the widget frames it.
- No platform logos, no watermark text, no fine print.

## Display template

The widget's display is a JSX template plus CSS and optional JS, rendered on a Browser Source page this application serves locally — the producer adds its URL to OBS as a Browser Source layered over the scene.

The template's contract:

- One JSX expression with a single root element ("className", not "class").
- It receives "widget" (with "widget.name") and "fields", a map from each field's label to its value — text kinds give the text, image and sound kinds give a local URL. Render images with <img src={fields['Label']} />.
- "playSound('Label')" plays a sound field's audio — call it from event handlers or the custom JS, never unconditionally on render (the page re-renders whenever data changes).
- "widget.testing" is true during a 15-second test fired from the app (which also remounts the display and plays sound fields once). Alert-style widgets that should stay hidden until called upon can gate their visibility on it.
- The custom JS runs after each render as function(widget, fields, playSound, root) — the place for animations and timed behaviour.
- The page background is transparent; OBS composites it over the scene. Style everything explicitly (fonts, colors, sizes) — there is no surrounding app chrome to inherit from.
- Design for stream legibility: large type, strong contrast, and animation that draws the eye without looping distractingly forever.
`)
	if len(w.Fields) > 0 {
		b.WriteString("\n## This widget's fields\n\n")
		for _, f := range w.Fields {
			fmt.Fprintf(&b, "- %s\n", f.Label)
		}
	}
	return b.String()
}

// widgetSkillDescription is the catalog line for a widget's skill.
func widgetSkillDescription(w StreamWidget) string {
	return fmt.Sprintf("The creative brief behind the %q stream widget's imagery and display template.", w.Name)
}

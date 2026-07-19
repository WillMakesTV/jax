package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Widget Browser Source
//
// Every stream widget is served as a self-contained page on the local media
// server — /widget/<id> — meant to be added to OBS as a Browser Source. The
// page renders the widget's JSX template with React (transformed in-page by
// a vendored Babel standalone, so no build step stands between editing a
// template and seeing it), applies the widget's CSS, runs its custom JS
// after each render, and polls the widget's data so on-stream content
// follows edits live. Everything the page loads is served from this app;
// nothing leaves the machine.
// ---------------------------------------------------------------------------

// widgetSourcePrefix serves the widget Browser Source pages and their data.
const widgetSourcePrefix = "/widget/"

// browserSourceAssets are the page's vendored runtime: React and ReactDOM
// UMD builds plus Babel standalone for the in-page JSX transform.
//
//go:embed browser_source/react.js browser_source/react-dom.js browser_source/babel.js
var browserSourceAssets embed.FS

// widgetSourceField is one field as the Browser Source page sees it: file
// kinds (image, sound) carry their served URL as the value.
type widgetSourceField struct {
	Label string `json:"label"`
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

// widgetSourceData is the payload behind /widget/<id>/data.
type widgetSourceData struct {
	Name     string              `json:"name"`
	Template string              `json:"template"`
	CSS      string              `json:"css"`
	JS       string              `json:"js"`
	Fields   []widgetSourceField `json:"fields"`
	// Testing is true while a test window fired from the app is running;
	// the page remounts the display and plays sound fields when it flips
	// on, and clears back to the normal render when it flips off.
	Testing bool `json:"testing"`
	// Reload counts Clear actions; the page reloads itself fresh whenever
	// the value it sees changes.
	Reload int `json:"reload"`
}

// widgetTestWindow is how long a widget test shows before clearing.
const widgetTestWindow = 15 * time.Second

// TestStreamWidget starts a widget's test window: for the next 15 seconds
// its Browser Source reports testing, remounts the display (restarting any
// entrance animation), and plays its sound fields once — then clears back
// to the normal render.
func (a *App) TestStreamWidget(id string) error {
	found := false
	for _, w := range a.getStreamWidgets() {
		if w.ID == id {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("that stream widget no longer exists")
	}
	a.mu.Lock()
	if a.widgetTests == nil {
		a.widgetTests = map[string]time.Time{}
	}
	a.widgetTests[id] = time.Now().Add(widgetTestWindow)
	a.mu.Unlock()
	return nil
}

// widgetTesting reports whether a widget's test window is still open.
func (a *App) widgetTesting(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return time.Now().Before(a.widgetTests[id])
}

// widgetTestRestore is one pending test cleanup: the field values to write
// back when the staged item's window ends.
type widgetTestRestore struct {
	timer    *time.Timer
	original map[string]string // field id → value
}

// stageWidgetTestValues writes a sample item into the widget's REAL fields —
// the same path an MCP set_widget_field takes — so the Browser Source's own
// display logic reacts to a genuine change: entrance animation, sounds, all
// of it. The original values are written back when the window ends, and the
// source then reloads into a clean state. Re-testing before the restore
// fires keeps the first snapshot, so originals are never overwritten by
// sample values.
func (a *App) stageWidgetTestValues(widgetID string, values map[string]string) error {
	a.mu.Lock()
	pending := a.widgetTestRestores[widgetID]
	if pending != nil {
		pending.timer.Stop()
	}
	a.mu.Unlock()

	var original map[string]string
	if pending != nil {
		original = pending.original
	} else {
		original = map[string]string{}
		for _, w := range a.getStreamWidgets() {
			if w.ID != widgetID {
				continue
			}
			for _, f := range w.Fields {
				if _, ok := values[f.ID]; ok {
					original[f.ID] = f.Value
				}
			}
		}
	}

	if _, err := a.mutateStreamWidget(widgetID, func(w *StreamWidget) error {
		for i := range w.Fields {
			if v, ok := values[w.Fields[i].ID]; ok {
				w.Fields[i].Value = v
			}
		}
		return nil
	}); err != nil {
		return err
	}

	timer := time.AfterFunc(widgetTestWindow, func() { a.restoreWidgetTest(widgetID) })
	a.mu.Lock()
	if a.widgetTestRestores == nil {
		a.widgetTestRestores = map[string]*widgetTestRestore{}
	}
	a.widgetTestRestores[widgetID] = &widgetTestRestore{timer: timer, original: original}
	a.mu.Unlock()
	return nil
}

// restoreWidgetTest ends a staged test: the original field values return and
// the Browser Source reloads fresh so no test state lingers.
func (a *App) restoreWidgetTest(widgetID string) {
	a.mu.Lock()
	pending := a.widgetTestRestores[widgetID]
	delete(a.widgetTestRestores, widgetID)
	a.mu.Unlock()
	if pending == nil {
		return
	}
	if _, err := a.mutateStreamWidget(widgetID, func(w *StreamWidget) error {
		for i := range w.Fields {
			if v, ok := pending.original[w.Fields[i].ID]; ok {
				w.Fields[i].Value = v
			}
		}
		return nil
	}); err != nil {
		return
	}
	_ = a.ClearStreamWidget(widgetID)
}

// GenerateWidgetTestItem tests a widget the way it is really used: the
// widget's own skill briefs the connected text AI to write one realistic
// sample item for the widget's text fields, and the item is written into
// the fields themselves — the same path an MCP agent's set_widget_field
// takes — so the Browser Source's display logic genuinely reacts to it.
// After 15 seconds the original values return and the source reloads
// clean. With no text fields to write, the plain test window opens instead.
func (a *App) GenerateWidgetTestItem(widgetID string) error {
	var widget *StreamWidget
	for _, sw := range a.getStreamWidgets() {
		if sw.ID == widgetID {
			cp := sw
			widget = &cp
			break
		}
	}
	if widget == nil {
		return fmt.Errorf("that stream widget no longer exists")
	}

	kinds := map[string]WidgetFieldType{}
	for _, ft := range a.getWidgetFieldTypes() {
		kinds[ft.ID] = ft
	}
	type textField struct {
		field WidgetField
		ft    WidgetFieldType
	}
	var texts []textField
	for _, f := range widget.Fields {
		ft := kinds[f.TypeID]
		if ft.Kind == widgetFieldMessage || ft.Kind == widgetFieldStatus {
			texts = append(texts, textField{field: f, ft: ft})
		}
	}
	if len(texts) == 0 {
		return a.TestStreamWidget(widgetID)
	}

	skill, err := a.getAppSkill(widgetSkillID(*widget))
	if err != nil {
		return err
	}
	system := `You are staging a realistic test item for a stream widget in the Jax streaming app. The widget's skill below describes what the widget is for and how its content reads; write ONE sample item that shows the widget at its best on stream — representative, concrete, and in the skill's voice. Respond with a single JSON object mapping each listed field label to its sample text, and nothing else. Respect each field's character cap.`

	var in strings.Builder
	fmt.Fprintf(&in, "# Widget skill\n%s\n\n# Fields to fill\n", skill.Content)
	for _, tf := range texts {
		fmt.Fprintf(&in, "- %q (%s", tf.field.Label, tf.ft.Kind)
		if tf.ft.MaxLength > 0 {
			fmt.Fprintf(&in, ", max %d characters", tf.ft.MaxLength)
		}
		in.WriteString(")\n")
	}

	text, err := a.askAIText(system, in.String())
	if err != nil {
		return err
	}
	byLabel, err := parseWidgetTestItem(text)
	if err != nil {
		return err
	}
	values := map[string]string{}
	for _, tf := range texts {
		v, ok := byLabel[tf.field.Label]
		if !ok {
			continue
		}
		if tf.ft.MaxLength > 0 {
			if r := []rune(v); len(r) > tf.ft.MaxLength {
				v = string(r[:tf.ft.MaxLength])
			}
		}
		values[tf.field.ID] = v
	}
	if len(values) == 0 {
		return fmt.Errorf("the model returned no usable sample values — try again")
	}
	return a.stageWidgetTestValues(widgetID, values)
}

// parseWidgetTestItem extracts the sample-item JSON from the model's
// response, tolerating stray prose or code fences around the object.
func parseWidgetTestItem(text string) (map[string]string, error) {
	lo := strings.Index(text, "{")
	hi := strings.LastIndex(text, "}")
	if lo < 0 || hi <= lo {
		return nil, fmt.Errorf("the model returned an unexpected format — try again")
	}
	var out map[string]string
	if err := json.Unmarshal([]byte(text[lo:hi+1]), &out); err != nil {
		return nil, fmt.Errorf("the model returned an unexpected format — try again")
	}
	return out, nil
}

// ClearStreamWidget clears the widget's Browser Source cache: a one-shot
// action that makes the page discard everything it holds — compiled
// template, custom-JS timers, DOM state — and load itself fresh. It works
// by bumping a per-widget reload count the page watches in its data feed.
func (a *App) ClearStreamWidget(id string) error {
	found := false
	for _, w := range a.getStreamWidgets() {
		if w.ID == id {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("that stream widget no longer exists")
	}
	a.mu.Lock()
	if a.widgetReload == nil {
		a.widgetReload = map[string]int{}
	}
	a.widgetReload[id]++
	a.mu.Unlock()
	return nil
}

// widgetReloadGen returns a widget's current Clear count.
func (a *App) widgetReloadGen(id string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.widgetReload[id]
}

// serveWidgetSource handles everything under /widget/: the runtime assets,
// each widget's page, and its data feed.
func (a *App) serveWidgetSource(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, widgetSourcePrefix)
	if asset, ok := strings.CutPrefix(rest, "assets/"); ok {
		raw, err := browserSourceAssets.ReadFile("browser_source/" + asset)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		_, _ = w.Write(raw)
		return
	}

	id, isData := strings.CutSuffix(rest, "/data")
	var widget *StreamWidget
	for _, sw := range a.getStreamWidgets() {
		if sw.ID == id {
			cp := sw
			widget = &cp
			break
		}
	}
	if widget == nil {
		http.NotFound(w, r)
		return
	}

	if isData {
		a.fillWidgetURLs(widget)
		kinds := map[string]string{}
		for _, ft := range a.getWidgetFieldTypes() {
			kinds[ft.ID] = ft.Kind
		}
		data := widgetSourceData{
			Name:     widget.Name,
			Template: widget.Template,
			CSS:      widget.CSS,
			JS:       widget.JS,
			Fields:   []widgetSourceField{},
			Testing:  a.widgetTesting(widget.ID),
			Reload:   a.widgetReloadGen(widget.ID),
		}
		for _, f := range widget.Fields {
			value := f.Value
			if f.ValueURL != "" {
				value = f.ValueURL
			}
			data.Fields = append(data.Fields, widgetSourceField{
				Label: f.Label,
				Kind:  kinds[f.TypeID],
				Value: value,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(data)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = widgetSourcePage.Execute(w, map[string]string{"Name": widget.Name})
}

// widgetSourcePage is the Browser Source shell. The body is transparent (OBS
// composites the page over the scene); the runtime fetches the widget's data,
// transforms the JSX template with Babel, renders with React, injects the
// CSS, exposes playSound to the custom JS, and re-renders when data changes.
var widgetSourcePage = template.Must(template.New("widget").Parse(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{{.Name}}</title>
<script src="/widget/assets/react.js"></script>
<script src="/widget/assets/react-dom.js"></script>
<script src="/widget/assets/babel.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #widget-error { position: fixed; left: 8px; bottom: 8px; font: 12px monospace; color: #f66; white-space: pre-wrap; }
</style>
<style id="widget-css"></style>
</head>
<body>
<div id="root"></div>
<div id="widget-error"></div>
<script>
(function () {
  'use strict'
  var dataURL = location.pathname.replace(/\/$/, '') + '/data'
  var root = ReactDOM.createRoot(document.getElementById('root'))
  var errBox = document.getElementById('widget-error')
  var cssTag = document.getElementById('widget-css')
  var lastJSON = ''
  var compiled = {source: null, render: null}
  var fields = {}

  // playSound is available to templates and custom JS: plays a sound
  // field's audio by the field's label.
  window.playSound = function (label) {
    var url = fields[label]
    if (url) new Audio(url).play().catch(function () {})
  }

  function compileTemplate(source) {
    if (compiled.source === source) return compiled.render
    var body
    if (source && source.trim()) {
      var code = Babel.transform('(' + source + ')', {presets: ['react']}).code
      body = 'return ' + code.replace(/;\s*$/, '')
    } else {
      // No template yet: name plus every field's value, so the source shows
      // something before the layout is authored.
      body =
        "return React.createElement('div', null," +
        " React.createElement('h2', null, widget.name)," +
        " Object.keys(fields).map(function (k) {" +
        "   return React.createElement('p', {key: k}, String(fields[k]))" +
        " }))"
    }
    compiled = {
      source: source,
      render: new Function('React', 'widget', 'fields', 'playSound', body),
    }
    return compiled.render
  }

  var wasTesting = false
  var reloadGen = 0
  var first = true

  function apply(data) {
    var widget = {name: data.name, testing: !!data.testing}

    // Leaving a test window, or a Clear fired from the app (the reload
    // count moved), reloads the page — the surest way to drop cached
    // templates, custom-JS timers, and any DOM state left behind.
    if (!first && ((wasTesting && !widget.testing) ||
        data.reload !== reloadGen)) {
      location.reload()
      return
    }

    fields = {}
    data.fields.forEach(function (f) { fields[f.label] = f.value })

    // A test window opening remounts the display (restarting entrance
    // animations) and plays each sound field once; the window closing
    // reloads above.
    if (widget.testing && !wasTesting) {
      root.render(null)
      data.fields.forEach(function (f) {
        if (f.kind === 'sound' && f.value) new Audio(f.value).play().catch(function () {})
      })
    }
    wasTesting = widget.testing
    reloadGen = data.reload
    first = false
    cssTag.textContent = data.css || ''

    var render = compileTemplate(data.template)
    root.render(render(React, widget, fields, window.playSound))
    if (data.js && data.js.trim()) {
      // Custom logic/animation runs after each render with the same context
      // the template gets, plus the root element.
      new Function('widget', 'fields', 'playSound', 'root', data.js)(
        widget, fields, window.playSound, document.getElementById('root'))
    }
  }

  function tick() {
    fetch(dataURL, {cache: 'no-store'})
      .then(function (res) { return res.text() })
      .then(function (text) {
        if (text === lastJSON) return
        lastJSON = text
        apply(JSON.parse(text))
        errBox.textContent = ''
      })
      .catch(function (err) { errBox.textContent = String(err) })
  }

  tick()
  setInterval(tick, 2000)
})()
</script>
</body>
</html>
`))

// GenerateWidgetTemplate produces (or revises) a widget's display — JSX
// template, CSS, and custom JS — from the producer's layout description,
// briefed by the widget's own skill. The result is stored on the widget and
// the updated widget returned.
func (a *App) GenerateWidgetTemplate(widgetID, description string) (StreamWidget, error) {
	description = strings.TrimSpace(description)
	if description == "" {
		return StreamWidget{}, fmt.Errorf("describe the layout you want first")
	}

	var widget *StreamWidget
	for _, sw := range a.getStreamWidgets() {
		if sw.ID == widgetID {
			cp := sw
			widget = &cp
			break
		}
	}
	if widget == nil {
		return StreamWidget{}, fmt.Errorf("that stream widget no longer exists")
	}

	skill, err := a.getAppSkill(widgetSkillID(*widget))
	if err != nil {
		return StreamWidget{}, err
	}
	system := skill.Content + `

# Output format

Respond with a single JSON object and nothing else:
{"template": "<JSX>", "css": "<stylesheet>", "js": "<custom logic, or empty string>"}

template is one JSX expression (a single root element, className not class).
css is a plain stylesheet applied to the page. js is optional plain
JavaScript run after each render as function(widget, fields, playSound,
root). Do not wrap the JSON in code fences.`

	var in strings.Builder
	fmt.Fprintf(&in, "# Widget\nName: %s\n\n## Fields\n", widget.Name)
	kinds := map[string]string{}
	for _, ft := range a.getWidgetFieldTypes() {
		kinds[ft.ID] = ft.Kind
	}
	for _, f := range widget.Fields {
		kind := kinds[f.TypeID]
		if kind == "" {
			kind = "text"
		}
		fmt.Fprintf(&in, "- fields[%q] (%s)\n", f.Label, kind)
	}
	if len(widget.Fields) == 0 {
		in.WriteString("(none yet)\n")
	}
	if strings.TrimSpace(widget.Template) != "" {
		fmt.Fprintf(&in, "\n## Current template\n%s\n", widget.Template)
	}
	if strings.TrimSpace(widget.CSS) != "" {
		fmt.Fprintf(&in, "\n## Current CSS\n%s\n", widget.CSS)
	}
	if strings.TrimSpace(widget.JS) != "" {
		fmt.Fprintf(&in, "\n## Current JS\n%s\n", widget.JS)
	}
	fmt.Fprintf(&in, "\n# Requested layout\n%s\n", description)

	text, err := a.askAIText(system, in.String())
	if err != nil {
		return StreamWidget{}, err
	}
	parsed, err := parseWidgetTemplate(text)
	if err != nil {
		return StreamWidget{}, err
	}
	return a.mutateStreamWidget(widgetID, func(sw *StreamWidget) error {
		// Models often return everything on one line; pretty-print that
		// case so the editors read properly (see widget_format.go).
		sw.Template = formatWidgetJSX(parsed.Template)
		sw.CSS = formatWidgetCSS(parsed.CSS)
		sw.JS = formatWidgetJS(parsed.JS)
		return nil
	})
}

// GenerateWidgetSkill writes the widget's skill brief from the widget
// itself — its fields, template, styles, and animation logic — so the brief
// describes the widget as it actually is. The result is stored as the
// skill's content and the updated skill returned.
func (a *App) GenerateWidgetSkill(widgetID string) (AppSkill, error) {
	var widget *StreamWidget
	for _, sw := range a.getStreamWidgets() {
		if sw.ID == widgetID {
			cp := sw
			widget = &cp
			break
		}
	}
	if widget == nil {
		return AppSkill{}, fmt.Errorf("that stream widget no longer exists")
	}

	system := `You are writing the skill document (the creative brief) for one stream widget in the Jax streaming app. The document is markdown. It is sent to AI models whenever imagery, spoken audio, or the display template is generated for this widget, and agents read it over MCP before working with the widget — it defines how the widget is used.

Ground the document in the widget's ACTUAL configuration given below:
- Name each field, its kind, and its role in the display.
- Describe the display's structure, styling, and any animations as the template/CSS/JS implement them today.
- Note how playSound('Label') and widget.testing are (or should be) used.
- Give concrete visual guidance consistent with the current CSS (colors, type scale, motion), plus overlay basics: transparent page background, on-stream legibility.
- Carry forward any producer-authored conventions found in the current skill content.

Respond with the markdown document only — no code fences around the whole document, no preamble.`

	kinds := map[string]WidgetFieldType{}
	for _, ft := range a.getWidgetFieldTypes() {
		kinds[ft.ID] = ft
	}
	var in strings.Builder
	fmt.Fprintf(&in, "# Widget\nName: %s\n\n## Fields\n", widget.Name)
	for _, f := range widget.Fields {
		ft := kinds[f.TypeID]
		kind := ft.Kind
		if kind == "" {
			kind = "text"
		}
		fmt.Fprintf(&in, "- %s (%s", f.Label, kind)
		if ft.MaxLength > 0 {
			fmt.Fprintf(&in, ", max %d characters", ft.MaxLength)
		}
		in.WriteString(")\n")
	}
	if len(widget.Fields) == 0 {
		in.WriteString("(none yet)\n")
	}
	if strings.TrimSpace(widget.Template) != "" {
		fmt.Fprintf(&in, "\n## Template (JSX)\n%s\n", widget.Template)
	}
	if strings.TrimSpace(widget.CSS) != "" {
		fmt.Fprintf(&in, "\n## Styles (CSS)\n%s\n", widget.CSS)
	}
	if strings.TrimSpace(widget.JS) != "" {
		fmt.Fprintf(&in, "\n## Animation/logic (JS)\n%s\n", widget.JS)
	}
	if skill, err := a.getAppSkill(widgetSkillID(*widget)); err == nil {
		fmt.Fprintf(&in, "\n## Current skill content\n%s\n", skill.Content)
	}

	text, err := a.askAIText(system, in.String())
	if err != nil {
		return AppSkill{}, err
	}
	return a.SaveAppSkill(widgetSkillID(*widget), strings.TrimSpace(text))
}

// ReviseWidgetSkill applies the producer's requested edits to the widget's
// skill: the connected text AI rewrites the current brief per the request —
// keeping everything not asked to change — and the revision is stored as
// the skill's content. Returns the updated skill.
func (a *App) ReviseWidgetSkill(widgetID, request string) (AppSkill, error) {
	request = strings.TrimSpace(request)
	if request == "" {
		return AppSkill{}, fmt.Errorf("describe the edits you want first")
	}

	var widget *StreamWidget
	for _, sw := range a.getStreamWidgets() {
		if sw.ID == widgetID {
			cp := sw
			widget = &cp
			break
		}
	}
	if widget == nil {
		return AppSkill{}, fmt.Errorf("that stream widget no longer exists")
	}
	skill, err := a.getAppSkill(widgetSkillID(*widget))
	if err != nil {
		return AppSkill{}, err
	}

	system := `You are revising the skill document (the creative brief) for one stream widget in the Jax streaming app. The document is markdown; it is sent to AI models whenever imagery, spoken audio, or the display template is generated for this widget, and agents read it over MCP before working with the widget — it defines how the widget works, looks, and animates.

Apply the producer's requested edits to the current document. Change what the request asks for and keep everything else — structure, conventions, and content not touched by the request stay as they are. Respond with the complete revised markdown document only — no code fences around it, no preamble, no commentary.`

	var in strings.Builder
	fmt.Fprintf(&in, "# Widget\nName: %s\n\n# Current skill document\n%s\n\n# Requested edits\n%s\n",
		widget.Name, skill.Content, request)

	text, err := a.askAIText(system, in.String())
	if err != nil {
		return AppSkill{}, err
	}
	return a.SaveAppSkill(widgetSkillID(*widget), strings.TrimSpace(text))
}

// widgetTemplateResult is the shape GenerateWidgetTemplate asks the model
// for.
type widgetTemplateResult struct {
	Template string `json:"template"`
	CSS      string `json:"css"`
	JS       string `json:"js"`
}

// parseWidgetTemplate extracts the template JSON from the model's response,
// tolerating stray prose or code fences around the object.
func parseWidgetTemplate(text string) (widgetTemplateResult, error) {
	var out widgetTemplateResult
	lo := strings.Index(text, "{")
	hi := strings.LastIndex(text, "}")
	if lo < 0 || hi <= lo {
		return out, fmt.Errorf("the model returned an unexpected format — try again")
	}
	if err := json.Unmarshal([]byte(text[lo:hi+1]), &out); err != nil {
		return out, fmt.Errorf("the model returned an unexpected format — try again")
	}
	if strings.TrimSpace(out.Template) == "" {
		return out, fmt.Errorf("the model returned no template — try again")
	}
	return out, nil
}

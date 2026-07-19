package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"strings"
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

  function apply(data) {
    fields = {}
    data.fields.forEach(function (f) { fields[f.label] = f.value })
    cssTag.textContent = data.css || ''
    var widget = {name: data.name}
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
		sw.Template = parsed.Template
		sw.CSS = parsed.CSS
		sw.JS = parsed.JS
		return nil
	})
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

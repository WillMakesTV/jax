package main

import (
	_ "embed"
	"reflect"
	"regexp"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// Live application documentation
//
// Self-describing docs for the app, exposed over MCP so an AI client (or the
// project-brief chat) can explain any part of Jax accurately. Nothing here is
// hand-written: the function list is reflected off the bound App type, the
// model list is walked out of those functions' signatures, and the page list
// is parsed from the embedded frontend navigation source — so every build's
// documentation matches that build's code automatically.
// ---------------------------------------------------------------------------

// navigationSource is the frontend's routing table, embedded at build time so
// the page docs always match the shipped frontend.
//
//go:embed frontend/src/navigation.ts
var navigationSource string

// AppFunctionDoc is one Go method the frontend can call (a Wails binding).
type AppFunctionDoc struct {
	Name    string   `json:"name"`
	Params  []string `json:"params"`
	Results []string `json:"results"`
}

// AppModelField is one JSON field of a bound model.
type AppModelField struct {
	Name string `json:"name"` // the JSON name the frontend sees
	Type string `json:"type"` // the Go type
}

// AppModelDoc is one struct type crossing the Go↔frontend boundary.
type AppModelDoc struct {
	Name   string          `json:"name"`
	Fields []AppModelField `json:"fields"`
}

// AppPageDoc is one routable frontend view.
type AppPageDoc struct {
	ID string `json:"id"`
	// Sidebar label when the view has a nav entry; '' for views reached
	// through in-page navigation (cards, CTAs, the user menu).
	Sidebar string `json:"sidebar,omitempty"`
}

// typeName renders a type for the docs, with the package prefix dropped
// ("main.PastStream" → "PastStream", "[]main.PastStream" → "[]PastStream").
func typeName(t reflect.Type) string {
	return strings.ReplaceAll(t.String(), "main.", "")
}

// appFunctionDocs reflects the bound API off the App type: every exported
// method with its parameter and result types, sorted by name.
func appFunctionDocs() []AppFunctionDoc {
	t := reflect.TypeOf(&App{})
	out := make([]AppFunctionDoc, 0, t.NumMethod())
	for i := 0; i < t.NumMethod(); i++ {
		m := t.Method(i)
		doc := AppFunctionDoc{Name: m.Name, Params: []string{}, Results: []string{}}
		// Skip the receiver.
		for p := 1; p < m.Type.NumIn(); p++ {
			doc.Params = append(doc.Params, typeName(m.Type.In(p)))
		}
		for r := 0; r < m.Type.NumOut(); r++ {
			doc.Results = append(doc.Results, typeName(m.Type.Out(r)))
		}
		out = append(out, doc)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// collectModelTypes walks a type reachable from a bound signature and records
// every named struct from this package, recursing through fields, slices,
// maps, and pointers.
func collectModelTypes(t reflect.Type, seen map[string]reflect.Type) {
	switch t.Kind() {
	case reflect.Pointer, reflect.Slice, reflect.Array, reflect.Map:
		if t.Kind() == reflect.Map {
			collectModelTypes(t.Key(), seen)
		}
		collectModelTypes(t.Elem(), seen)
	case reflect.Struct:
		if t.PkgPath() == "" || t.Name() == "" {
			return
		}
		// Only this package's models; time.Time etc. document as themselves.
		if t.PkgPath() != reflect.TypeOf(App{}).PkgPath() {
			return
		}
		if _, ok := seen[t.Name()]; ok {
			return
		}
		seen[t.Name()] = t
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if !f.IsExported() {
				continue
			}
			collectModelTypes(f.Type, seen)
		}
	}
}

// appModelDocs documents every struct type reachable from the bound API:
// each JSON field the frontend sees with its Go type, sorted by name.
func appModelDocs() []AppModelDoc {
	seen := map[string]reflect.Type{}
	t := reflect.TypeOf(&App{})
	for i := 0; i < t.NumMethod(); i++ {
		m := t.Method(i)
		for p := 1; p < m.Type.NumIn(); p++ {
			collectModelTypes(m.Type.In(p), seen)
		}
		for r := 0; r < m.Type.NumOut(); r++ {
			collectModelTypes(m.Type.Out(r), seen)
		}
	}

	out := make([]AppModelDoc, 0, len(seen))
	for name, st := range seen {
		doc := AppModelDoc{Name: name, Fields: []AppModelField{}}
		for i := 0; i < st.NumField(); i++ {
			f := st.Field(i)
			if !f.IsExported() {
				continue
			}
			jsonName := strings.Split(f.Tag.Get("json"), ",")[0]
			if jsonName == "-" {
				continue
			}
			if jsonName == "" {
				jsonName = f.Name
			}
			doc.Fields = append(doc.Fields, AppModelField{
				Name: jsonName,
				Type: typeName(f.Type),
			})
		}
		out = append(out, doc)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

var (
	// 'view-id' members of the ViewId union in navigation.ts.
	viewIDPattern = regexp.MustCompile(`\|\s*'([a-z][a-z0-9-]*)'`)
	// {id: 'view-id', label: 'Label', ...} nav entries in navigation.ts
	// (single- or multi-line).
	navEntryPattern = regexp.MustCompile(`\{\s*id:\s*'([a-z][a-z0-9-]*)',\s*label:\s*'([^']+)'`)
)

// appPageDocs parses the embedded navigation source: every routable view id,
// with its sidebar label when the view has a nav entry.
func appPageDocs() []AppPageDoc {
	labels := map[string]string{}
	for _, m := range navEntryPattern.FindAllStringSubmatch(navigationSource, -1) {
		labels[m[1]] = m[2]
	}
	out := []AppPageDoc{}
	seen := map[string]bool{}
	for _, m := range viewIDPattern.FindAllStringSubmatch(navigationSource, -1) {
		id := m[1]
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, AppPageDoc{ID: id, Sidebar: labels[id]})
	}
	return out
}

// AppDocsSearchResult groups the doc entries matching a query.
type AppDocsSearchResult struct {
	Functions []AppFunctionDoc `json:"functions"`
	Models    []AppModelDoc    `json:"models"`
	Pages     []AppPageDoc     `json:"pages"`
}

// searchAppDocs returns the functions, models, and pages whose names (or
// model field names) contain the query, case-insensitively.
func searchAppDocs(query string) AppDocsSearchResult {
	q := strings.ToLower(strings.TrimSpace(query))
	out := AppDocsSearchResult{
		Functions: []AppFunctionDoc{},
		Models:    []AppModelDoc{},
		Pages:     []AppPageDoc{},
	}
	if q == "" {
		return out
	}
	for _, f := range appFunctionDocs() {
		if strings.Contains(strings.ToLower(f.Name), q) {
			out.Functions = append(out.Functions, f)
		}
	}
	for _, m := range appModelDocs() {
		if strings.Contains(strings.ToLower(m.Name), q) {
			out.Models = append(out.Models, m)
			continue
		}
		for _, f := range m.Fields {
			if strings.Contains(strings.ToLower(f.Name), q) {
				out.Models = append(out.Models, m)
				break
			}
		}
	}
	for _, p := range appPageDocs() {
		if strings.Contains(p.ID, q) ||
			strings.Contains(strings.ToLower(p.Sidebar), q) {
			out.Pages = append(out.Pages, p)
		}
	}
	return out
}

// AppDescription is the describe_app overview: what the app is (from the
// app-overview skill) plus the shape of the current build.
type AppDescription struct {
	Overview      string       `json:"overview"`
	Pages         []AppPageDoc `json:"pages"`
	FunctionCount int          `json:"functionCount"`
	ModelCount    int          `json:"modelCount"`
	Note          string       `json:"note"`
}

// DescribeApp assembles the high-level self-description: the app-overview
// skill's content, the routable pages, and counts pointing at the detailed
// doc tools. Everything is derived from the running build, so it stays
// current as the application expands.
func (a *App) DescribeApp() AppDescription {
	overview := ""
	if skill, err := a.getAppSkill("app-overview"); err == nil {
		overview = skill.Content
	}
	return AppDescription{
		Overview:      overview,
		Pages:         appPageDocs(),
		FunctionCount: len(appFunctionDocs()),
		ModelCount:    len(appModelDocs()),
		Note: "The function, model, and page lists are generated from this build's code " +
			"(reflection over the bound API and the embedded navigation source), so they " +
			"always describe the app as it currently is. Use list_app_functions, " +
			"list_app_models, list_app_pages, and search_app_docs for detail.",
	}
}

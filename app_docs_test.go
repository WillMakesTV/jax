package main

import "testing"

func TestAppFunctionDocs(t *testing.T) {
	docs := appFunctionDocs()
	if len(docs) == 0 {
		t.Fatal("no bound functions reflected")
	}
	byName := map[string]AppFunctionDoc{}
	for _, d := range docs {
		byName[d.Name] = d
	}
	// A known binding with typed params and results.
	got, ok := byName["GetDebugReport"]
	if !ok {
		t.Fatal("GetDebugReport missing from function docs")
	}
	if len(got.Params) != 1 || got.Params[0] != "int64" {
		t.Fatalf("GetDebugReport params = %v, want [int64]", got.Params)
	}
	if len(got.Results) != 2 || got.Results[0] != "DebugReport" {
		t.Fatalf("GetDebugReport results = %v, want [DebugReport error]", got.Results)
	}
}

func TestAppModelDocs(t *testing.T) {
	docs := appModelDocs()
	var report *AppModelDoc
	for i := range docs {
		if docs[i].Name == "DebugReport" {
			report = &docs[i]
			break
		}
	}
	if report == nil {
		t.Fatal("DebugReport missing from model docs")
	}
	fields := map[string]string{}
	for _, f := range report.Fields {
		fields[f.Name] = f.Type
	}
	// JSON names (not Go names), with their Go types.
	if fields["checkedOut"] != "bool" || fields["description"] != "string" {
		t.Fatalf("DebugReport fields wrong: %+v", report.Fields)
	}

	// Models reachable only through other models are found too: PastStream
	// carries PastBroadcast entries.
	found := false
	for _, d := range docs {
		if d.Name == "PastBroadcast" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("nested model PastBroadcast missing from model docs")
	}
}

func TestAppPageDocs(t *testing.T) {
	pages := appPageDocs()
	if len(pages) == 0 {
		t.Fatal("no pages parsed from navigation source")
	}
	byID := map[string]AppPageDoc{}
	for _, p := range pages {
		byID[p.ID] = p
	}
	if _, ok := byID["project-details"]; !ok {
		t.Fatalf("project-details missing from pages: %+v", pages)
	}
	if byID["dashboard"].Sidebar != "Dashboard" {
		t.Fatalf("dashboard sidebar label = %q, want Dashboard", byID["dashboard"].Sidebar)
	}
	// Views without a nav entry have no sidebar label.
	if byID["settings"].Sidebar != "Settings" {
		t.Fatalf("settings sidebar label = %q, want Settings", byID["settings"].Sidebar)
	}
	if byID["stream-details"].Sidebar != "" {
		t.Fatalf("stream-details should have no sidebar label: %+v", byID["stream-details"])
	}
}

func TestSearchAppDocs(t *testing.T) {
	hits := searchAppDocs("debugreport")
	if len(hits.Functions) == 0 {
		t.Fatal("searching debugreport should hit the debug-report functions")
	}
	if len(hits.Models) == 0 {
		t.Fatal("searching debugreport should hit the DebugReport model")
	}
	// Model field names match too.
	hits = searchAppDocs("checkedOut")
	if len(hits.Models) == 0 {
		t.Fatal("field-name search should hit models carrying the field")
	}
	// A blank query returns nothing rather than everything.
	if hits := searchAppDocs("  "); len(hits.Functions)+len(hits.Models)+len(hits.Pages) != 0 {
		t.Fatal("blank query should match nothing")
	}
}

func TestDescribeApp(t *testing.T) {
	a := newTestApp(t)
	desc := a.DescribeApp()
	if desc.FunctionCount == 0 || desc.ModelCount == 0 || len(desc.Pages) == 0 {
		t.Fatalf("describe_app is empty: %+v", desc)
	}
	if desc.Overview == "" {
		t.Fatal("describe_app should carry the app-overview skill content")
	}
}

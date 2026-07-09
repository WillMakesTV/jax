package main

import "testing"

// The skill catalog and the embedded skills/ folder must stay in lockstep:
// every catalog entry needs its markdown file, and every shipped file needs a
// catalog entry (otherwise it is invisible in Settings and over MCP).
func TestSkillCatalogMatchesEmbeddedFiles(t *testing.T) {
	ids := map[string]bool{}
	for _, def := range appSkillDefs {
		ids[def.ID] = true
		content, err := defaultSkillContent(def.ID)
		if err != nil {
			t.Errorf("skill %q: %v", def.ID, err)
		} else if content == "" {
			t.Errorf("skill %q: embedded default is empty", def.ID)
		}
	}

	entries, err := skillFiles.ReadDir("skills")
	if err != nil {
		t.Fatalf("reading embedded skills dir: %v", err)
	}
	for _, e := range entries {
		id := e.Name()[:len(e.Name())-len(".md")]
		if !ids[id] {
			t.Errorf("skills/%s is embedded but missing from appSkillDefs", e.Name())
		}
	}
}

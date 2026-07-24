package main

import (
	"math"
	"testing"
)

func TestVecBlobRoundtrip(t *testing.T) {
	v := []float32{0.5, -1.25, 3, 0, 42.125}
	got := blobVec(vecBlob(v))
	if len(got) != len(v) {
		t.Fatalf("length changed: %d != %d", len(got), len(v))
	}
	for i := range v {
		if got[i] != v[i] {
			t.Fatalf("value %d changed: %v != %v", i, got[i], v[i])
		}
	}
}

func TestCosine(t *testing.T) {
	a := []float32{1, 0, 0}
	if s := cosine(a, a); math.Abs(s-1) > 1e-6 {
		t.Fatalf("identical vectors should score 1, got %v", s)
	}
	if s := cosine(a, []float32{0, 1, 0}); math.Abs(s) > 1e-6 {
		t.Fatalf("orthogonal vectors should score 0, got %v", s)
	}
	// Same direction, different magnitude → still 1.
	if s := cosine(a, []float32{5, 0, 0}); math.Abs(s-1) > 1e-6 {
		t.Fatalf("collinear vectors should score 1, got %v", s)
	}
	// Mismatched lengths → 0, no panic.
	if s := cosine(a, []float32{1, 0}); s != 0 {
		t.Fatalf("mismatched lengths should score 0, got %v", s)
	}
}

func TestTakeawayVectorStore(t *testing.T) {
	a := newTestApp(t)

	rows := []takeawayVector{
		{VideoID: "v1", Title: "Cut on motion", Vec: []float32{1, 0, 0}},
		{VideoID: "v1", Title: "Hold the wide", Vec: []float32{0, 1, 0}},
	}
	if err := a.store.replaceTakeawayVectors("v1", rows); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, err := a.store.allTakeawayVectors()
	if err != nil {
		t.Fatalf("all: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 vectors, got %d", len(got))
	}
	if len(got[0].Vec) != 3 {
		t.Fatalf("vector not round-tripped: %+v", got[0].Vec)
	}
	ids, err := a.store.takeawayVectorVideoIDs()
	if err != nil {
		t.Fatalf("ids: %v", err)
	}
	if !ids["v1"] {
		t.Fatal("v1 should be reported as embedded")
	}

	// Replacing swaps the whole set for the video, not appends.
	if err := a.store.replaceTakeawayVectors("v1", rows[:1]); err != nil {
		t.Fatalf("replace 2: %v", err)
	}
	if got, _ := a.store.allTakeawayVectors(); len(got) != 1 {
		t.Fatalf("replace should not append, got %d", len(got))
	}

	if err := a.store.deleteTakeawayVectors("v1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got, _ := a.store.allTakeawayVectors(); len(got) != 0 {
		t.Fatalf("delete should empty the table, got %d", len(got))
	}
}

func TestSearchTakeawaysKeywordFallback(t *testing.T) {
	a := newTestApp(t)

	// No OpenAI connection in tests, so RAG is unavailable and search must
	// fall back to keyword ranking over the takeaways in the library.
	lib := a.getInspiration()
	lib.Videos = append(lib.Videos, InspirationVideo{
		ID: "v1", Title: "Editing rhythm", Status: inspirationReady,
		Takeaways: []InspirationTakeaway{
			{Kind: "technique", Title: "Cut on motion",
				Detail: "Match cuts to movement so the edit feels invisible.",
				Apply: "Time our cuts to the swing of the gameplay.", AtSecs: 30},
			{Kind: "concept", Title: "Colour grade cohesion",
				Detail: "A consistent grade ties disparate footage together."},
		},
	})
	if err := a.saveInspiration(lib); err != nil {
		t.Fatalf("save: %v", err)
	}

	hits, err := a.SearchTakeaways("cutting on motion", 5)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatal("expected a keyword takeaway hit")
	}
	if hits[0].Kind != "takeaway" {
		t.Fatalf("hits should be takeaways, got %q", hits[0].Kind)
	}
	if hits[0].VideoID != "v1" || hits[0].Citation == "" {
		t.Fatalf("hit should carry its video and a citation: %+v", hits[0])
	}
}

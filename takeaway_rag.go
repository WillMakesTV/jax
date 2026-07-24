package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Takeaway RAG
//
// Inspiration takeaways are embedded into a vector database (the
// inspiration_takeaway_vectors table, see store.go) so the library can be
// retrieved by meaning rather than by keyword. Embedding needs the raw OpenAI
// API (an API-key connection — the account/Codex mode exposes no embeddings
// endpoint), so it is strictly best-effort: without it, every retrieval falls
// back to the existing BM25 keyword search over the same takeaways, and
// nothing breaks. The retrieval helpers here are the "RAG for anywhere they
// are needed" — the search tool, the video-style brief, and callers to come.
// ---------------------------------------------------------------------------

const (
	openaiEmbeddingsURL = "https://api.openai.com/v1/embeddings"
	// takeawayEmbedModel is OpenAI's small embedding model — cheap, 1536-dim,
	// plenty for ranking short takeaways.
	takeawayEmbedModel = "text-embedding-3-small"
)

// takeawayVector is one takeaway's embedding plus the denormalised text it was
// built from, so a search reads only the vector table.
type takeawayVector struct {
	VideoID    string
	Kind       string
	AtSecs     int
	Title      string
	Detail     string
	Apply      string
	ChannelID  string
	VideoTitle string
	VideoURL   string
	Model      string
	Vec        []float32
}

// takeawayText is the passage a takeaway is embedded and matched as — the same
// join the keyword index uses, so the two rank comparable text.
func takeawayText(title, detail, apply string) string {
	return strings.TrimSpace(title + ". " + detail + " " + apply)
}

// vecBlob / blobVec store a float32 vector as little-endian bytes.
func vecBlob(v []float32) []byte {
	b := make([]byte, 4*len(v))
	for i, f := range v {
		binary.LittleEndian.PutUint32(b[i*4:], math.Float32bits(f))
	}
	return b
}

func blobVec(b []byte) []float32 {
	v := make([]float32, len(b)/4)
	for i := range v {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return v
}

// cosine is the cosine similarity of two vectors (0 when either is empty or a
// zero vector, or their lengths differ).
func cosine(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

// embedTexts embeds a batch of strings via the OpenAI embeddings API. It works
// only in API-key mode (openaiAuthHeaders errors otherwise), which is what
// makes RAG optional.
func (a *App) embedTexts(ctx context.Context, texts []string) ([][]float32, error) {
	headers, err := a.openaiAuthHeaders()
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{
		"model": takeawayEmbedModel,
		"input": texts,
	})
	if err != nil {
		return nil, err
	}
	headers["Content-Type"] = "application/json"
	raw, err := postAI(ctx, openaiEmbeddingsURL, headers, body, "OpenAI")
	if err != nil {
		return nil, err
	}
	var r struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	out := make([][]float32, len(texts))
	for _, d := range r.Data {
		if d.Index >= 0 && d.Index < len(out) {
			out[d.Index] = d.Embedding
		}
	}
	for i := range out {
		if len(out[i]) == 0 {
			return nil, fmt.Errorf("the embeddings response was incomplete")
		}
	}
	return out, nil
}

// embedInspirationTakeaways embeds a studied video's takeaways and stores the
// vectors. Best-effort: without an API-key OpenAI connection it logs and
// returns, leaving keyword search to cover the video.
func (a *App) embedInspirationTakeaways(id string) {
	if a.store == nil {
		return
	}
	video, err := a.GetInspirationVideo(id)
	if err != nil || len(video.Takeaways) == 0 {
		return
	}
	texts := make([]string, len(video.Takeaways))
	for i, t := range video.Takeaways {
		texts[i] = takeawayText(t.Title, t.Detail, t.Apply)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	vecs, err := a.embedTexts(ctx, texts)
	if err != nil {
		log.Printf("jax: takeaway embeddings %s: %v", id, err)
		return
	}
	rows := make([]takeawayVector, 0, len(vecs))
	for i, t := range video.Takeaways {
		rows = append(rows, takeawayVector{
			VideoID: video.ID, Kind: t.Kind, AtSecs: t.AtSecs,
			Title: t.Title, Detail: t.Detail, Apply: t.Apply,
			ChannelID: video.ChannelID, VideoTitle: video.Title, VideoURL: video.URL,
			Model: takeawayEmbedModel, Vec: vecs[i],
		})
	}
	if err := a.store.replaceTakeawayVectors(video.ID, rows); err != nil {
		log.Printf("jax: store takeaway vectors %s: %v", id, err)
	}
}

// backfillInspirationEmbeddings embeds the takeaways of studied videos that
// have none stored yet — run at launch so a library built before RAG existed,
// or before OpenAI was connected, fills itself in. A no-op without the raw API.
func (a *App) backfillInspirationEmbeddings() {
	if a.store == nil {
		return
	}
	if _, err := a.openaiAuthHeaders(); err != nil {
		return // account mode / not connected — keyword search covers it.
	}
	have, err := a.store.takeawayVectorVideoIDs()
	if err != nil {
		log.Printf("jax: takeaway vectors: %v", err)
		return
	}
	for _, v := range a.getInspiration().Videos {
		if a.ctx == nil {
			return
		}
		if len(v.Takeaways) == 0 || have[v.ID] {
			continue
		}
		a.embedInspirationTakeaways(v.ID)
	}
}

// ragTakeawayRows ranks the stored takeaway vectors by cosine similarity to the
// query. ok is false when RAG is unavailable — no API key, nothing embedded,
// or the query could not be embedded — so the caller falls back to keywords.
func (a *App) ragTakeawayRows(query string, limit int) ([]takeawayVector, bool) {
	if a.store == nil {
		return nil, false
	}
	if _, err := a.openaiAuthHeaders(); err != nil {
		return nil, false
	}
	vectors, err := a.store.allTakeawayVectors()
	if err != nil || len(vectors) == 0 {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	qv, err := a.embedTexts(ctx, []string{query})
	if err != nil || len(qv) == 0 {
		return nil, false
	}
	type scored struct {
		row   takeawayVector
		score float64
	}
	ranked := make([]scored, 0, len(vectors))
	for _, r := range vectors {
		ranked = append(ranked, scored{row: r, score: cosine(qv[0], r.Vec)})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	if limit <= 0 || limit > len(ranked) {
		limit = len(ranked)
	}
	out := make([]takeawayVector, 0, limit)
	for _, s := range ranked[:limit] {
		out = append(out, s.row)
	}
	return out, true
}

// SearchTakeaways ranks the library's takeaways against a query — by meaning
// (RAG) when embeddings are available, else by the keyword search over the same
// takeaways. Each hit carries a ready-to-quote citation.
func (a *App) SearchTakeaways(query string, limit int) ([]InspirationSearchHit, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []InspirationSearchHit{}, nil
	}
	if limit <= 0 {
		limit = 10
	}
	if rows, ok := a.ragTakeawayRows(query, limit); ok {
		names := map[string]string{}
		for _, c := range a.getInspiration().Channels {
			names[c.ID] = c.Name
		}
		out := make([]InspirationSearchHit, 0, len(rows))
		for _, r := range rows {
			h := InspirationSearchHit{
				VideoID: r.VideoID, Title: r.VideoTitle, URL: r.VideoURL,
				ChannelID: r.ChannelID, Channel: names[r.ChannelID],
				Kind: "takeaway", AtSecs: r.AtSecs,
				Text: takeawayText(r.Title, r.Detail, r.Apply),
			}
			h.Citation = inspirationCitation(h)
			out = append(out, h)
		}
		return out, nil
	}

	// Fallback: keyword search over the library, takeaway passages only.
	all, err := a.SearchInspiration(query, limit*4)
	if err != nil {
		return nil, err
	}
	out := []InspirationSearchHit{}
	for _, h := range all {
		if h.Kind != "takeaway" {
			continue
		}
		out = append(out, h)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

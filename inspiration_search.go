package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// Inspiration search
//
// The retrieval half of the reference library: everything the pipeline
// derived from a video — its summary, outline, beats, takeaways, links,
// mentions, description, and transcript — is chunked and ranked against a
// query so an MCP client can pull references and cite them.
//
// The ranking is BM25 over the library itself rather than an embedding
// service: the library lives entirely on this machine, the app's AI runner
// may be signed in to an account (Claude Code / Codex) that exposes no
// embeddings endpoint at all, and a query has to work with no network. Every
// hit carries the video, the moment inside it, and a citation URL, which is
// what the caller actually needs back.
// ---------------------------------------------------------------------------

// inspirationChunkSecs is how much transcript one chunk covers. Long enough
// to hold a thought, short enough that the timestamp still points at it.
const inspirationChunkSecs = 45

// InspirationSearchHit is one passage of a studied video that matched a query.
type InspirationSearchHit struct {
	VideoID   string `json:"videoId"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	ChannelID string `json:"channelId"`
	Channel   string `json:"channel"`
	// Kind names the part of the study notes the passage came from:
	// summary | outline | beat | takeaway | mention | link | description |
	// transcript.
	Kind string `json:"kind"`
	// AtSecs is where in the video the passage is, or -1 when it belongs to
	// the video as a whole.
	AtSecs int     `json:"atSecs"`
	Text   string  `json:"text"`
	Score  float64 `json:"score"`
	// Citation is the passage's reference, ready to quote: the video, the
	// moment, and a URL that opens there.
	Citation string `json:"citation"`
}

// inspirationChunk is one searchable passage before it is scored.
type inspirationChunk struct {
	video  *InspirationVideo
	kind   string
	atSecs int
	text   string
	terms  []string
}

// inspirationStopWords are the words too common to tell two passages apart.
var inspirationStopWords = map[string]bool{
	"a": true, "about": true, "all": true, "an": true, "and": true, "are": true,
	"as": true, "at": true, "be": true, "been": true, "but": true, "by": true,
	"can": true, "do": true, "for": true, "from": true, "get": true, "go": true,
	"had": true, "has": true, "have": true, "he": true, "her": true, "his": true,
	"how": true, "i": true, "if": true, "in": true, "into": true, "is": true,
	"it": true, "its": true, "just": true, "like": true, "me": true, "my": true,
	"no": true, "not": true, "of": true, "on": true, "one": true, "or": true,
	"our": true, "out": true, "so": true, "that": true, "the": true, "their": true,
	"them": true, "then": true, "there": true, "they": true, "this": true,
	"to": true, "up": true, "was": true, "we": true, "were": true, "what": true,
	"when": true, "which": true, "who": true, "will": true, "with": true,
	"you": true, "your": true,
}

// inspirationTerms lowercases a passage and keeps the words worth matching on.
func inspirationTerms(text string) []string {
	fields := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9')
	})
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if len(f) < 2 || inspirationStopWords[f] {
			continue
		}
		// Fold the plural so "hooks" finds "hook".
		if len(f) > 3 && strings.HasSuffix(f, "s") && !strings.HasSuffix(f, "ss") {
			f = f[:len(f)-1]
		}
		out = append(out, f)
	}
	return out
}

// inspirationChunks flattens the library into searchable passages. Only
// videos that have been studied carry derived content; a tracked video still
// contributes its title and description.
func (a *App) inspirationChunks() []inspirationChunk {
	lib := a.getInspiration()
	chunks := []inspirationChunk{}
	add := func(v *InspirationVideo, kind string, at int, text string) {
		text = strings.TrimSpace(text)
		if text == "" {
			return
		}
		terms := inspirationTerms(v.Title + " " + text)
		if len(terms) == 0 {
			return
		}
		chunks = append(chunks, inspirationChunk{
			video: v, kind: kind, atSecs: at, text: text, terms: terms,
		})
	}

	for i := range lib.Videos {
		v := &lib.Videos[i]
		add(v, "summary", -1, v.Summary)
		add(v, "description", -1, v.Description)
		if v.Outline != "" {
			// The outline is markdown with '## mm:ss — Section' headings;
			// each section is its own passage so a hit points at one.
			for _, section := range splitOutlineSections(v.Outline) {
				add(v, "outline", section.atSecs, section.text)
			}
		}
		for _, b := range v.Beats {
			add(v, "beat", b.AtSecs, strings.TrimSpace(b.Title+". "+b.Summary))
		}
		for _, t := range v.Takeaways {
			add(v, "takeaway", t.AtSecs, strings.TrimSpace(
				t.Title+". "+t.Detail+" "+t.Apply))
		}
		for _, m := range v.Mentions {
			add(v, "mention", m.AtSecs, strings.TrimSpace(
				m.Name+" ("+m.Kind+"). "+m.Detail))
		}
		for _, l := range v.Links {
			add(v, "link", -1, strings.TrimSpace(l.Label+" "+l.URL))
		}
		for _, c := range chunkTranscript(v.Transcript) {
			add(v, "transcript", c.atSecs, c.text)
		}
	}
	return chunks
}

// outlineSection is one '## mm:ss — Section' block of a video's outline.
type outlineSection struct {
	atSecs int
	text   string
}

// splitOutlineSections breaks an outline into its headed sections, reading
// the timestamp out of each heading when it has one.
func splitOutlineSections(outline string) []outlineSection {
	out := []outlineSection{}
	cur := outlineSection{atSecs: -1}
	flush := func() {
		if strings.TrimSpace(cur.text) != "" {
			out = append(out, cur)
		}
	}
	for _, line := range strings.Split(outline, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			flush()
			cur = outlineSection{atSecs: parseClock(line), text: line}
			continue
		}
		cur.text += "\n" + line
	}
	flush()
	if len(out) == 0 {
		return []outlineSection{{atSecs: -1, text: outline}}
	}
	return out
}

// parseClock reads the first h:mm:ss or m:ss in a line, or -1 when it has
// none — the inverse of formatClock, for outline headings.
func parseClock(line string) int {
	digits, parts := "", []int{}
	flush := func() {
		if digits == "" {
			return
		}
		n := 0
		for _, r := range digits {
			n = n*10 + int(r-'0')
		}
		parts = append(parts, n)
		digits = ""
	}
	for _, r := range line {
		switch {
		case r >= '0' && r <= '9':
			digits += string(r)
		case r == ':':
			flush()
		default:
			flush()
			if len(parts) >= 2 {
				secs := 0
				for _, p := range parts {
					secs = secs*60 + p
				}
				return secs
			}
			parts = nil
		}
	}
	flush()
	if len(parts) >= 2 {
		secs := 0
		for _, p := range parts {
			secs = secs*60 + p
		}
		return secs
	}
	return -1
}

// transcriptChunk is a window of transcript lines read as one passage.
type transcriptChunk struct {
	atSecs int
	text   string
}

// chunkTranscript groups utterances into fixed windows so a hit lands on a
// passage rather than a single half-sentence.
func chunkTranscript(lines []InspirationLine) []transcriptChunk {
	out := []transcriptChunk{}
	cur := transcriptChunk{atSecs: -1}
	for _, l := range lines {
		at := int(l.AtSecs)
		if cur.atSecs < 0 {
			cur = transcriptChunk{atSecs: at}
		}
		if at-cur.atSecs >= inspirationChunkSecs && cur.text != "" {
			out = append(out, cur)
			cur = transcriptChunk{atSecs: at}
		}
		if cur.text != "" {
			cur.text += " "
		}
		cur.text += strings.TrimSpace(l.Text)
	}
	if strings.TrimSpace(cur.text) != "" {
		out = append(out, cur)
	}
	return out
}

// SearchInspiration ranks the studied library against a query and returns the
// best passages, each with the video it came from and a citation. limit
// defaults to 10 and is capped at 50.
func (a *App) SearchInspiration(query string, limit int) ([]InspirationSearchHit, error) {
	terms := inspirationTerms(query)
	if len(terms) == 0 {
		return nil, fmt.Errorf("search for a word or two — %q has nothing to match on", query)
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	chunks := a.inspirationChunks()
	if len(chunks) == 0 {
		return []InspirationSearchHit{}, nil
	}

	// BM25 over the library: how often a term shows up in a passage, damped
	// by how common it is across the whole library and by passage length.
	const k1, b = 1.2, 0.75
	docFreq := map[string]int{}
	total := 0
	for i := range chunks {
		total += len(chunks[i].terms)
		seen := map[string]bool{}
		for _, t := range chunks[i].terms {
			if !seen[t] {
				seen[t] = true
				docFreq[t]++
			}
		}
	}
	avgLen := float64(total) / float64(len(chunks))
	phrase := strings.ToLower(strings.TrimSpace(query))

	hits := []InspirationSearchHit{}
	for i := range chunks {
		c := &chunks[i]
		counts := map[string]int{}
		for _, t := range c.terms {
			counts[t]++
		}
		score := 0.0
		matched := 0
		for _, q := range terms {
			f := float64(counts[q])
			if f == 0 {
				continue
			}
			matched++
			df := float64(docFreq[q])
			idf := math.Log(1 + (float64(len(chunks))-df+0.5)/(df+0.5))
			norm := 1 - b + b*float64(len(c.terms))/avgLen
			score += idf * (f * (k1 + 1)) / (f + k1*norm)
		}
		if matched == 0 {
			continue
		}
		// Every term present beats a passage that only caught one of them,
		// and the phrase verbatim beats both.
		score *= 1 + float64(matched-1)/float64(len(terms))
		if len(terms) > 1 && strings.Contains(strings.ToLower(c.text), phrase) {
			score *= 1.5
		}
		hits = append(hits, InspirationSearchHit{
			VideoID:   c.video.ID,
			Title:     c.video.Title,
			URL:       c.video.URL,
			ChannelID: c.video.ChannelID,
			Kind:      c.kind,
			AtSecs:    c.atSecs,
			Text:      c.text,
			Score:     score,
		})
	}
	if len(hits) == 0 {
		return []InspirationSearchHit{}, nil
	}

	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Score != hits[j].Score {
			return hits[i].Score > hits[j].Score
		}
		return hits[i].AtSecs < hits[j].AtSecs
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}

	names := map[string]string{}
	for _, ch := range a.getInspiration().Channels {
		names[ch.ID] = ch.Name
	}
	for i := range hits {
		hits[i].Channel = names[hits[i].ChannelID]
		hits[i].Citation = inspirationCitation(hits[i])
	}
	return hits, nil
}

// inspirationCitation renders a hit as the reference a reply can quote.
func inspirationCitation(h InspirationSearchHit) string {
	out := h.Title
	if h.Channel != "" {
		out += " — " + h.Channel
	}
	if h.AtSecs >= 0 {
		out += " @ " + formatClock(h.AtSecs)
	}
	if h.URL != "" {
		url := h.URL
		if h.AtSecs > 0 {
			sep := "?"
			if strings.Contains(url, "?") {
				sep = "&"
			}
			url += fmt.Sprintf("%st=%ds", sep, h.AtSecs)
		}
		out += " (" + url + ")"
	}
	return out
}

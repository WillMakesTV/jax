package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Publishing a produced video to YouTube
//
// A video plan's rendered output (edit/final.mp4) uploads to the connected
// YouTube channel via the resumable videos.insert flow, with the title,
// description, tags, and category set on the way in and the plan's thumbnail
// pushed right after (thumbnails.set, same payload rules as stream
// thumbnails). Descriptions are drafted like Plan-a-Broadcast descriptions —
// skill-guided, grounded in the source streams' outlines — with the
// "video-descriptions" skill requiring the original full-length broadcast
// link(s) above the brand links.
//
// One publish runs at a time; progress is reported via "publish:progress"
// (planID, detail) events. The publish record and the in-progress form draft
// persist per plan so navigation loses nothing.
// ---------------------------------------------------------------------------

const (
	keyVideoPublish       = "video_plan_publish"
	keyVideoPublishDrafts = "video_plan_publish_drafts"

	youtubeVideosInsertURL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
	youtubeWatchURL        = "https://www.youtube.com/watch?v="
)

// videoUploadHTTP carries the video upload itself: no timeout — a long video
// on a slow link can legitimately take an hour.
var videoUploadHTTP = &http.Client{}

// VideoPublishDraft is the publish form's in-progress state, persisted per
// plan so a half-written description survives navigation.
type VideoPublishDraft struct {
	Output      string   `json:"output"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	CategoryID  string   `json:"categoryId"`
	Privacy     string   `json:"privacy"` // "public" | "unlisted" | "private"
}

// VideoPublishRecord is one completed publish: which output went up, as what,
// and where it lives now.
type VideoPublishRecord struct {
	VideoID     string `json:"videoId"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	File        string `json:"file"`        // output name uploaded (e.g. final.mp4)
	PublishedAt string `json:"publishedAt"` // RFC3339
	ThumbPushed bool   `json:"thumbPushed"`
	// Warning carries a non-fatal follow-up (e.g. the thumbnail push failed);
	// transient, never persisted.
	Warning string `json:"warning"`
}

// VideoPublishState is everything the publish form needs on mount.
type VideoPublishState struct {
	Draft  *VideoPublishDraft  `json:"draft"`
	Record *VideoPublishRecord `json:"record"`
	// Publishing reports an upload in flight for this plan.
	Publishing bool `json:"publishing"`
	// DefaultCategoryID suggests a category when no draft carries one: the
	// YouTube category of the first source stream's content series.
	DefaultCategoryID string `json:"defaultCategoryId"`
}

// videoPublishRecords loads the planID → publish record map. Never nil.
func (a *App) videoPublishRecords() map[string]VideoPublishRecord {
	m := map[string]VideoPublishRecord{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyVideoPublish, &m); err != nil {
			log.Printf("jax: load video publishes: %v", err)
		}
	}
	if m == nil {
		return map[string]VideoPublishRecord{}
	}
	return m
}

// videoPublishDrafts loads the planID → form draft map. Never nil.
func (a *App) videoPublishDrafts() map[string]VideoPublishDraft {
	m := map[string]VideoPublishDraft{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyVideoPublishDrafts, &m); err != nil {
			log.Printf("jax: load video publish drafts: %v", err)
		}
	}
	if m == nil {
		return map[string]VideoPublishDraft{}
	}
	return m
}

// GetVideoPublish reports a plan's publish state: the saved form draft, the
// publish record when the video is already up, and a category suggestion.
func (a *App) GetVideoPublish(planID string) VideoPublishState {
	state := VideoPublishState{}
	if d, ok := a.videoPublishDrafts()[planID]; ok {
		state.Draft = &d
	}
	if r, ok := a.videoPublishRecords()[planID]; ok {
		state.Record = &r
	}
	a.mu.Lock()
	state.Publishing = a.publishingPlan == planID
	a.mu.Unlock()

	// Suggest the category of the first source stream's series.
	if plan, err := a.findVideoPlan(planID); err == nil {
		series := a.GetContentSeries()
	sources:
		for _, s := range a.resolveEditSources(plan) {
			if s.stream == nil || s.stream.SeriesID == "" {
				continue
			}
			for _, cs := range series {
				if cs.ID == s.stream.SeriesID && cs.YouTubeCategory.ID != "" {
					state.DefaultCategoryID = cs.YouTubeCategory.ID
					break sources
				}
			}
		}
	}
	return state
}

// SaveVideoPublishDraft persists the publish form's in-progress state.
func (a *App) SaveVideoPublishDraft(planID string, draft VideoPublishDraft) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	if draft.Tags == nil {
		draft.Tags = []string{}
	}
	drafts := a.videoPublishDrafts()
	drafts[planID] = draft
	return a.store.setJSON(keyVideoPublishDrafts, drafts)
}

// emitPublishProgress forwards one upload progress line to the frontend.
func (a *App) emitPublishProgress(planID, detail string) {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "publish:progress", planID, detail)
	}
}

// progressReader reports whole-percent progress while the upload body drains.
type progressReader struct {
	r       io.Reader
	total   int64
	read    int64
	lastPct int
	report  func(pct int)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.read += int64(n)
	if p.total > 0 && p.report != nil {
		if pct := int(p.read * 100 / p.total); pct != p.lastPct {
			p.lastPct = pct
			p.report(pct)
		}
	}
	return n, err
}

// PublishPlanVideo uploads one of the plan's rendered outputs to YouTube with
// the given metadata, pushes the plan's thumbnail onto the new video, and
// records the publish. Progress arrives as "publish:progress" events; the
// call returns when everything finished. One publish runs at a time.
func (a *App) PublishPlanVideo(planID, output, title, description string, tags []string, categoryID, privacy string) (VideoPublishRecord, error) {
	var rec VideoPublishRecord
	title = strings.TrimSpace(title)
	if title == "" {
		return rec, fmt.Errorf("give the video a title first")
	}
	switch privacy {
	case "public", "unlisted", "private":
	default:
		privacy = "public"
	}

	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return rec, err
	}
	output = filepath.Base(strings.TrimSpace(output))
	path := filepath.Join(a.editWorkspaceDir(planID), "edit", output)
	fi, err := os.Stat(path)
	if err != nil || fi.IsDir() {
		return rec, fmt.Errorf("no rendered %q in the plan's workspace — run an edit session first", output)
	}

	conn, ok := a.freshConn("youtube")
	if !ok {
		return rec, fmt.Errorf("connect YouTube in Settings → Services first")
	}

	a.mu.Lock()
	if a.publishingPlan != "" {
		busy := a.publishingPlan
		a.mu.Unlock()
		return rec, fmt.Errorf("another publish is already uploading (plan %s) — wait for it to finish", busy)
	}
	a.publishingPlan = planID
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.publishingPlan = ""
		a.mu.Unlock()
	}()

	// Start a resumable session: metadata goes in the opening request, the
	// session URL comes back in the Location header.
	snippet := map[string]any{"title": title, "description": description}
	if len(tags) > 0 {
		snippet["tags"] = tags
	}
	if categoryID != "" {
		snippet["categoryId"] = categoryID
	}
	body, err := json.Marshal(map[string]any{
		"snippet": snippet,
		"status": map[string]any{
			"privacyStatus":           privacy,
			"selfDeclaredMadeForKids": false,
		},
	})
	if err != nil {
		return rec, err
	}
	a.emitPublishProgress(planID, "Starting the upload…")
	initReq, err := http.NewRequest(http.MethodPost, youtubeVideosInsertURL, bytes.NewReader(body))
	if err != nil {
		return rec, err
	}
	initReq.Header.Set("Authorization", "Bearer "+conn.token)
	initReq.Header.Set("Content-Type", "application/json")
	initReq.Header.Set("X-Upload-Content-Type", "video/mp4")
	initReq.Header.Set("X-Upload-Content-Length", fmt.Sprint(fi.Size()))
	initResp, err := httpClient.Do(initReq)
	if err != nil {
		return rec, fmt.Errorf("the upload could not be started: %v", err)
	}
	initBody, _ := io.ReadAll(initResp.Body)
	initResp.Body.Close()
	if initResp.StatusCode < 200 || initResp.StatusCode > 299 {
		if initResp.StatusCode == 401 || initResp.StatusCode == 403 {
			return rec, fmt.Errorf("YouTube: reconnect in Settings → Services to grant the upload permission")
		}
		return rec, fmt.Errorf("YouTube rejected the upload request (%d): %s",
			initResp.StatusCode, truncateErr(string(initBody)))
	}
	uploadURL := initResp.Header.Get("Location")
	if uploadURL == "" {
		return rec, fmt.Errorf("YouTube did not open an upload session — try again")
	}

	// Stream the file up, reporting whole-percent progress.
	f, err := os.Open(path)
	if err != nil {
		return rec, err
	}
	defer f.Close()
	pr := &progressReader{
		r: f, total: fi.Size(), lastPct: -1,
		report: func(pct int) {
			a.emitPublishProgress(planID, fmt.Sprintf("Uploading %s — %d%%", output, pct))
		},
	}
	upReq, err := http.NewRequest(http.MethodPut, uploadURL, pr)
	if err != nil {
		return rec, err
	}
	upReq.ContentLength = fi.Size()
	upReq.Header.Set("Authorization", "Bearer "+conn.token)
	upReq.Header.Set("Content-Type", "video/mp4")
	upResp, err := videoUploadHTTP.Do(upReq)
	if err != nil {
		return rec, fmt.Errorf("the upload failed: %v", err)
	}
	upBody, _ := io.ReadAll(upResp.Body)
	upResp.Body.Close()
	if upResp.StatusCode < 200 || upResp.StatusCode > 299 {
		return rec, fmt.Errorf("YouTube rejected the video (%d): %s",
			upResp.StatusCode, truncateErr(string(upBody)))
	}
	var uploaded struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(upBody, &uploaded); err != nil || uploaded.ID == "" {
		return rec, fmt.Errorf("YouTube accepted the upload but returned no video id — check YouTube Studio")
	}

	rec = VideoPublishRecord{
		VideoID:     uploaded.ID,
		URL:         youtubeWatchURL + uploaded.ID,
		Title:       title,
		File:        output,
		PublishedAt: time.Now().UTC().Format(time.RFC3339),
	}

	// The plan's thumbnail rides onto the new video; a failure here is a
	// warning, not a failed publish — the video is already up.
	if plan.ThumbnailFile != "" {
		a.emitPublishProgress(planID, "Setting the thumbnail…")
		if err := a.pushThumbToVideo(conn.token, uploaded.ID, plan.ThumbnailFile); err != nil {
			rec.Warning = fmt.Sprintf("The video is published, but the thumbnail could not be set: %v", err)
		} else {
			rec.ThumbPushed = true
		}
	}

	if a.store != nil {
		records := a.videoPublishRecords()
		persisted := rec
		persisted.Warning = ""
		records[planID] = persisted
		if err := a.store.setJSON(keyVideoPublish, records); err != nil {
			log.Printf("jax: record video publish: %v", err)
		}
	}
	a.emitPublishProgress(planID, "")
	return rec, nil
}

// pushThumbToVideo sets a plan-thumbs image as a YouTube video's thumbnail
// (thumbnails.set, with the oversize re-encoding youtubeThumbPayload does).
func (a *App) pushThumbToVideo(token, videoID, thumbFile string) error {
	dir, err := planThumbsDir()
	if err != nil {
		return err
	}
	data, contentType, err := youtubeThumbPayload(filepath.Join(dir, filepath.Base(thumbFile)))
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, youtubeThumbSetURL+url.QueryEscape(videoID), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", contentType)
	resp, err := thumbUploadHTTP.Do(req)
	if err != nil {
		return err
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("thumbnails.set failed (%d): %s", resp.StatusCode, truncateErr(string(body)))
	}
	return nil
}

// truncateErr keeps an API error body short enough for a message.
func truncateErr(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 300 {
		return s[:300]
	}
	return s
}

// ---------------------------------------------------------------------------
// Description drafting for published videos
// ---------------------------------------------------------------------------

// videoDescriptionSkillID is the Application Skill guiding published-video
// descriptions (user-tunable in Settings → Skills). Its rules put the
// original full-length broadcast link(s) above the brand links.
const videoDescriptionSkillID = "video-descriptions"

// videoDescriptionStyleGuide renders the skill as the prompt's style-guide
// section ("" if the skill can't be read).
func (a *App) videoDescriptionStyleGuide() string {
	skill, err := a.getAppSkill(videoDescriptionSkillID)
	if err != nil || strings.TrimSpace(skill.Content) == "" {
		return ""
	}
	return "\n\n# Description style guide\n" + skill.Content
}

// videoPublishPrepSkillID guides the publish form's AI drafting (user-tunable
// in Settings → Skills → "Preparing videos to publish").
const videoPublishPrepSkillID = "video-publish-prep"

// publishFields are the form fields the AI can draft, in prompt order.
var publishFields = []string{"title", "description", "tags", "category"}

// publishFieldKeys shape the JSON response to exactly the fields asked for.
var publishFieldKeys = map[string]string{
	"title":       `"title": "..."`,
	"description": `"description": "..."`,
	"tags":        `"tags": ["...", "..."]`,
	"category":    `"categoryId": "..."`,
}

// VideoPublishSuggestion is one AI pass over the publish form. Only the fields
// that were asked for come back filled — regenerating the title must not
// disturb a description the producer has already approved.
type VideoPublishSuggestion struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	CategoryID  string   `json:"categoryId"`
}

// originalBroadcastLines lists the YouTube watch URLs of the plan's source
// streams — the original full-length live videos ("" when none have one).
func (a *App) originalBroadcastLines(plan VideoPlan) string {
	var b strings.Builder
	for _, s := range a.resolveEditSources(plan) {
		if s.stream == nil {
			continue
		}
		for _, bc := range s.stream.Broadcasts {
			if bc.Platform != "youtube" || bc.URL == "" {
				continue
			}
			title := firstNonEmpty(s.stream.Title, s.ref.Title, "Untitled stream")
			if s.stream.EpisodeNumber > 0 {
				fmt.Fprintf(&b, "- EP%02d %s: %s\n", s.stream.EpisodeNumber, title, bc.URL)
			} else {
				fmt.Fprintf(&b, "- %s: %s\n", title, bc.URL)
			}
		}
	}
	return b.String()
}

// GenerateVideoPublishFields drafts the publish form: every field at once
// ("Generate with AI"), one field on its own (each field's own regenerate
// button), or a revision of the current values against the producer's feedback
// ("Request edits"). Fields names the subset to draft — title, description,
// tags, category — and an empty list means all of them. The prompt carries the
// plan, the source streams' overviews and outlines, the original broadcasts'
// URLs, the brand links, the YouTube categories to choose from, and whatever is
// already in the form; the "Preparing videos to publish" and "Published video
// descriptions" skills are the guides.
func (a *App) GenerateVideoPublishFields(planID string, draft VideoPublishDraft, fields []string, feedback string) (VideoPublishSuggestion, error) {
	var s VideoPublishSuggestion
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return s, err
	}

	// Resolve the requested fields; an empty (or unrecognized) list is the
	// whole form.
	wanted := map[string]bool{}
	for _, f := range fields {
		f = strings.ToLower(strings.TrimSpace(f))
		for _, known := range publishFields {
			if f == known {
				wanted[f] = true
			}
		}
	}
	if len(wanted) == 0 {
		for _, f := range publishFields {
			wanted[f] = true
		}
	}
	var asked, shape []string
	for _, f := range publishFields {
		if wanted[f] {
			asked = append(asked, f)
			shape = append(shape, publishFieldKeys[f])
		}
	}

	// The categories the model may choose from; without a YouTube connection
	// there are none to offer, so the category is simply left alone.
	var categories []ServiceCategory
	if wanted["category"] {
		if cats, err := a.GetYouTubeCategories(); err == nil {
			categories = cats
		}
	}

	system := "You help a creator publish a produced video to YouTube. The video was edited together from past live broadcasts.\n"
	if guide := a.skillText(videoPublishPrepSkillID); guide != "" {
		system += "\n# How to prepare the fields\n" + guide + "\n"
	}
	if wanted["description"] {
		system += a.videoDescriptionStyleGuide() + "\n"
	}
	system += fmt.Sprintf(
		"\nDraft only these fields: %s.\n\nRespond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:\n{%s}\n\nReturn exactly those keys and no others.",
		strings.Join(asked, ", "), strings.Join(shape, ", "))

	var b strings.Builder
	b.WriteString("# Video\n")
	fmt.Fprintf(&b, "Format: %s form\n", plan.Format)
	fmt.Fprintf(&b, "%s\n", runtimeTarget(plan.Format))
	if strings.TrimSpace(plan.Description) != "" {
		fmt.Fprintf(&b, "Plan description:\n%s\n", strings.TrimSpace(plan.Description))
	}
	if len(plan.Tags) > 0 {
		fmt.Fprintf(&b, "Plan tags: %s\n", strings.Join(plan.Tags, ", "))
	}
	b.WriteString("\n")
	b.WriteString(a.editSourceNotes(plan))
	if lines := a.originalBroadcastLines(plan); lines != "" {
		b.WriteString("\n# Original broadcasts\n")
		b.WriteString("The full-length live videos this video was edited from — the description links these directly above the brand links.\n")
		b.WriteString(lines)
	}
	if links := a.brandLinksText(); links != "" {
		b.WriteString("\n")
		b.WriteString(links)
	}

	// What is in the form right now: the fields being redrafted are the
	// starting point, and the ones that aren't are what the new text must stay
	// consistent with.
	b.WriteString("\n# The form as it stands\n")
	fmt.Fprintf(&b, "Title: %s\n", firstNonEmpty(strings.TrimSpace(draft.Title), plan.Title, "(empty)"))
	fmt.Fprintf(&b, "Tags: %s\n", firstNonEmpty(strings.Join(draft.Tags, ", "), "(empty)"))
	if id := draft.CategoryID; id != "" {
		fmt.Fprintf(&b, "Category id: %s\n", id)
	}
	if desc := strings.TrimSpace(draft.Description); desc != "" {
		fmt.Fprintf(&b, "Description:\n%s\n", desc)
	} else {
		b.WriteString("Description: (empty)\n")
	}

	if len(categories) > 0 {
		b.WriteString("\n# YouTube categories\n")
		b.WriteString("Pick \"categoryId\" from these ids — nothing else is assignable.\n")
		for _, c := range categories {
			fmt.Fprintf(&b, "- %s: %s\n", c.ID, c.Name)
		}
	}
	if strings.TrimSpace(feedback) != "" {
		fmt.Fprintf(&b, "\n# Producer feedback for this pass\n%s\n", strings.TrimSpace(feedback))
	}

	text, err := a.askAIText(system, b.String(), a.claudeMCPArgs(descriptionTools)...)
	if err != nil {
		return s, err
	}
	// Tolerate stray prose or fences around the JSON object.
	lo := strings.Index(text, "{")
	hi := strings.LastIndex(text, "}")
	if lo < 0 || hi <= lo {
		return s, fmt.Errorf("the model returned an unexpected format — try again")
	}
	if err := json.Unmarshal([]byte(text[lo:hi+1]), &s); err != nil {
		return s, fmt.Errorf("the model returned an unexpected format — try again")
	}

	s.Title = strings.TrimSpace(s.Title)
	s.Description = strings.TrimSpace(s.Description)
	if s.Tags == nil {
		s.Tags = []string{}
	}
	// A category the channel can't actually assign is worse than none.
	if s.CategoryID != "" && len(categories) > 0 {
		known := false
		for _, c := range categories {
			if c.ID == s.CategoryID {
				known = true
				break
			}
		}
		if !known {
			s.CategoryID = ""
		}
	}
	if s.Title == "" && s.Description == "" && len(s.Tags) == 0 && s.CategoryID == "" {
		return s, fmt.Errorf("the model returned an empty suggestion — try again")
	}
	return s, nil
}

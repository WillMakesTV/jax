package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Plan thumbnails
//
// A stream plan can carry a thumbnail image, generated from the plan's title
// and description. The "stream-thumbnails" Application Skill is the creative
// brief: its (user-editable) content goes to the image model as the style
// instructions. Requesting changes revises the current image with the
// feedback.
//
// Both OpenAI connection modes work, mirroring the text features (ai.go):
//   - API key    → the Images API directly (generate / edits endpoints);
//   - ChatGPT    → Codex headless in a scratch workspace, whose stable
//     image_generation tool writes the PNG — billed to the subscription,
//     no API key involved.
//
// Images live as PNGs under ~/.jax/plan_thumbs and are served by the local
// media server (planThumbsPrefix); plans persist only the file name.
// ---------------------------------------------------------------------------

const (
	openaiImagesURL     = "https://api.openai.com/v1/images/generations"
	openaiImageEditsURL = "https://api.openai.com/v1/images/edits"
	openaiImageModel    = "gpt-image-1"
	// The Images API sizes closest to the two shapes a thumbnail is ever in:
	// landscape for 16:9 (streams, long-form videos) and portrait for the 9:16
	// of a short. Nothing else the API offers is nearer either ratio.
	openaiImageSizeLandscape = "1536x1024"
	openaiImageSizePortrait  = "1024x1536"

	thumbnailSkillID = "stream-thumbnails"
	// projectImagesSkillID is the creative brief behind project cover images
	// (logo-style, led by the project's name — see skills/project-images.md).
	projectImagesSkillID = "project-images"
)

// thumbShape is the frame a thumbnail is composed in. A short's cover is seen
// on a phone, full-bleed vertical; a 16:9 image letterboxed into it wastes most
// of the frame, so the two are generated at different sizes and briefed
// differently.
type thumbShape struct {
	size   string // the Images API size
	aspect string // how the brief names it
	note   string // the composition brief for this frame
}

var (
	landscapeThumb = thumbShape{
		size:   openaiImageSizeLandscape,
		aspect: "16:9 landscape",
		note:   "This is a 16:9 landscape thumbnail — the standard YouTube/Twitch card. Compose for a wide frame.",
	}
	portraitThumb = thumbShape{
		size:   openaiImageSizePortrait,
		aspect: "9:16 vertical",
		note: "This is a 9:16 VERTICAL thumbnail — the cover of a short-form video, seen full-screen on a phone. " +
			"Compose for a tall frame: stack the elements vertically, keep the subject centred and large, and keep any text " +
			"big enough to read on a small screen. Do not compose a wide 16:9 image inside the tall frame, and leave the top " +
			"and bottom eighths clear of anything that must be seen — the platform's own UI sits there.",
	}
)

// thumbShapeForFormat picks the frame a video plan's thumbnail is composed in:
// a short is vertical, everything else is the usual 16:9 card.
func thumbShapeForFormat(format string) thumbShape {
	if format == "short" {
		return portraitThumb
	}
	return landscapeThumb
}

// PlanThumbnail is a generated thumbnail: the stored file name (persisted on
// the plan) and the served URL the frontend renders.
type PlanThumbnail struct {
	File string `json:"file"`
	URL  string `json:"url"`
}

// namedImage is an in-memory image with the file name the model sees.
type namedImage struct {
	name string
	data []byte
}

// maxBrandRefImages caps how many brand images ride along on a generation.
const maxBrandRefImages = 8

// brandImageExts are the brand-asset extensions usable as image references.
var brandImageExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true,
}

// brandThumbRefs loads the brand's image assets for use as generation
// references, plus a prompt section describing every brand asset (images and
// otherwise — a font or palette file's description still guides the model).
// Both are empty when no assets are defined.
func (a *App) brandThumbRefs() (images []namedImage, promptSection string) {
	assets := a.getBrandAssets()
	if len(assets) == 0 {
		return nil, ""
	}
	dir, err := brandAssetsDir()
	if err != nil {
		return nil, ""
	}
	var b strings.Builder
	b.WriteString("\n\n# Brand assets\n")
	b.WriteString("The creator's brand assets; the image files are provided as references.\n")
	for _, asset := range assets {
		fmt.Fprintf(&b, "- %s", asset.Name)
		if strings.TrimSpace(asset.Description) != "" {
			fmt.Fprintf(&b, " — %s", strings.TrimSpace(asset.Description))
		}
		b.WriteString("\n")
		if len(images) < maxBrandRefImages &&
			brandImageExts[strings.ToLower(filepath.Ext(asset.Name))] {
			if raw, err := os.ReadFile(filepath.Join(dir, asset.Name)); err == nil {
				images = append(images, namedImage{name: asset.Name, data: raw})
			}
		}
	}
	return images, b.String()
}

// maxThumbHistory caps how many previous thumbnails a plan remembers.
const maxThumbHistory = 12

// updateThumbHistory folds the previous thumbnail into the history when the
// thumbnail changes: newest first, the current file excluded, duplicates
// dropped, capped. Reverting to a history entry therefore pulls it out of
// the list and files the replaced image at the top. Never nil.
func updateThumbHistory(history []string, prevFile, newFile string) []string {
	out := []string{}
	seen := map[string]bool{newFile: true, "": true}
	add := func(f string) {
		if !seen[f] && len(out) < maxThumbHistory {
			seen[f] = true
			out = append(out, f)
		}
	}
	if prevFile != newFile {
		add(prevFile)
	}
	for _, f := range history {
		add(sanitizeThumbFile(f))
	}
	return out
}

// planThumbHistoryURLs resolves a history list to served URLs (same order).
func (a *App) planThumbHistoryURLs(history []string) []string {
	out := make([]string, len(history))
	for i, f := range history {
		out[i] = a.planThumbURL(f)
	}
	return out
}

// planThumbsDir returns ~/.jax/plan_thumbs, creating it if necessary.
func planThumbsDir() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	sub := filepath.Join(dir, "plan_thumbs")
	if err := os.MkdirAll(sub, 0o700); err != nil {
		return "", err
	}
	return sub, nil
}

// planThumbURL resolves a stored thumbnail file name to its served URL
// ("" when the plan has no thumbnail or the media server is down).
func (a *App) planThumbURL(file string) string {
	if file == "" {
		return ""
	}
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()
	if base == "" {
		return ""
	}
	return base + planThumbsPrefix + file
}

// UploadPlanThumbnail opens a native image picker and copies the chosen file
// into the plan-thumbnails folder, for plans whose thumbnail is hand-made
// rather than generated. Returns the zero value when the picker is cancelled.
func (a *App) UploadPlanThumbnail() (PlanThumbnail, error) {
	if a.ctx == nil {
		return PlanThumbnail{}, fmt.Errorf("no window context")
	}
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose a thumbnail image",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Images", Pattern: "*.png;*.jpg;*.jpeg;*.webp;*.gif"},
		},
	})
	if err != nil {
		return PlanThumbnail{}, err
	}
	if path == "" {
		return PlanThumbnail{}, nil // cancelled
	}
	return a.importPlanThumbnail(path)
}

// importPlanThumbnail copies an image file into the plan-thumbs folder and
// returns its thumbnail record. Shared by the upload dialog and the MCP
// set_plan_thumbnail tool.
func (a *App) importPlanThumbnail(path string) (PlanThumbnail, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if !brandImageExts[ext] {
		return PlanThumbnail{}, fmt.Errorf("pick an image file (png, jpg, jpeg, webp, or gif)")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return PlanThumbnail{}, fmt.Errorf("could not read %s: %v", filepath.Base(path), err)
	}
	dir, err := planThumbsDir()
	if err != nil {
		return PlanThumbnail{}, err
	}
	name := fmt.Sprintf("thumb_%d%s", time.Now().UnixNano(), ext)
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o600); err != nil {
		return PlanThumbnail{}, fmt.Errorf("could not save the thumbnail: %v", err)
	}
	return PlanThumbnail{File: name, URL: a.planThumbURL(name)}, nil
}

// GeneratePlanThumbnail creates (or revises) a plan thumbnail from the
// stream's title and description. With currentFile and feedback set, the
// existing image is edited following the feedback; otherwise a fresh image is
// generated. Returns the new file for the frontend to preview and store on
// the plan.
func (a *App) GeneratePlanThumbnail(title, description, feedback, currentFile string) (PlanThumbnail, error) {
	return a.generateThumbnail(title, description, "", feedback, currentFile, landscapeThumb)
}

// GenerateVideoPlanThumbnail creates (or revises) a video plan's thumbnail. It
// is the plan-aware counterpart of GeneratePlanThumbnail: the plan's format
// decides the frame, so a short's cover comes back 9:16 vertical and a
// long-form video's 16:9. Title and description come from the Publish form,
// which may have moved on from the plan's own.
func (a *App) GenerateVideoPlanThumbnail(planID, title, description, feedback, currentFile string) (PlanThumbnail, error) {
	plan, err := a.findVideoPlan(planID)
	if err != nil {
		return PlanThumbnail{}, err
	}
	return a.generateThumbnail(
		firstNonEmpty(strings.TrimSpace(title), plan.Title),
		firstNonEmpty(strings.TrimSpace(description), plan.Description),
		"", feedback, currentFile,
		thumbShapeForFormat(plan.Format),
	)
}

// GenerateProjectThumbnail creates (or revises) a project's cover image from
// its title and description. Same engine as the plan thumbnails; the context
// note keeps stream-specific dressing (LIVE badges, platform UI) out of what
// is a project cover, not a broadcast card.
func (a *App) GenerateProjectThumbnail(projectID, feedback, currentFile string) (PlanThumbnail, error) {
	for _, p := range a.getProjects() {
		if p.ID == projectID {
			// The project-images skill carries the whole brief (logo-style,
			// name + tagline), so no extra context note is needed.
			return a.generateThumbnailWithSkill(projectImagesSkillID, "Project",
				p.Title, p.Description, "", feedback, currentFile, landscapeThumb)
		}
	}
	return PlanThumbnail{}, fmt.Errorf("no project with id %q", projectID)
}

// generateThumbnail is the shared thumbnail engine behind plan and
// past-stream thumbnails: the "stream-thumbnails" skill brief, the title and
// description, an optional caller context section (e.g. "this is a finished
// VOD, no LIVE badges"), and — for revisions — the current image plus the
// feedback.
func (a *App) generateThumbnail(title, description, contextNote, feedback, currentFile string, shape thumbShape) (PlanThumbnail, error) {
	return a.generateThumbnailWithSkill(thumbnailSkillID, "Stream",
		title, description, contextNote, feedback, currentFile, shape)
}

// generateThumbnailWithSkill runs the image engine under a chosen skill
// brief: skillID names the Application Skill whose content leads the prompt,
// and subjectLabel heads the section carrying the title/description (e.g.
// "Stream", "Project").
func (a *App) generateThumbnailWithSkill(skillID, subjectLabel, title, description, contextNote, feedback, currentFile string, shape thumbShape) (PlanThumbnail, error) {
	conn, ok := a.getConn(openaiService)
	if !ok {
		return PlanThumbnail{}, fmt.Errorf("connect OpenAI in Settings → AI to generate thumbnails")
	}
	if strings.TrimSpace(title) == "" && strings.TrimSpace(description) == "" {
		return PlanThumbnail{}, fmt.Errorf("give the plan a title or description first — the thumbnail is generated from them")
	}
	if shape.size == "" {
		shape = landscapeThumb
	}

	skill, err := a.getAppSkill(skillID)
	if err != nil {
		return PlanThumbnail{}, err
	}
	var b strings.Builder
	b.WriteString(skill.Content)
	// The frame comes after the skill's brief: the skill is written for the
	// usual 16:9 card, and a vertical cover has to override its composition
	// advice rather than be overridden by it.
	fmt.Fprintf(&b, "\n\n# Frame\n%s\n", shape.note)
	if strings.TrimSpace(contextNote) != "" {
		fmt.Fprintf(&b, "\n\n# Context\n%s\n", strings.TrimSpace(contextNote))
	}
	fmt.Fprintf(&b, "\n\n# %s\n", subjectLabel)
	if strings.TrimSpace(title) != "" {
		fmt.Fprintf(&b, "Title: %s\n", strings.TrimSpace(title))
	}
	if strings.TrimSpace(description) != "" {
		fmt.Fprintf(&b, "Description:\n%s\n", strings.TrimSpace(description))
	}
	if strings.TrimSpace(feedback) != "" {
		fmt.Fprintf(&b, "\n# Requested changes\n%s\n", strings.TrimSpace(feedback))
	}
	brandImages, brandSection := a.brandThumbRefs()
	b.WriteString(brandSection)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// The current image feeds revisions; when it is gone (moved machine,
	// cleaned folder) the request degrades to a fresh generation.
	var current []byte
	if base := filepath.Base(strings.TrimSpace(currentFile)); base != "" && base != "." {
		if dir, dirErr := planThumbsDir(); dirErr == nil {
			current, _ = os.ReadFile(filepath.Join(dir, base))
		}
	}

	var png []byte
	if conn.login == openaiModeAPIKey {
		// The current thumbnail (revisions) and the brand's image assets all
		// ride as input images; with none, plain generation applies.
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
		return PlanThumbnail{}, err
	}

	dir, err := planThumbsDir()
	if err != nil {
		return PlanThumbnail{}, err
	}
	name := fmt.Sprintf("thumb_%d.png", time.Now().UnixNano())
	if err := os.WriteFile(filepath.Join(dir, name), png, 0o600); err != nil {
		return PlanThumbnail{}, fmt.Errorf("could not save the thumbnail: %v", err)
	}
	return PlanThumbnail{File: name, URL: a.planThumbURL(name)}, nil
}

// generateThumbViaCodex produces the thumbnail through Codex headless so the
// image bills the ChatGPT subscription: the run is pointed at a scratch
// workspace, Codex's image_generation tool writes thumb.png there, and the
// file is collected afterwards. currentImage (nil for a fresh generation) is
// placed in the workspace so revisions can view what they are changing. The
// sandbox is opened for the workspace write — the prompt is app-authored and
// scoped to a throwaway directory, matching the trust the video editor
// already extends to headless sessions.
func generateThumbViaCodex(ctx context.Context, prompt string, currentImage []byte, brandImages []namedImage, shape thumbShape) ([]byte, error) {
	work, err := os.MkdirTemp("", "jax-thumb-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)

	if len(currentImage) > 0 {
		if err := os.WriteFile(filepath.Join(work, "current.png"), currentImage, 0o600); err != nil {
			return nil, err
		}
	}
	if len(brandImages) > 0 {
		brandFolder := filepath.Join(work, "brand")
		if err := os.MkdirAll(brandFolder, 0o700); err != nil {
			return nil, err
		}
		for _, img := range brandImages {
			// Asset names come from real files in the brand folder, but stay
			// defensive about separators all the same.
			if err := os.WriteFile(filepath.Join(brandFolder, filepath.Base(img.name)), img.data, 0o600); err != nil {
				return nil, err
			}
		}
	}

	lastMsg := filepath.Join(work, "last-message.txt")
	cmd, err := codexHeadlessCmd(ctx, "-",
		"--sandbox", "danger-full-access",
		"--output-last-message", lastMsg,
	)
	if err != nil {
		return nil, err
	}
	cmd.Dir = work

	var b strings.Builder
	fmt.Fprintf(&b, "Create one thumbnail image with your image generation tool and save it as thumb.png in the current working directory (%s, %s). Do not write any other files or run unrelated commands. Reply with only the file name once saved.\n\n",
		shape.aspect, shape.size)
	if len(currentImage) > 0 {
		b.WriteString("current.png in the working directory is the existing thumbnail — view it first, then produce a revised version that applies the requested changes and keeps everything that wasn't criticised.\n\n")
	}
	if len(brandImages) > 0 {
		b.WriteString("The brand/ folder in the working directory holds the brand's image assets (listed with their descriptions under \"Brand assets\") — view the relevant ones first and follow the brand guidance when composing the thumbnail.\n\n")
	}
	b.WriteString(prompt)
	cmd.Stdin = strings.NewReader(b.String())

	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("Codex could not generate the image: %s", codexErrorDetail(output.String(), err.Error()))
	}

	png, err := os.ReadFile(filepath.Join(work, "thumb.png"))
	if err != nil {
		detail := "no image was produced — try again"
		if raw, rerr := os.ReadFile(lastMsg); rerr == nil && strings.TrimSpace(string(raw)) != "" {
			detail = strings.TrimSpace(string(raw))
			if len(detail) > 300 {
				detail = detail[:300]
			}
		}
		return nil, fmt.Errorf("Codex did not save a thumbnail: %s", detail)
	}
	return png, nil
}

// generateImage calls the Images API and returns the decoded PNG.
func (a *App) generateImage(ctx context.Context, key, prompt, size string) ([]byte, error) {
	body, err := json.Marshal(map[string]any{
		"model":  openaiImageModel,
		"prompt": prompt,
		"size":   size,
	})
	if err != nil {
		return nil, err
	}
	raw, err := postAI(ctx, openaiImagesURL, map[string]string{
		"Authorization": "Bearer " + key,
		"Content-Type":  "application/json",
	}, body, "OpenAI")
	if err != nil {
		return nil, err
	}
	return decodeImageResponse(raw)
}

// editImages sends input images (the current thumbnail and/or brand
// references) through the images-edit endpoint (multipart) with the combined
// brief + feedback prompt.
func (a *App) editImages(ctx context.Context, key, prompt string, images []namedImage, size string) ([]byte, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("model", openaiImageModel); err != nil {
		return nil, err
	}
	if err := mw.WriteField("prompt", prompt); err != nil {
		return nil, err
	}
	if err := mw.WriteField("size", size); err != nil {
		return nil, err
	}
	for _, img := range images {
		fw, err := mw.CreateFormFile("image[]", img.name)
		if err != nil {
			return nil, err
		}
		if _, err := fw.Write(img.data); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	raw, err := postAI(ctx, openaiImageEditsURL, map[string]string{
		"Authorization": "Bearer " + key,
		"Content-Type":  mw.FormDataContentType(),
	}, buf.Bytes(), "OpenAI")
	if err != nil {
		return nil, err
	}
	return decodeImageResponse(raw)
}

// decodeImageResponse extracts the first image from an Images API response.
func decodeImageResponse(raw []byte) ([]byte, error) {
	var r struct {
		Data []struct {
			B64 string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	if len(r.Data) == 0 || r.Data[0].B64 == "" {
		return nil, fmt.Errorf("the model returned no image — try again")
	}
	png, err := base64.StdEncoding.DecodeString(r.Data[0].B64)
	if err != nil {
		return nil, fmt.Errorf("the model returned an unreadable image — try again")
	}
	return png, nil
}

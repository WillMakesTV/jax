package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Inspiration
//
// The reference library: YouTube videos (and whole channels) worth studying,
// indexed locally. Adding a video downloads it under the Videos workspace
// (Settings → Videos) into inspiration/<channel>/<video id>/, transcribes it
// with the same faster-whisper sidecar the VOD transcriber uses, and then
// asks the connected AI to read the description, chapters, and transcript and
// return a manifest: a summary, a timestamped outline, the links, and the
// products/services/tools the video names.
//
// Everything is stored under one settings key so an MCP client or a second
// window sees the same library ("data:changed" fires on every write); the
// media itself stays on disk and is served to the app by the media server's
// /edits/ prefix (the workspace root).
// ---------------------------------------------------------------------------

//go:embed inspiration/fetch_video.py
var inspirationScript []byte

// keyInspiration holds the whole library (channels + videos).
const keyInspiration = "inspiration"

// inspirationDirName is the folder the library lives in, inside the Videos
// workspace root (see resolveEditRoot).
const inspirationDirName = "inspiration"

// InspirationChannel is one indexed source channel, with whatever branding
// and metrics the platform exposes about it.
type InspirationChannel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Handle      string `json:"handle"`
	URL         string `json:"url"`
	Description string `json:"description"`
	// AvatarURL and BannerURL are the platform's own images, used as-is.
	AvatarURL   string            `json:"avatarUrl"`
	BannerURL   string            `json:"bannerUrl"`
	Subscribers int               `json:"subscribers"`
	VideoCount  int               `json:"videoCount"`
	Tags        []string          `json:"tags"`
	Links       []InspirationLink `json:"links"`
	AddedAt     string            `json:"addedAt"`
	// IndexedAt is when the channel's own metadata was last refreshed —
	// every video indexed from it brings this up to date.
	IndexedAt string `json:"indexedAt"`
}

// InspirationChapter is one chapter marker from the video's own metadata.
type InspirationChapter struct {
	Title     string `json:"title"`
	StartSecs int    `json:"startSecs"`
}

// InspirationLine is one transcribed utterance, in video-relative seconds.
type InspirationLine struct {
	AtSecs  float64 `json:"atSecs"`
	EndSecs float64 `json:"endSecs"`
	Text    string  `json:"text"`
}

// InspirationBeat is one entry of the AI-built outline: a moment in the video
// with what happens there.
type InspirationBeat struct {
	AtSecs  int    `json:"atSecs"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

// InspirationLink is a URL the video points at (description or spoken).
type InspirationLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// InspirationMention is a product, service, tool, or brand the video names,
// with the moment it comes up (-1 when it is only in the description).
type InspirationMention struct {
	Kind   string `json:"kind"` // product | service | tool | brand | person | other
	Name   string `json:"name"`
	Detail string `json:"detail"`
	AtSecs int    `json:"atSecs"`
}

// InspirationTakeaway is one lesson lifted out of a studied video: a tip, a
// technique, or a concept worth reusing, with where in the video it comes up
// (-1 when it is not tied to a moment).
type InspirationTakeaway struct {
	Kind   string `json:"kind"` // tip | technique | concept | hook | format | other
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Apply  string `json:"apply"` // how it could be used on our own channel
	AtSecs int    `json:"atSecs"`
}

// Inspiration video statuses, in pipeline order.
const (
	inspirationTracked      = "tracked"
	inspirationQueued       = "queued"
	inspirationDownloading  = "downloading"
	inspirationTranscribing = "transcribing"
	inspirationAnalyzing    = "analyzing"
	inspirationExtracting   = "extracting"
	inspirationReady        = "ready"
	inspirationError        = "error"
)

// InspirationVideo is one indexed video: its platform metadata, the local
// copy, and everything the pipeline derived from it.
type InspirationVideo struct {
	ID           string   `json:"id"` // the platform's video id
	ChannelID    string   `json:"channelId"`
	Title        string   `json:"title"`
	URL          string   `json:"url"`
	Description  string   `json:"description"`
	PublishedAt  string   `json:"publishedAt"`
	DurationSecs int      `json:"durationSecs"`
	Views        int      `json:"views"`
	Likes        int      `json:"likes"`
	Comments     int      `json:"comments"`
	Tags         []string `json:"tags"`
	Categories   []string `json:"categories"`
	// ThumbnailURL is the platform's thumbnail; ThumbnailFile is the copy
	// yt-dlp saved beside the video, served through MediaURL's folder.
	ThumbnailURL  string `json:"thumbnailUrl"`
	ThumbnailFile string `json:"thumbnailFile"`
	// Folder is the library-relative path ("<channel>/<video id>") and
	// VideoFile the media file inside it; both empty until it downloads.
	Folder    string `json:"folder"`
	VideoFile string `json:"videoFile"`
	// MediaURL is the app-served address of the downloaded video, computed
	// on read and never persisted.
	MediaURL string `json:"mediaUrl"`
	// ThumbURL is the app-served address of the saved thumbnail, likewise
	// derived per read.
	ThumbURL string `json:"thumbUrl"`

	Status       string `json:"status"`
	StatusDetail string `json:"statusDetail"`
	Progress     int    `json:"progress"` // download percent while downloading

	Chapters   []InspirationChapter `json:"chapters"`
	Transcript []InspirationLine    `json:"transcript"`

	Summary  string               `json:"summary"`
	Outline  string               `json:"outline"` // markdown
	Beats    []InspirationBeat    `json:"beats"`
	Links    []InspirationLink    `json:"links"`
	Mentions []InspirationMention `json:"mentions"`

	// Takeaways is the second AI pass: what can be learned from the video,
	// extracted from the outline once it exists. TakeawaysAt records when
	// that pass last ran, so the backfill knows what is still outstanding.
	Takeaways   []InspirationTakeaway `json:"takeaways"`
	TakeawaysAt string                `json:"takeawaysAt"`

	AddedAt    string `json:"addedAt"`
	AnalyzedAt string `json:"analyzedAt"`
}

// inspirationLibrary is the stored shape behind keyInspiration.
type inspirationLibrary struct {
	Channels []InspirationChannel `json:"channels"`
	Videos   []InspirationVideo   `json:"videos"`
}

// inspirationRoot returns the library folder inside the Videos workspace,
// creating it if necessary.
func (a *App) inspirationRoot() (string, error) {
	root := filepath.Join(a.resolveEditRoot(), inspirationDirName)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", fmt.Errorf("could not create the inspiration folder: %w", err)
	}
	return root, nil
}

// getInspiration reads the stored library. Never returns nil slices.
func (a *App) getInspiration() inspirationLibrary {
	lib := inspirationLibrary{}
	if a.store != nil {
		if _, err := a.store.getJSON(keyInspiration, &lib); err != nil {
			log.Printf("jax: getInspiration: %v", err)
		}
	}
	if lib.Channels == nil {
		lib.Channels = []InspirationChannel{}
	}
	if lib.Videos == nil {
		lib.Videos = []InspirationVideo{}
	}
	return lib
}

func (a *App) saveInspiration(lib inspirationLibrary) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	return a.store.setJSON(keyInspiration, lib)
}

// fillInspirationURLs stamps a video's app-served media addresses.
func (a *App) fillInspirationURLs(v *InspirationVideo) {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()
	if v.Tags == nil {
		v.Tags = []string{}
	}
	if v.Categories == nil {
		v.Categories = []string{}
	}
	if v.Chapters == nil {
		v.Chapters = []InspirationChapter{}
	}
	if v.Transcript == nil {
		v.Transcript = []InspirationLine{}
	}
	if v.Beats == nil {
		v.Beats = []InspirationBeat{}
	}
	if v.Links == nil {
		v.Links = []InspirationLink{}
	}
	if v.Mentions == nil {
		v.Mentions = []InspirationMention{}
	}
	if v.Takeaways == nil {
		v.Takeaways = []InspirationTakeaway{}
	}
	if base == "" || v.Folder == "" {
		return
	}
	prefix := base + editsPrefix + inspirationDirName + "/"
	for _, part := range strings.Split(filepath.ToSlash(v.Folder), "/") {
		prefix += url.PathEscape(part) + "/"
	}
	if v.VideoFile != "" {
		v.MediaURL = prefix + url.PathEscape(v.VideoFile)
	}
	if v.ThumbnailFile != "" {
		v.ThumbURL = prefix + url.PathEscape(v.ThumbnailFile)
	}
}

// GetInspirationChannels returns the indexed channels, newest first. Never nil.
func (a *App) GetInspirationChannels() []InspirationChannel {
	lib := a.getInspiration()
	sort.SliceStable(lib.Channels, func(i, j int) bool {
		return lib.Channels[i].AddedAt > lib.Channels[j].AddedAt
	})
	for i := range lib.Channels {
		fillInspirationChannel(&lib.Channels[i])
	}
	return lib.Channels
}

// GetInspirationChannel returns one channel by id, or an error when it is
// gone — how the channel page reloads itself as the index refreshes.
func (a *App) GetInspirationChannel(id string) (InspirationChannel, error) {
	for _, c := range a.getInspiration().Channels {
		if c.ID == id {
			fillInspirationChannel(&c)
			return c, nil
		}
	}
	return InspirationChannel{}, fmt.Errorf("that channel is no longer indexed")
}

// fillInspirationChannel keeps a channel's slices non-nil for the frontend.
func fillInspirationChannel(c *InspirationChannel) {
	if c.Tags == nil {
		c.Tags = []string{}
	}
	if c.Links == nil {
		c.Links = []InspirationLink{}
	}
}

// GetInspirationVideos returns a channel's videos (all of them when channelID
// is empty), newest published first. Never nil.
func (a *App) GetInspirationVideos(channelID string) []InspirationVideo {
	lib := a.getInspiration()
	out := []InspirationVideo{}
	for i := range lib.Videos {
		if channelID != "" && lib.Videos[i].ChannelID != channelID {
			continue
		}
		v := lib.Videos[i]
		a.fillInspirationURLs(&v)
		out = append(out, v)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].PublishedAt != out[j].PublishedAt {
			return out[i].PublishedAt > out[j].PublishedAt
		}
		return out[i].AddedAt > out[j].AddedAt
	})
	return out
}

// GetInspirationVideo returns one video by id, or an error when it is gone.
func (a *App) GetInspirationVideo(id string) (InspirationVideo, error) {
	for _, v := range a.getInspiration().Videos {
		if v.ID == id {
			a.fillInspirationURLs(&v)
			return v, nil
		}
	}
	return InspirationVideo{}, fmt.Errorf("that video is no longer indexed")
}

// upsertInspirationChannel stores a channel (matched by id), keeping the
// original AddedAt, and returns its id. A partial report — the identifying
// fields that ride along with a video, say — never blanks branding or
// metrics an earlier full index already found.
func (a *App) upsertInspirationChannel(lib *inspirationLibrary, ch InspirationChannel) string {
	if ch.ID == "" {
		ch.ID = "chan_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	for i := range lib.Channels {
		if lib.Channels[i].ID != ch.ID {
			continue
		}
		old := lib.Channels[i]
		ch.Description = firstNonEmpty(ch.Description, old.Description)
		ch.AvatarURL = firstNonEmpty(ch.AvatarURL, old.AvatarURL)
		ch.BannerURL = firstNonEmpty(ch.BannerURL, old.BannerURL)
		ch.Handle = firstNonEmpty(ch.Handle, old.Handle)
		ch.URL = firstNonEmpty(ch.URL, old.URL)
		if ch.Subscribers == 0 {
			ch.Subscribers = old.Subscribers
		}
		if ch.VideoCount == 0 {
			ch.VideoCount = old.VideoCount
		}
		if len(ch.Tags) == 0 {
			ch.Tags = old.Tags
		}
		if len(ch.Links) == 0 {
			ch.Links = old.Links
		}
		ch.AddedAt = old.AddedAt
		ch.IndexedAt = firstNonEmpty(ch.IndexedAt, old.IndexedAt)
		lib.Channels[i] = ch
		return ch.ID
	}
	ch.AddedAt = time.Now().UTC().Format(time.RFC3339)
	lib.Channels = append(lib.Channels, ch)
	return ch.ID
}

// refreshInspirationChannel re-reads a channel's own page — its branding,
// metrics, and published links — and stores what comes back. Indexing a
// video runs it in the background, so the channel behind a studied video is
// never left as a bare name.
func (a *App) refreshInspirationChannel(channelURL string) {
	channelURL = strings.TrimSpace(channelURL)
	if channelURL == "" {
		return
	}
	var found InspirationChannel
	err := a.runInspirationSidecar(func(line sidecarLine) {
		if line.Status == "channel" {
			found = inspirationChannelOf(line.Channel)
		}
	}, "--url", channelURL, "--channel")
	if err != nil {
		log.Printf("jax: inspiration channel %s: %v", channelURL, err)
		return
	}
	if found.ID == "" && found.Name == "" {
		return
	}
	found.IndexedAt = time.Now().UTC().Format(time.RFC3339)
	lib := a.getInspiration()
	a.upsertInspirationChannel(&lib, found)
	if err := a.saveInspiration(lib); err != nil {
		log.Printf("jax: save inspiration: %v", err)
	}
}

// mutateInspirationVideo applies fn to the stored video with the given id and
// persists the library. Missing videos are ignored (a delete may have raced).
func (a *App) mutateInspirationVideo(id string, fn func(v *InspirationVideo)) {
	lib := a.getInspiration()
	for i := range lib.Videos {
		if lib.Videos[i].ID != id {
			continue
		}
		fn(&lib.Videos[i])
		if err := a.saveInspiration(lib); err != nil {
			log.Printf("jax: save inspiration: %v", err)
		}
		return
	}
}

// inspirationStatus records a pipeline step and reports it to open pages and
// the status bar. The title rides along so the status-bar chip can name the
// video without a lookup of its own.
func (a *App) inspirationStatus(id, status, detail string, progress int) {
	title := ""
	a.mutateInspirationVideo(id, func(v *InspirationVideo) {
		v.Status = status
		v.StatusDetail = detail
		v.Progress = progress
		title = v.Title
	})
	a.emitInspirationStatus(id, title, status, detail, progress)
}

// emitInspirationStatus reports a pipeline step without touching the store —
// for the moments the library was just written wholesale.
func (a *App) emitInspirationStatus(id, title, status, detail string, progress int) {
	if a.ctx == nil {
		return
	}
	wruntime.EventsEmit(a.ctx, "inspiration:status", id, title, status, detail, progress)
}

// inspirationSidecar writes the embedded fetcher and returns the command to
// run it with the given arguments.
func (a *App) inspirationSidecar(args ...string) (*exec.Cmd, error) {
	dir, err := dataDir()
	if err != nil {
		return nil, fmt.Errorf("no data directory: %w", err)
	}
	script := filepath.Join(dir, "inspiration_fetch.py")
	if err := os.WriteFile(script, inspirationScript, 0o600); err != nil {
		return nil, fmt.Errorf("could not write the indexer script: %w", err)
	}
	python, pyArgs, err := findPython()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(python, append(append(pyArgs, script), args...)...)
	backgroundProcess(cmd) // never outrank live capture
	return cmd, nil
}

// sidecarChannel is the channel the fetcher reports, alone or alongside a
// video. Branding and metrics only come back from the channel modes; a
// video's copy carries the identifying fields and its follower count.
type sidecarChannel struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Handle      string            `json:"handle"`
	URL         string            `json:"url"`
	Description string            `json:"description"`
	Subscribers int               `json:"subscribers"`
	VideoCount  int               `json:"videoCount"`
	AvatarURL   string            `json:"avatarUrl"`
	BannerURL   string            `json:"bannerUrl"`
	Tags        []string          `json:"tags"`
	Links       []InspirationLink `json:"links"`
}

// inspirationChannelOf converts a reported channel into the stored shape.
func inspirationChannelOf(c sidecarChannel) InspirationChannel {
	return InspirationChannel{
		ID:          c.ID,
		Name:        c.Name,
		Handle:      c.Handle,
		URL:         c.URL,
		Description: c.Description,
		AvatarURL:   c.AvatarURL,
		BannerURL:   c.BannerURL,
		Subscribers: c.Subscribers,
		VideoCount:  c.VideoCount,
		Tags:        c.Tags,
		Links:       c.Links,
	}
}

// sidecarLine is one JSON line from the fetcher.
type sidecarLine struct {
	Status  string         `json:"status"`
	Percent int            `json:"percent"`
	Dir     string         `json:"dir"`
	Rel     string         `json:"rel"`
	File    string         `json:"file"`
	Thumb   string         `json:"thumbnail"`
	Error   string         `json:"error"`
	Channel sidecarChannel `json:"channel"`
	Video   struct {
		ID           string               `json:"id"`
		Title        string               `json:"title"`
		URL          string               `json:"url"`
		Description  string               `json:"description"`
		PublishedAt  string               `json:"publishedAt"`
		DurationSecs int                  `json:"durationSecs"`
		Views        int                  `json:"views"`
		Likes        int                  `json:"likes"`
		Comments     int                  `json:"comments"`
		Tags         []string             `json:"tags"`
		Categories   []string             `json:"categories"`
		ThumbnailURL string               `json:"thumbnailUrl"`
		Chapters     []InspirationChapter `json:"chapters"`
		Channel      sidecarChannel       `json:"channel"`
	} `json:"video"`
}

// runInspirationSidecar runs the fetcher and hands every parsed line to onLine.
// The returned error carries the sidecar's own error line when it reported one.
func (a *App) runInspirationSidecar(onLine func(sidecarLine), args ...string) error {
	cmd, err := a.inspirationSidecar(args...)
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start the indexer: %w", err)
	}

	lastErr := ""
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		raw := strings.TrimSpace(scanner.Text())
		if raw == "" {
			continue
		}
		var line sidecarLine
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			continue
		}
		if line.Error != "" {
			lastErr = line.Error
			continue
		}
		onLine(line)
	}
	if err := cmd.Wait(); err != nil {
		if lastErr != "" {
			return fmt.Errorf("%s", lastErr)
		}
		return err
	}
	if lastErr != "" {
		return fmt.Errorf("%s", lastErr)
	}
	return nil
}

// ---------------------------------------------------------------------------
// The processing queue
//
// One video is processed at a time: each run downloads gigabytes, pins a
// whisper pass to the CPU, and asks the AI runner for two answers, so running
// two at once would starve both (and the live capture beside them). Adding a
// channel therefore queues its videos newest-first and works backwards, one
// by one.
// ---------------------------------------------------------------------------

var inspirationQueue struct {
	sync.Mutex
	ids     []string
	running bool
}

// enqueueInspirationVideo puts a video in line to be processed and starts the
// worker if it is idle. Already-queued videos are left where they are.
func (a *App) enqueueInspirationVideo(id string) {
	inspirationQueue.Lock()
	for _, queued := range inspirationQueue.ids {
		if queued == id {
			inspirationQueue.Unlock()
			return
		}
	}
	inspirationQueue.ids = append(inspirationQueue.ids, id)
	start := !inspirationQueue.running
	if start {
		inspirationQueue.running = true
	}
	inspirationQueue.Unlock()

	a.inspirationStatus(id, inspirationQueued, "", 0)
	if start {
		go a.runInspirationQueue()
	}
}

// runInspirationQueue works the queue to exhaustion, then stops.
func (a *App) runInspirationQueue() {
	for {
		inspirationQueue.Lock()
		if len(inspirationQueue.ids) == 0 {
			inspirationQueue.running = false
			inspirationQueue.Unlock()
			return
		}
		id := inspirationQueue.ids[0]
		inspirationQueue.ids = inspirationQueue.ids[1:]
		inspirationQueue.Unlock()

		video, err := a.GetInspirationVideo(id)
		if err != nil {
			// Deleted while it waited; nothing to process.
			continue
		}
		if video.URL == "" {
			a.inspirationStatus(id, inspirationError, "that video has no URL to fetch", 0)
			continue
		}
		a.processInspirationVideo(id, video.URL)
	}
}

// InspirationQueueLength reports how many videos are waiting to be processed,
// excluding the one being worked on.
func (a *App) InspirationQueueLength() int {
	inspirationQueue.Lock()
	defer inspirationQueue.Unlock()
	return len(inspirationQueue.ids)
}

// AddInspirationChannel indexes a YouTube channel: the channel itself plus
// its most recent videos, tracked but not downloaded (download one from its
// page when it is worth studying). Returns the stored channel.
func (a *App) AddInspirationChannel(channelURL string) (InspirationChannel, error) {
	channelURL = strings.TrimSpace(channelURL)
	if channelURL == "" {
		return InspirationChannel{}, fmt.Errorf("paste a YouTube channel URL first")
	}

	var channel InspirationChannel
	found := []InspirationVideo{}
	err := a.runInspirationSidecar(func(line sidecarLine) {
		switch line.Status {
		case "channel":
			channel = inspirationChannelOf(line.Channel)
			channel.IndexedAt = time.Now().UTC().Format(time.RFC3339)
		case "video":
			found = append(found, InspirationVideo{
				ID:           line.Video.ID,
				Title:        line.Video.Title,
				URL:          line.Video.URL,
				Description:  line.Video.Description,
				PublishedAt:  line.Video.PublishedAt,
				DurationSecs: line.Video.DurationSecs,
				Views:        line.Video.Views,
				ThumbnailURL: line.Video.ThumbnailURL,
				Status:       inspirationTracked,
			})
		}
	}, "--url", channelURL, "--index", "--limit", "30")
	if err != nil {
		return InspirationChannel{}, err
	}
	if channel.Name == "" && channel.ID == "" {
		return InspirationChannel{}, fmt.Errorf("that URL did not resolve to a channel")
	}

	lib := a.getInspiration()
	id := a.upsertInspirationChannel(&lib, channel)
	known := map[string]bool{}
	for _, v := range lib.Videos {
		known[v.ID] = true
	}
	now := time.Now().UTC().Format(time.RFC3339)
	fresh := []string{}
	for _, v := range found {
		if v.ID == "" || known[v.ID] {
			continue
		}
		v.ChannelID = id
		v.AddedAt = now
		v.Status = inspirationQueued
		lib.Videos = append(lib.Videos, v)
		fresh = append(fresh, v.ID)
	}
	if err := a.saveInspiration(lib); err != nil {
		return InspirationChannel{}, err
	}
	// The indexer lists a channel newest-first, so queueing in that order
	// works backwards through its catalogue.
	for _, videoID := range fresh {
		a.enqueueInspirationVideo(videoID)
	}
	for _, ch := range lib.Channels {
		if ch.ID == id {
			return ch, nil
		}
	}
	return channel, nil
}

// AddInspirationVideo indexes one video: it is stored immediately (so the
// library shows it right away) and the download → transcribe → analyse
// pipeline runs in the background, reporting through "inspiration:status".
// The video's channel is indexed alongside it.
func (a *App) AddInspirationVideo(videoURL string) (InspirationVideo, error) {
	videoURL = strings.TrimSpace(videoURL)
	if videoURL == "" {
		return InspirationVideo{}, fmt.Errorf("paste a YouTube video URL first")
	}
	if a.store == nil {
		return InspirationVideo{}, fmt.Errorf("storage unavailable")
	}

	stub := InspirationVideo{
		ID:      "pending_" + strconv.FormatInt(time.Now().UnixNano(), 10),
		URL:     videoURL,
		Title:   videoURL,
		Status:  inspirationQueued,
		AddedAt: time.Now().UTC().Format(time.RFC3339),
	}
	lib := a.getInspiration()
	lib.Videos = append(lib.Videos, stub)
	if err := a.saveInspiration(lib); err != nil {
		return InspirationVideo{}, err
	}

	a.enqueueInspirationVideo(stub.ID)
	return stub, nil
}

// ProcessInspirationVideo queues (or re-queues) the whole pipeline for a
// video already in the library — download, transcribe, study, extract the
// takeaways, then drop the local copy. This is the single "Process" action
// the video page offers.
func (a *App) ProcessInspirationVideo(id string) error {
	video, err := a.GetInspirationVideo(id)
	if err != nil {
		return err
	}
	if video.URL == "" {
		return fmt.Errorf("that video has no URL to fetch")
	}
	a.enqueueInspirationVideo(id)
	return nil
}

// processInspirationVideo is the pipeline: download, transcribe, analyse.
// Each step records its status so a page open on the video follows along.
func (a *App) processInspirationVideo(id, videoURL string) {
	root, err := a.inspirationRoot()
	if err != nil {
		a.inspirationStatus(id, inspirationError, err.Error(), 0)
		return
	}

	// --- Download -----------------------------------------------------
	var meta sidecarLine
	var folder, file, thumb string
	err = a.runInspirationSidecar(func(line sidecarLine) {
		switch line.Status {
		case "meta":
			meta = line
		case "downloading":
			a.inspirationStatus(id, inspirationDownloading, "", line.Percent)
		case "done":
			folder = line.Rel
			if folder == "" {
				if rel, rerr := filepath.Rel(root, line.Dir); rerr == nil {
					folder = filepath.ToSlash(rel)
				}
			}
			file = line.File
			thumb = line.Thumb
		}
	}, "--url", videoURL, "--dir", root)
	if err != nil {
		a.inspirationStatus(id, inspirationError, err.Error(), 0)
		return
	}
	if file == "" {
		a.inspirationStatus(id, inspirationError, "the download produced no video file", 0)
		return
	}

	// The platform's own id replaces the pending one, and the channel is
	// indexed alongside the video.
	lib := a.getInspiration()
	channelID := a.upsertInspirationChannel(&lib, inspirationChannelOf(meta.Video.Channel))
	realID := meta.Video.ID
	for i := range lib.Videos {
		if lib.Videos[i].ID != id {
			continue
		}
		v := &lib.Videos[i]
		if realID != "" {
			v.ID = realID
		}
		v.ChannelID = channelID
		v.Title = meta.Video.Title
		v.URL = firstNonEmpty(meta.Video.URL, videoURL)
		v.Description = meta.Video.Description
		v.PublishedAt = meta.Video.PublishedAt
		v.DurationSecs = meta.Video.DurationSecs
		v.Views = meta.Video.Views
		v.Likes = meta.Video.Likes
		v.Comments = meta.Video.Comments
		v.Tags = meta.Video.Tags
		v.Categories = meta.Video.Categories
		v.ThumbnailURL = meta.Video.ThumbnailURL
		v.Chapters = meta.Video.Chapters
		v.Folder = folder
		v.VideoFile = file
		v.ThumbnailFile = thumb
		v.Status = inspirationTranscribing
		v.StatusDetail = ""
		v.Progress = 100
		break
	}
	// A duplicate of the same video (added twice) collapses onto one entry.
	if realID != "" {
		seen := false
		out := lib.Videos[:0]
		for _, v := range lib.Videos {
			if v.ID == realID {
				if seen {
					continue
				}
				seen = true
			}
			out = append(out, v)
		}
		lib.Videos = out
		id = realID
	}
	if err := a.saveInspiration(lib); err != nil {
		log.Printf("jax: save inspiration: %v", err)
	}
	// The video's own metadata only names its channel; read the channel's
	// page for the branding, metrics, and links while the transcript runs.
	go a.refreshInspirationChannel(firstNonEmpty(meta.Video.Channel.URL, meta.Video.Channel.Handle))
	a.emitInspirationStatus(id, meta.Video.Title, inspirationTranscribing, "", 100)

	// --- Transcribe ---------------------------------------------------
	lines, err := a.transcribeInspirationVideo(id, filepath.Join(root, filepath.FromSlash(folder), file))
	if err != nil {
		a.inspirationStatus(id, inspirationError, err.Error(), 0)
		return
	}
	a.mutateInspirationVideo(id, func(v *InspirationVideo) {
		v.Transcript = lines
		v.Status = inspirationAnalyzing
	})
	a.emitInspirationStatus(id, meta.Video.Title, inspirationAnalyzing, "", 0)

	// --- Analyse ------------------------------------------------------
	if err := a.analyzeInspirationVideo(id); err != nil {
		a.inspirationStatus(id, inspirationError, err.Error(), 0)
		return
	}

	// --- Takeaways ----------------------------------------------------
	// A failed extraction leaves the manifest in place: the video is still
	// studied, it just has nothing lifted out of it yet, and the backfill
	// picks it up on the next launch.
	a.inspirationStatus(id, inspirationExtracting, "", 0)
	if err := a.extractInspirationTakeaways(id); err != nil {
		log.Printf("jax: inspiration takeaways: %v", err)
	}

	// Everything worth keeping is now in the library, and every timestamp
	// resolves against the video on YouTube, so the local copy — by far the
	// largest thing the run produced — is no longer needed.
	a.dropInspirationDownload(id)
	a.inspirationStatus(id, inspirationReady, "", 0)
}

// dropInspirationDownload deletes a studied video's media file and forgets
// it, keeping the thumbnail and the notes. Processing the video again
// re-downloads it.
func (a *App) dropInspirationDownload(id string) {
	video, err := a.GetInspirationVideo(id)
	if err != nil || video.VideoFile == "" || video.Folder == "" {
		return
	}
	root, err := a.inspirationRoot()
	if err != nil {
		return
	}
	path := filepath.Join(root, filepath.FromSlash(video.Folder), video.VideoFile)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Printf("jax: inspiration cleanup %s: %v", path, err)
		return
	}
	a.mutateInspirationVideo(id, func(v *InspirationVideo) {
		v.VideoFile = ""
	})
}

// transcribeInspirationVideo runs the faster-whisper sidecar over the local
// copy and returns its utterances in video-relative seconds.
func (a *App) transcribeInspirationVideo(id, path string) ([]InspirationLine, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("the downloaded video is missing: %w", err)
	}
	dir, err := dataDir()
	if err != nil {
		return nil, err
	}
	script := filepath.Join(dir, "transcribe_video.py")
	if err := os.WriteFile(script, transcribeVideoScript, 0o600); err != nil {
		return nil, fmt.Errorf("could not write the transcriber script: %w", err)
	}
	python, pyArgs, err := findPython()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(python, append(append(pyArgs, script),
		"--input", path, "--model", "small")...)
	backgroundProcess(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("could not start the transcriber: %w", err)
	}

	lines := []InspirationLine{}
	lastErr := ""
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		raw := strings.TrimSpace(scanner.Text())
		if raw == "" {
			continue
		}
		var seg struct {
			Text  string  `json:"text"`
			Start float64 `json:"start"`
			End   float64 `json:"end"`
			Pos   float64 `json:"pos"`
			Error string  `json:"error"`
		}
		if err := json.Unmarshal([]byte(raw), &seg); err != nil {
			continue
		}
		switch {
		case seg.Error != "":
			lastErr = seg.Error
		case seg.Text != "":
			lines = append(lines, InspirationLine{
				AtSecs: seg.Start, EndSecs: seg.End, Text: seg.Text,
			})
		case seg.Pos > 0:
			// A heartbeat: report how far through the video the pass is.
			a.inspirationStatus(id, inspirationTranscribing, "", int(seg.Pos))
		}
	}
	if err := cmd.Wait(); err != nil {
		if lastErr != "" {
			return nil, fmt.Errorf("%s", lastErr)
		}
		return nil, err
	}
	if lastErr != "" {
		return nil, fmt.Errorf("%s", lastErr)
	}
	return lines, nil
}

// inspirationInstructions briefs the model that builds a video's manifest.
const inspirationInstructions = `You are indexing a YouTube video for a creator's reference library. You are given the video's metadata, its chapter markers, and a timestamped transcript of its audio.

Study it the way a producer would: what the video does, how it is built, what it points the viewer at.

Respond with a single JSON object and nothing else:
{
  "summary": "<2-4 sentences: what this video is and who it is for>",
  "outline": "<markdown outline of the whole video, using '## mm:ss — Section' headings and bullets underneath; cover the video end to end>",
  "beats": [{"atSecs": 0, "title": "<short label>", "summary": "<what happens here>"}],
  "links": [{"label": "<what it is>", "url": "<url>"}],
  "mentions": [{"kind": "product|service|tool|brand|person|other", "name": "<name>", "detail": "<how it is used or why it comes up>", "atSecs": 0}]
}

Rules:
- Timestamps are seconds from the start of the video, taken from the transcript. Use -1 for a mention that appears only in the description.
- links: every URL in the description, plus any spoken or clearly named destination. Keep product ids, SKUs, and discount codes in the label when they are given.
- mentions: every product, service, tool, brand, or person the video names — including gear shown or read out. Do not invent any.
- beats: 8-20 entries, in time order, covering the whole runtime.
- Do not wrap the JSON in code fences.`

// AnalyzeInspirationVideo re-runs the AI pass over an indexed video (the
// pipeline calls it once; the video page offers it again after edits).
func (a *App) AnalyzeInspirationVideo(id string) error {
	if err := a.analyzeInspirationVideo(id); err != nil {
		a.inspirationStatus(id, inspirationError, err.Error(), 0)
		return err
	}
	a.inspirationStatus(id, inspirationReady, "", 0)
	return nil
}

// analyzeInspirationVideo asks the connected AI for the video's manifest and
// stores it.
func (a *App) analyzeInspirationVideo(id string) error {
	video, err := a.GetInspirationVideo(id)
	if err != nil {
		return err
	}

	var in strings.Builder
	fmt.Fprintf(&in, "# Video\nTitle: %s\nURL: %s\n", video.Title, video.URL)
	if video.PublishedAt != "" {
		fmt.Fprintf(&in, "Published: %s\n", video.PublishedAt)
	}
	if video.DurationSecs > 0 {
		fmt.Fprintf(&in, "Duration: %s\n", formatClock(video.DurationSecs))
	}
	if len(video.Tags) > 0 {
		fmt.Fprintf(&in, "Tags: %s\n", strings.Join(video.Tags, ", "))
	}
	if strings.TrimSpace(video.Description) != "" {
		fmt.Fprintf(&in, "\n## Description\n%s\n", video.Description)
	}
	if len(video.Chapters) > 0 {
		in.WriteString("\n## Chapters\n")
		for _, c := range video.Chapters {
			fmt.Fprintf(&in, "- %s %s\n", formatClock(c.StartSecs), c.Title)
		}
	}
	if len(video.Transcript) > 0 {
		in.WriteString("\n## Transcript\n")
		for _, l := range video.Transcript {
			fmt.Fprintf(&in, "[%s] %s\n", formatClock(int(l.AtSecs)), l.Text)
		}
	} else {
		in.WriteString("\n## Transcript\n(none — the audio produced no speech)\n")
	}

	text, err := a.askAIText(inspirationInstructions, in.String())
	if err != nil {
		return err
	}
	var parsed struct {
		Summary  string               `json:"summary"`
		Outline  string               `json:"outline"`
		Beats    []InspirationBeat    `json:"beats"`
		Links    []InspirationLink    `json:"links"`
		Mentions []InspirationMention `json:"mentions"`
	}
	if err := json.Unmarshal([]byte(extractJSONObject(text)), &parsed); err != nil {
		return fmt.Errorf("the model's manifest could not be read: %w", err)
	}

	a.mutateInspirationVideo(id, func(v *InspirationVideo) {
		v.Summary = parsed.Summary
		v.Outline = parsed.Outline
		v.Beats = parsed.Beats
		v.Links = parsed.Links
		v.Mentions = parsed.Mentions
		v.Status = inspirationReady
		v.StatusDetail = ""
		v.AnalyzedAt = time.Now().UTC().Format(time.RFC3339)
	})
	return nil
}

// inspirationTakeawayInstructions briefs the second pass: what a producer can
// actually use, lifted out of the video's own outline.
const inspirationTakeawayInstructions = `You are reading the study notes a creator's reference library holds for one YouTube video: its summary, its outline, its beats, and what it names. Pull out what another creator could take away and use.

Respond with a single JSON object and nothing else:
{
  "takeaways": [{"kind": "tip|technique|concept|hook|format|other", "title": "<short label>", "detail": "<what the video does or says, in one or two sentences>", "apply": "<how another creator could use this on their own channel>", "atSecs": 0}]
}

Rules:
- 5-15 takeaways, ordered by how useful they are, not by when they appear.
- Only what the notes actually support — never invent advice the video does not give.
- kind: "tip" for concrete advice, "technique" for how something is executed, "concept" for an idea or framing, "hook" for an attention device, "format" for structure or packaging, "other" for anything else.
- atSecs is seconds from the start of the video, taken from the beats; use -1 when a takeaway is about the video as a whole.
- Do not wrap the JSON in code fences.`

// ExtractInspirationTakeaways re-runs the takeaway pass over a studied video
// (the pipeline runs it once; the video page offers it again).
func (a *App) ExtractInspirationTakeaways(id string) error {
	a.inspirationStatus(id, inspirationExtracting, "", 0)
	if err := a.extractInspirationTakeaways(id); err != nil {
		a.inspirationStatus(id, inspirationError, err.Error(), 0)
		return err
	}
	a.inspirationStatus(id, inspirationReady, "", 0)
	return nil
}

// extractInspirationTakeaways asks the connected AI what can be learned from a
// studied video and stores the answer. It reads the manifest rather than the
// transcript: the outline is the digest the first pass already produced.
func (a *App) extractInspirationTakeaways(id string) error {
	video, err := a.GetInspirationVideo(id)
	if err != nil {
		return err
	}
	if strings.TrimSpace(video.Outline) == "" && len(video.Beats) == 0 {
		return fmt.Errorf("that video has not been studied yet")
	}

	var in strings.Builder
	fmt.Fprintf(&in, "# Video\nTitle: %s\n", video.Title)
	if video.DurationSecs > 0 {
		fmt.Fprintf(&in, "Duration: %s\n", formatClock(video.DurationSecs))
	}
	if video.Summary != "" {
		fmt.Fprintf(&in, "\n## Summary\n%s\n", video.Summary)
	}
	if video.Outline != "" {
		fmt.Fprintf(&in, "\n## Outline\n%s\n", video.Outline)
	}
	if len(video.Beats) > 0 {
		in.WriteString("\n## Beats\n")
		for _, b := range video.Beats {
			fmt.Fprintf(&in, "- [%s] %s — %s\n", formatClock(b.AtSecs), b.Title, b.Summary)
		}
	}
	if len(video.Mentions) > 0 {
		in.WriteString("\n## Named products, services & tools\n")
		for _, m := range video.Mentions {
			fmt.Fprintf(&in, "- %s (%s) %s\n", m.Name, m.Kind, m.Detail)
		}
	}

	text, err := a.askAIText(inspirationTakeawayInstructions, in.String())
	if err != nil {
		return err
	}
	var parsed struct {
		Takeaways []InspirationTakeaway `json:"takeaways"`
	}
	if err := json.Unmarshal([]byte(extractJSONObject(text)), &parsed); err != nil {
		return fmt.Errorf("the model's takeaways could not be read: %w", err)
	}
	if len(parsed.Takeaways) == 0 {
		return fmt.Errorf("the model returned no takeaways")
	}

	a.mutateInspirationVideo(id, func(v *InspirationVideo) {
		v.Takeaways = parsed.Takeaways
		v.TakeawaysAt = time.Now().UTC().Format(time.RFC3339)
	})
	return nil
}

// inspirationBackfill keeps the takeaway backfill to one run at a time: it is
// started at launch and again whenever the library changes shape.
var inspirationBackfill struct {
	sync.Mutex
	running bool
}

// backfillInspirationTakeaways works through the studied videos that have no
// takeaways yet, one at a time so the AI runner is never asked for two
// answers at once. It runs in the background at launch, so a video studied
// before this pass existed fills itself in without anyone opening its page.
func (a *App) backfillInspirationTakeaways() {
	inspirationBackfill.Lock()
	if inspirationBackfill.running {
		inspirationBackfill.Unlock()
		return
	}
	inspirationBackfill.running = true
	inspirationBackfill.Unlock()
	defer func() {
		inspirationBackfill.Lock()
		inspirationBackfill.running = false
		inspirationBackfill.Unlock()
	}()

	pending := []string{}
	for _, v := range a.getInspiration().Videos {
		if len(v.Takeaways) > 0 || strings.TrimSpace(v.Outline) == "" {
			continue
		}
		if v.Status != inspirationReady {
			continue
		}
		pending = append(pending, v.ID)
	}
	if len(pending) == 0 {
		return
	}
	log.Printf("jax: inspiration takeaways: %d video(s) to catch up on", len(pending))
	for _, id := range pending {
		if a.ctx == nil {
			return
		}
		a.inspirationStatus(id, inspirationExtracting, "", 0)
		if err := a.extractInspirationTakeaways(id); err != nil {
			log.Printf("jax: inspiration takeaways %s: %v", id, err)
			// Leave the video studied; the next launch tries again.
			a.inspirationStatus(id, inspirationReady, "", 0)
			continue
		}
		a.inspirationStatus(id, inspirationReady, "", 0)
	}
}

// DeleteInspirationVideo removes a video from the library and its downloaded
// copy from disk.
func (a *App) DeleteInspirationVideo(id string) error {
	lib := a.getInspiration()
	folder := ""
	out := make([]InspirationVideo, 0, len(lib.Videos))
	for _, v := range lib.Videos {
		if v.ID == id {
			folder = v.Folder
			continue
		}
		out = append(out, v)
	}
	lib.Videos = out
	if err := a.saveInspiration(lib); err != nil {
		return err
	}
	if folder != "" {
		if root, err := a.inspirationRoot(); err == nil {
			_ = os.RemoveAll(filepath.Join(root, filepath.FromSlash(folder)))
		}
	}
	return nil
}

// DeleteInspirationChannel removes a channel, its videos, and their files.
func (a *App) DeleteInspirationChannel(id string) error {
	lib := a.getInspiration()
	channels := make([]InspirationChannel, 0, len(lib.Channels))
	for _, c := range lib.Channels {
		if c.ID != id {
			channels = append(channels, c)
		}
	}
	lib.Channels = channels

	folders := []string{}
	videos := make([]InspirationVideo, 0, len(lib.Videos))
	for _, v := range lib.Videos {
		if v.ChannelID == id {
			if v.Folder != "" {
				folders = append(folders, v.Folder)
			}
			continue
		}
		videos = append(videos, v)
	}
	lib.Videos = videos
	if err := a.saveInspiration(lib); err != nil {
		return err
	}
	if root, err := a.inspirationRoot(); err == nil {
		for _, f := range folders {
			_ = os.RemoveAll(filepath.Join(root, filepath.FromSlash(f)))
		}
	}
	return nil
}

// formatClock renders seconds as h:mm:ss (or m:ss under an hour).
func formatClock(secs int) string {
	if secs < 0 {
		secs = 0
	}
	h, m, s := secs/3600, (secs%3600)/60, secs%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}

// extractJSONObject returns the outermost {...} of a model reply, so a stray
// sentence or code fence around the JSON does not break parsing.
func extractJSONObject(text string) string {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return text
	}
	return text[start : end+1]
}

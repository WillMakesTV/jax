package main

import (
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------------------
// Local media server
//
// Downloaded videos live outside the embedded frontend bundle and can be
// gigabytes each. Serving them through the Wails AssetServer buffers the whole
// response in memory (crashing on large files), and file:// is blocked in the
// webview. Instead we run a tiny loopback HTTP server that streams files with
// range support (http.ServeFile), so <video> can play and seek. 127.0.0.1 is a
// secure context for the webview, so playback from the app origin is allowed.
// ---------------------------------------------------------------------------

const mediaPrefix = "/media/"

// projectFilesPrefix serves project asset files (~/.jax/projects, see
// projects.go) alongside downloaded media.
const projectFilesPrefix = "/projectfiles/"

// sponsorFilesPrefix serves sponsor branding and campaign asset files
// (~/.jax/sponsors, see sponsors.go).
const sponsorFilesPrefix = "/sponsorfiles/"

// widgetFilesPrefix serves stream-widget images (~/.jax/widgets, see
// widget_images.go).
const widgetFilesPrefix = "/widgetfiles/"

// editsPrefix serves the video-plan edit workspaces (see editor.go). Their
// root is configured independently of the download folder (Settings →
// Videos), so it gets its own route.
const editsPrefix = "/edits/"

// planThumbsPrefix serves generated plan thumbnails (~/.jax/plan_thumbs, see
// plan_thumbs.go).
const planThumbsPrefix = "/planthumbs/"

// brandFilesPrefix serves the brand's uploaded assets (~/.jax/brand, see
// brand.go).
const brandFilesPrefix = "/brandfiles/"

// startMediaServer binds a loopback listener and serves downloaded media,
// recording the base URL on the app. Best-effort: on failure media playback is
// simply unavailable (mediaBaseURL stays empty).
func (a *App) startMediaServer() {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Printf("jax: media server listen: %v", err)
		return
	}
	a.mu.Lock()
	a.mediaBaseURL = "http://" + ln.Addr().String()
	a.mu.Unlock()

	srv := &http.Server{Handler: mediaHandler{app: a}}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("jax: media server: %v", err)
		}
	}()
}

type mediaHandler struct {
	app *App
}

func (h mediaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("jax: media handler panic: %v", rec)
			http.Error(w, "media error", http.StatusInternalServerError)
		}
	}()

	var base, rel string
	switch {
	case strings.HasPrefix(r.URL.Path, mediaPrefix):
		base = h.app.resolveDownloadDir()
		rel = strings.TrimPrefix(r.URL.Path, mediaPrefix)
	case strings.HasPrefix(r.URL.Path, editsPrefix):
		base = h.app.resolveEditRoot()
		rel = strings.TrimPrefix(r.URL.Path, editsPrefix)
	case strings.HasPrefix(r.URL.Path, projectFilesPrefix):
		dir, err := projectsDir()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		base = dir
		rel = strings.TrimPrefix(r.URL.Path, projectFilesPrefix)
	case strings.HasPrefix(r.URL.Path, sponsorFilesPrefix):
		dir, err := sponsorsDir()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		base = dir
		rel = strings.TrimPrefix(r.URL.Path, sponsorFilesPrefix)
	case strings.HasPrefix(r.URL.Path, widgetFilesPrefix):
		dir, err := widgetsDir()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		base = dir
		rel = strings.TrimPrefix(r.URL.Path, widgetFilesPrefix)
	case strings.HasPrefix(r.URL.Path, planThumbsPrefix):
		dir, err := planThumbsDir()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		base = dir
		rel = strings.TrimPrefix(r.URL.Path, planThumbsPrefix)
	case strings.HasPrefix(r.URL.Path, brandFilesPrefix):
		dir, err := brandDir()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		base = dir
		rel = strings.TrimPrefix(r.URL.Path, brandFilesPrefix)
	default:
		http.NotFound(w, r)
		return
	}
	base = filepath.Clean(base)
	full := resolveMediaPath(base, rel)
	if full == "" {
		// Some hosts deliver the raw (percent-encoded) path; try decoding.
		if dec, err := url.PathUnescape(rel); err == nil {
			full = resolveMediaPath(base, dec)
		}
	}
	if full == "" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, full)
}

// resolveMediaPath joins rel onto base, refusing anything that escapes base or
// is not a regular file. Returns "" when the file cannot be served.
func resolveMediaPath(base, rel string) string {
	full := filepath.Clean(filepath.Join(base, filepath.FromSlash(rel)))
	if full != base && !strings.HasPrefix(full, base+string(os.PathSeparator)) {
		return ""
	}
	if info, err := os.Stat(full); err != nil || info.IsDir() {
		return ""
	}
	return full
}

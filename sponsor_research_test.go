package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const researchTestHome = `<!doctype html>
<html><head>
<title> Acme Tools — build faster </title>
<meta name="description" content="Power tools for makers.">
<meta property="og:site_name" content="Acme Tools">
<meta property="og:image" content="/img/social-card.png">
<link rel="apple-touch-icon" href="/img/touch.png">
<link rel="icon" href="/img/favicon.svg">
<link rel="stylesheet" href="/site.css">
<style>body { color: red }</style>
<script>console.log("<b>not text</b>")</script>
</head><body>
<img class="site-logo" src="/img/logo.png" alt="Acme">
<img src="/img/hero.jpg" alt="workbench">
<p>Acme builds power tools for makers and small shops.</p>
</body></html>`

func TestHomepageParsing(t *testing.T) {
	base, _ := url.Parse("https://acme.example")

	if got := firstMatch(researchTestHome, `(?is)<title[^>]*>(.*?)</title>`); got != "Acme Tools — build faster" {
		t.Fatalf("title = %q", got)
	}
	if got := metaContent(researchTestHome, "description"); got != "Power tools for makers." {
		t.Fatalf("meta description = %q", got)
	}
	if got := metaContent(researchTestHome, "og:site_name"); got != "Acme Tools" {
		t.Fatalf("og:site_name = %q", got)
	}

	text := visibleText(researchTestHome, 6000)
	if !strings.Contains(text, "power tools for makers") {
		t.Fatalf("visible text missing body copy: %q", text)
	}
	if strings.Contains(text, "console.log") || strings.Contains(text, "color: red") {
		t.Fatalf("visible text kept script/style content: %q", text)
	}

	got := brandingCandidates(researchTestHome, base)
	want := []string{
		"https://acme.example/img/touch.png",
		"https://acme.example/img/favicon.svg",
		"https://acme.example/img/social-card.png",
		"https://acme.example/img/logo.png",
	}
	if len(got) != len(want) {
		t.Fatalf("candidates = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidates[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestSitemapLocs(t *testing.T) {
	xml := `<?xml version="1.0"?>
<urlset><url><loc> https://acme.example/ </loc></url>
<url><loc>https://acme.example/pricing</loc></url></urlset>`
	got := sitemapLocs(xml)
	if len(got) != 2 || got[0] != "https://acme.example/" || got[1] != "https://acme.example/pricing" {
		t.Fatalf("locs = %v", got)
	}
}

func TestNormalizeSiteURL(t *testing.T) {
	u, err := normalizeSiteURL("acme.example/shop")
	if err != nil || u.String() != "https://acme.example/shop" {
		t.Fatalf("bare host: %v %v", u, err)
	}
	u, err = normalizeSiteURL("http://acme.example")
	if err != nil || u.Scheme != "http" {
		t.Fatalf("explicit scheme kept: %v %v", u, err)
	}
	if _, err := normalizeSiteURL("   "); err == nil {
		t.Fatal("want error for a blank URL")
	}
}

func TestBrandingFileName(t *testing.T) {
	if got := brandingFileName("https://a.example/img/logo.png?v=2", "image/png"); got != "logo.png" {
		t.Fatalf("name = %q", got)
	}
	if got := brandingFileName("https://a.example/icon", "image/svg+xml"); got != "icon.svg" {
		t.Fatalf("extensionless name = %q", got)
	}
	if got := brandingFileName("https://a.example/", "image/x-icon"); got != "logo.ico" {
		t.Fatalf("bare-path name = %q", got)
	}
}

func TestDownloadSponsorBranding(t *testing.T) {
	a := newTestApp(t)
	s, err := a.SaveSponsor(Sponsor{Name: "Acme"})
	if err != nil {
		t.Fatalf("save sponsor: %v", err)
	}

	// A tiny fake site: one real logo, one candidate that 404s, and a favicon
	// that must NOT be fetched because a better image succeeded.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/img/logo.png":
			w.Header().Set("Content-Type", "image/png")
			fmt.Fprint(w, "png-bytes")
		case "/favicon.ico":
			w.Header().Set("Content-Type", "image/x-icon")
			fmt.Fprint(w, "ico-bytes")
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	base, _ := url.Parse(srv.URL)

	client := &http.Client{Timeout: 5 * time.Second}
	site := sponsorSite{
		branding: []string{srv.URL + "/img/logo.png", srv.URL + "/img/missing.png"},
		favicon:  srv.URL + "/favicon.ico",
	}
	files := a.downloadSponsorBranding(client, base, s.ID, site, nil)
	if len(files) != 1 || files[0].Name != "logo.png" || files[0].SizeBytes != int64(len("png-bytes")) {
		t.Fatalf("files = %+v", files)
	}

	// Re-running skips the already-recorded name instead of duplicating it.
	again := a.downloadSponsorBranding(client, base, s.ID, site, files)
	if len(again) != 0 {
		t.Fatalf("re-run should skip existing names, got %+v", again)
	}

	// With no candidates at all, the favicon is the fallback logo.
	fallback := a.downloadSponsorBranding(client, base, s.ID, sponsorSite{favicon: srv.URL + "/favicon.ico"}, nil)
	if len(fallback) != 1 || fallback[0].Name != "favicon.ico" {
		t.Fatalf("favicon fallback = %+v", fallback)
	}
}

package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Sponsor research
//
// "Generate with AI" on a sponsor's page: the sponsor's website is read —
// homepage, llms.txt when the site publishes one, and the sitemap for a map
// of its public pages — and the material is handed to the connected AI to
// write the sponsor's description. Images the homepage marks as identity
// (icons, social-card images, logo-named <img> tags) are downloaded into the
// sponsor's branding uploads, with the favicon as a last resort so every
// sponsor ends up with at least a logo.
// ---------------------------------------------------------------------------

const sponsorResearchInstructions = `You research a channel sponsor from its public website and write the sponsor's description for a producer's records.

Write a concise markdown document (no top-level heading) covering, as far as the material shows: what the company makes or sells, who it serves, notable products or services, how it positions itself, and anything useful to a creator presenting them on stream. State only what the material supports — never invent specifics the pages don't show. Reply with the markdown description only, no preamble.`

// sponsorSite is what the website read gathers: the document the model reads
// and the image URLs worth trying as branding.
type sponsorSite struct {
	doc string
	// branding is ordered by confidence: touch icons and social-card images
	// first, then logo-named <img> tags.
	branding []string
	// favicon is the conventional /favicon.ico, tried only when nothing in
	// branding could be downloaded.
	favicon string
}

// GenerateSponsorDescription researches the sponsor's website, writes its
// description with the connected AI, downloads likely logo/branding images
// into the sponsor's branding uploads, and returns the updated sponsor.
func (a *App) GenerateSponsorDescription(sponsorID string) (Sponsor, error) {
	var target Sponsor
	found := false
	for _, s := range a.getSponsors() {
		if s.ID == sponsorID {
			target, found = s, true
			break
		}
	}
	if !found {
		return Sponsor{}, fmt.Errorf("that sponsor no longer exists")
	}
	if strings.TrimSpace(target.Website) == "" {
		return Sponsor{}, fmt.Errorf("give the sponsor a website first — the research starts there")
	}

	base, err := normalizeSiteURL(target.Website)
	if err != nil {
		return Sponsor{}, fmt.Errorf("the website URL could not be understood: %w", err)
	}

	client := &http.Client{Timeout: 20 * time.Second}
	site := fetchSponsorSite(client, base, target.Name)

	desc, err := a.askAIText(sponsorResearchInstructions, site.doc)
	if err != nil {
		return Sponsor{}, err
	}
	desc = strings.TrimSpace(desc)
	if desc == "" {
		return Sponsor{}, fmt.Errorf("the model returned an empty description — try again")
	}

	// Branding is best-effort: a description with no logo is still a result.
	files := a.downloadSponsorBranding(client, base, sponsorID, site, target.Branding)

	return a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		s.Description = desc
		s.Branding = append(s.Branding, files...)
		return nil
	})
}

// normalizeSiteURL parses a website field, tolerating a missing scheme.
func normalizeSiteURL(website string) (*url.URL, error) {
	raw := strings.TrimSpace(website)
	if !regexp.MustCompile(`(?i)^https?://`).MatchString(raw) {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Host == "" {
		return nil, fmt.Errorf("no host in %q", website)
	}
	return u, nil
}

// fetchSponsorSite reads the homepage, llms.txt, and sitemap, and assembles
// the research document. Every fetch is best-effort: whatever the site
// doesn't offer simply thins the document.
func fetchSponsorSite(client *http.Client, base *url.URL, name string) sponsorSite {
	var b strings.Builder
	fmt.Fprintf(&b, "# Sponsor\nName: %s\nWebsite: %s\n", name, base.String())

	site := sponsorSite{favicon: resolveURL(base, "/favicon.ico")}

	if body, ct, err := fetchLimited(client, base.String(), 1<<20); err == nil &&
		strings.Contains(ct, "html") {
		html := string(body)
		b.WriteString("\n# Homepage\n")
		if t := firstMatch(html, `(?is)<title[^>]*>(.*?)</title>`); t != "" {
			fmt.Fprintf(&b, "Title: %s\n", collapseSpace(t))
		}
		if d := metaContent(html, "description"); d != "" {
			fmt.Fprintf(&b, "Meta description: %s\n", collapseSpace(d))
		}
		if sn := metaContent(html, "og:site_name"); sn != "" {
			fmt.Fprintf(&b, "Site name: %s\n", collapseSpace(sn))
		}
		if od := metaContent(html, "og:description"); od != "" {
			fmt.Fprintf(&b, "Social description: %s\n", collapseSpace(od))
		}
		if text := visibleText(html, 6000); text != "" {
			b.WriteString("\n## Page text\n")
			b.WriteString(text)
			b.WriteString("\n")
		}
		site.branding = brandingCandidates(html, base)
	}

	if body, ct, err := fetchLimited(client, resolveURL(base, "/llms.txt"), 128<<10); err == nil &&
		!strings.Contains(ct, "html") && len(strings.TrimSpace(string(body))) > 0 {
		b.WriteString("\n# llms.txt\n")
		b.Write(body)
		b.WriteString("\n")
	}

	if locs := fetchSitemapLocs(client, base); len(locs) > 0 {
		b.WriteString("\n# Public pages (from the sitemap)\n")
		for _, loc := range locs {
			fmt.Fprintf(&b, "- %s\n", loc)
		}
	}

	site.doc = b.String()
	return site
}

// fetchLimited GETs a URL and returns at most limit bytes of the body plus
// the response content type. Non-2xx statuses are errors.
func fetchLimited(client *http.Client, u string, limit int64) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "jax-sponsor-research/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, "", fmt.Errorf("GET %s: %s", u, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	if err != nil {
		return nil, "", err
	}
	return body, resp.Header.Get("Content-Type"), nil
}

// fetchSitemapLocs finds the site's sitemap (robots.txt first, then the
// conventional /sitemap.xml) and returns up to 40 page URLs. A sitemap index
// is followed one level down.
func fetchSitemapLocs(client *http.Client, base *url.URL) []string {
	sitemaps := []string{}
	if body, _, err := fetchLimited(client, resolveURL(base, "/robots.txt"), 64<<10); err == nil {
		for _, line := range strings.Split(string(body), "\n") {
			trimmed := strings.TrimSpace(line)
			if len(trimmed) > 8 && strings.EqualFold(trimmed[:8], "sitemap:") {
				if u := strings.TrimSpace(trimmed[8:]); u != "" {
					sitemaps = append(sitemaps, u)
				}
			}
		}
	}
	if len(sitemaps) == 0 {
		sitemaps = []string{resolveURL(base, "/sitemap.xml")}
	}

	const maxLocs = 40
	locs := []string{}
	for _, sm := range sitemaps {
		if len(locs) >= maxLocs {
			break
		}
		body, _, err := fetchLimited(client, sm, 1<<20)
		if err != nil {
			continue
		}
		entries := sitemapLocs(string(body))
		// A sitemap index lists further sitemaps; follow the first one.
		if strings.Contains(string(body), "<sitemapindex") && len(entries) > 0 {
			if nested, _, err := fetchLimited(client, entries[0], 1<<20); err == nil {
				entries = sitemapLocs(string(nested))
			}
		}
		for _, loc := range entries {
			if len(locs) >= maxLocs {
				break
			}
			locs = append(locs, loc)
		}
	}
	return locs
}

var locPattern = regexp.MustCompile(`(?is)<loc>\s*(.*?)\s*</loc>`)

// sitemapLocs pulls every <loc> value out of a sitemap document.
func sitemapLocs(xml string) []string {
	out := []string{}
	for _, m := range locPattern.FindAllStringSubmatch(xml, -1) {
		if loc := strings.TrimSpace(m[1]); loc != "" {
			out = append(out, loc)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Homepage parsing (regex-based: the site is untrusted input and only hints
// are needed, so a tolerant scrape beats a strict parse)
// ---------------------------------------------------------------------------

// firstMatch returns the first capture of pattern in html, or "".
func firstMatch(html, pattern string) string {
	if m := regexp.MustCompile(pattern).FindStringSubmatch(html); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// metaContent finds a <meta> tag's content by its name or property.
func metaContent(html, key string) string {
	q := regexp.QuoteMeta(key)
	// name/property before content, then the reverse attribute order.
	if v := firstMatch(html,
		`(?is)<meta[^>]+(?:name|property)\s*=\s*["']`+q+`["'][^>]*\scontent\s*=\s*["']([^"']*)["']`); v != "" {
		return v
	}
	return firstMatch(html,
		`(?is)<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*\s(?:name|property)\s*=\s*["']`+q+`["']`)
}

var (
	scriptPattern = regexp.MustCompile(`(?is)<(script|style|noscript|svg)[^>]*>.*?</\s*(?:script|style|noscript|svg)\s*>`)
	tagPattern    = regexp.MustCompile(`(?s)<[^>]*>`)
	spacePattern  = regexp.MustCompile(`\s+`)
)

// visibleText strips markup from an HTML document and returns up to max
// characters of the readable text.
func visibleText(html string, max int) string {
	text := scriptPattern.ReplaceAllString(html, " ")
	text = tagPattern.ReplaceAllString(text, " ")
	text = collapseSpace(text)
	if len(text) > max {
		text = text[:max]
	}
	return strings.TrimSpace(text)
}

func collapseSpace(s string) string {
	return strings.TrimSpace(spacePattern.ReplaceAllString(s, " "))
}

var (
	linkTagPattern = regexp.MustCompile(`(?is)<link[^>]+>`)
	relPattern     = regexp.MustCompile(`(?is)rel\s*=\s*["']([^"']*)["']`)
	hrefPattern    = regexp.MustCompile(`(?is)href\s*=\s*["']([^"']*)["']`)
	imgTagPattern  = regexp.MustCompile(`(?is)<img[^>]+>`)
	srcPattern     = regexp.MustCompile(`(?is)src\s*=\s*["']([^"']*)["']`)
)

// brandingCandidates collects the homepage's likely identity images, most
// confident first: apple-touch/regular icons, the social-card images, then
// <img> tags that name themselves a logo. All URLs are resolved absolute.
func brandingCandidates(html string, base *url.URL) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" || strings.HasPrefix(raw, "data:") {
			return
		}
		u := resolveURL(base, raw)
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		out = append(out, u)
	}

	// Icons declared in <head> — the site's own idea of its mark.
	for _, tag := range linkTagPattern.FindAllString(html, -1) {
		rel := ""
		if m := relPattern.FindStringSubmatch(tag); len(m) > 1 {
			rel = strings.ToLower(m[1])
		}
		if !strings.Contains(rel, "icon") {
			continue
		}
		if m := hrefPattern.FindStringSubmatch(tag); len(m) > 1 {
			add(m[1])
		}
	}
	// Social-card images: usually the wordmark or hero branding.
	if og := metaContent(html, "og:image"); og != "" {
		add(og)
	}
	if tw := metaContent(html, "twitter:image"); tw != "" {
		add(tw)
	}
	// <img> tags that call themselves a logo.
	for _, tag := range imgTagPattern.FindAllString(html, -1) {
		if !strings.Contains(strings.ToLower(tag), "logo") {
			continue
		}
		if m := srcPattern.FindStringSubmatch(tag); len(m) > 1 {
			add(m[1])
		}
	}
	return out
}

// resolveURL resolves ref against base, returning "" when it cannot be made
// into an absolute http(s) URL.
func resolveURL(base *url.URL, ref string) string {
	r, err := url.Parse(strings.TrimSpace(ref))
	if err != nil {
		return ""
	}
	abs := base.ResolveReference(r)
	if abs.Scheme != "http" && abs.Scheme != "https" {
		return ""
	}
	return abs.String()
}

// ---------------------------------------------------------------------------
// Branding downloads
// ---------------------------------------------------------------------------

// imageExtByType names files whose URL carries no usable extension.
var imageExtByType = map[string]string{
	"image/png":                ".png",
	"image/jpeg":               ".jpg",
	"image/gif":                ".gif",
	"image/webp":               ".webp",
	"image/svg+xml":            ".svg",
	"image/x-icon":             ".ico",
	"image/vnd.microsoft.icon": ".ico",
	"image/avif":               ".avif",
}

// downloadSponsorBranding pulls the site's identity images (capped at four)
// into the sponsor's branding folder and returns their records. When nothing
// downloads, the favicon is tried so the sponsor still gets a logo. Images
// whose name is already recorded are skipped rather than duplicated on a
// re-run.
func (a *App) downloadSponsorBranding(client *http.Client, base *url.URL, sponsorID string, site sponsorSite, existing []SponsorFile) []SponsorFile {
	dir, err := sponsorBrandingDir(sponsorID)
	if err != nil {
		return nil
	}
	have := map[string]bool{}
	for _, f := range existing {
		have[f.Name] = true
	}

	const maxFiles = 4
	files := []SponsorFile{}
	fetchInto := func(u string) {
		if len(files) >= maxFiles {
			return
		}
		body, ct, err := fetchLimited(client, u, 8<<20)
		if err != nil || len(body) == 0 {
			return
		}
		ct = strings.TrimSpace(strings.Split(ct, ";")[0])
		if !strings.HasPrefix(ct, "image/") {
			return
		}
		name := brandingFileName(u, ct)
		if have[name] {
			return
		}
		// Deduplicate on disk the way copyIntoDir does.
		ext := filepath.Ext(name)
		stem := strings.TrimSuffix(name, ext)
		final := name
		for n := 2; ; n++ {
			if _, err := os.Stat(filepath.Join(dir, final)); os.IsNotExist(err) {
				break
			}
			final = fmt.Sprintf("%s (%d)%s", stem, n, ext)
		}
		if err := os.WriteFile(filepath.Join(dir, final), body, 0o600); err != nil {
			return
		}
		have[name] = true
		files = append(files, SponsorFile{
			ID:        fmt.Sprintf("file_%d", time.Now().UnixNano()),
			Name:      final,
			SizeBytes: int64(len(body)),
			AddedAt:   time.Now().UTC().Format(time.RFC3339),
		})
	}

	for _, u := range site.branding {
		fetchInto(u)
	}
	// The favicon is a last resort: only when this run found nothing AND the
	// sponsor has no branding at all does it stand in as the logo.
	if len(files) == 0 && len(existing) == 0 && site.favicon != "" {
		fetchInto(site.favicon)
	}
	return files
}

// brandingFileName derives a safe local filename for a downloaded image.
func brandingFileName(u, contentType string) string {
	name := "logo"
	if parsed, err := url.Parse(u); err == nil {
		if b := path.Base(parsed.Path); b != "" && b != "/" && b != "." {
			name = b
		}
	}
	// Keep the name a plain file name whatever the URL held.
	name = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '-'
		}
		return r
	}, name)
	if filepath.Ext(name) == "" {
		if ext, ok := imageExtByType[contentType]; ok {
			name += ext
		} else {
			name += ".img"
		}
	}
	return name
}

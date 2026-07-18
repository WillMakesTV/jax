package main

import (
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
// Brand assets
//
// Uploaded files that define the brand — logos, banners, overlays, palettes,
// fonts — kept app-wide (unlike project assets, which belong to one project)
// so any feature can reference them. Metadata is a JSON blob in the settings
// table; the files live under ~/.jax/brand/assets and are served by the
// loopback media server (see media.go). Managed from the Profile page's
// Brand Assets tab.
// ---------------------------------------------------------------------------

// BrandAsset is one uploaded brand file.
type BrandAsset struct {
	ID string `json:"id"`
	// Name is the file's name on disk inside the brand assets folder.
	Name        string `json:"name"`
	Description string `json:"description"`
	SizeBytes   int64  `json:"sizeBytes"`
	AddedAt     string `json:"addedAt"`
	// MediaURL is the app-served URL of the file ("/brandfiles/assets/...");
	// computed on read, never persisted.
	MediaURL string `json:"mediaUrl"`
}

// keyBrandAssets stores the brand-asset metadata list.
const keyBrandAssets = "brand_assets"

// brandDir returns the root directory holding brand files (~/.jax/brand),
// creating it if necessary.
func brandDir() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(dir, "brand")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	return root, nil
}

// brandAssetsDir returns the brand assets folder, creating it if needed.
func brandAssetsDir() (string, error) {
	root, err := brandDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "assets")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// getBrandAssets reads the raw stored list (no URL filling). Never nil.
func (a *App) getBrandAssets() []BrandAsset {
	if a.store == nil {
		return []BrandAsset{}
	}
	var assets []BrandAsset
	if _, err := a.store.getJSON(keyBrandAssets, &assets); err != nil {
		log.Printf("jax: getBrandAssets: %v", err)
	}
	if assets == nil {
		return []BrandAsset{}
	}
	return assets
}

// fillBrandAssetURLs stamps each asset's app-served URL.
func (a *App) fillBrandAssetURLs(assets []BrandAsset) {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()
	for i := range assets {
		assets[i].MediaURL = base + brandFilesPrefix + "assets/" +
			url.PathEscape(assets[i].Name)
	}
}

// GetBrandAssets returns the brand's uploaded assets, newest first. Never nil.
func (a *App) GetBrandAssets() []BrandAsset {
	assets := a.getBrandAssets()
	a.fillBrandAssetURLs(assets)
	return assets
}

// saveBrandAssets persists the list and hands it back URL-filled.
func (a *App) saveBrandAssets(assets []BrandAsset) ([]BrandAsset, error) {
	if a.store == nil {
		return nil, fmt.Errorf("storage unavailable")
	}
	if err := a.store.setJSON(keyBrandAssets, assets); err != nil {
		return nil, err
	}
	a.fillBrandAssetURLs(assets)
	return assets, nil
}

// AddBrandAssets opens a native multi-file picker and copies the chosen files
// into the brand assets folder, recording one asset per file. Returns the
// updated list (unchanged when the picker is cancelled).
func (a *App) AddBrandAssets() ([]BrandAsset, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("no window context")
	}
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Add brand assets",
	})
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return a.GetBrandAssets(), nil
	}

	dir, err := brandAssetsDir()
	if err != nil {
		return nil, err
	}
	assets := a.getBrandAssets()
	for _, src := range paths {
		name, size, err := copyIntoDir(src, dir)
		if err != nil {
			return nil, fmt.Errorf("could not copy %s: %w", filepath.Base(src), err)
		}
		assets = append([]BrandAsset{{
			ID:        fmt.Sprintf("brand_%d", time.Now().UnixNano()),
			Name:      name,
			SizeBytes: size,
			AddedAt:   time.Now().UTC().Format(time.RFC3339),
		}}, assets...)
	}
	return a.saveBrandAssets(assets)
}

// UpdateBrandAsset sets an asset's description and returns the updated list.
func (a *App) UpdateBrandAsset(assetID, description string) ([]BrandAsset, error) {
	assets := a.getBrandAssets()
	for i := range assets {
		if assets[i].ID == assetID {
			assets[i].Description = description
			return a.saveBrandAssets(assets)
		}
	}
	return nil, fmt.Errorf("that file no longer exists")
}

// ---------------------------------------------------------------------------
// Brand links
//
// The brand's outward links — social profiles, website, store — shown on the
// Profile page's Links tab. Each link's favicon is fetched once (Google's
// favicon service resolves it for any host, popular platforms included) and
// cached under ~/.jax/brand/icons, so the labels render with the service's
// logo even offline.
// ---------------------------------------------------------------------------

// BrandLink is one outward link of the brand.
type BrandLink struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	URL   string `json:"url"`
	// IconFile is the cached favicon's name inside brand/icons ("" when the
	// icon could not be fetched).
	IconFile string `json:"iconFile"`
	AddedAt  string `json:"addedAt"`
	// IconURL is the app-served URL of the cached favicon; computed on read.
	IconURL string `json:"iconUrl"`
}

// keyBrandLinks stores the brand-link list.
const keyBrandLinks = "brand_links"

// brandIconsDir returns the cached-favicon folder, creating it if needed.
func brandIconsDir() (string, error) {
	root, err := brandDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "icons")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

var faviconHTTP = &http.Client{Timeout: 5 * time.Second}

// fetchFavicon caches the favicon for a link's host and returns the cached
// filename ("" when the host is unknown or the fetch failed — the frontend
// falls back to a generic icon). Cached per host, so several links to the
// same service share one file.
func fetchFavicon(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	dir, err := brandIconsDir()
	if err != nil {
		return ""
	}
	name := sanitizeFileName(host) + ".png"
	path := filepath.Join(dir, name)
	if fileExists(path) {
		return name
	}

	// Google's favicon service resolves icons for any site, the popular
	// platforms included, without per-service scraping.
	resp, err := faviconHTTP.Get(
		"https://www.google.com/s2/favicons?sz=64&domain=" + url.QueryEscape(host))
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || len(raw) == 0 {
		return ""
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return ""
	}
	return name
}

// getBrandLinks reads the raw stored list (no URL filling). Never nil.
func (a *App) getBrandLinks() []BrandLink {
	if a.store == nil {
		return []BrandLink{}
	}
	var links []BrandLink
	if _, err := a.store.getJSON(keyBrandLinks, &links); err != nil {
		log.Printf("jax: getBrandLinks: %v", err)
	}
	if links == nil {
		return []BrandLink{}
	}
	return links
}

// fillBrandLinkURLs stamps each link's app-served favicon URL.
func (a *App) fillBrandLinkURLs(links []BrandLink) {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()
	for i := range links {
		if links[i].IconFile != "" {
			links[i].IconURL = base + brandFilesPrefix + "icons/" +
				url.PathEscape(links[i].IconFile)
		}
	}
}

// GetBrandLinks returns the brand's links in their stored order. Never nil.
func (a *App) GetBrandLinks() []BrandLink {
	links := a.getBrandLinks()
	a.fillBrandLinkURLs(links)
	return links
}

// saveBrandLinks persists the list and hands it back URL-filled.
func (a *App) saveBrandLinks(links []BrandLink) ([]BrandLink, error) {
	if a.store == nil {
		return nil, fmt.Errorf("storage unavailable")
	}
	if err := a.store.setJSON(keyBrandLinks, links); err != nil {
		return nil, err
	}
	a.fillBrandLinkURLs(links)
	return links, nil
}

// SaveBrandLink upserts a link (matched by ID; "" creates), normalising the
// URL and refreshing the cached favicon, and returns the updated list.
func (a *App) SaveBrandLink(link BrandLink) ([]BrandLink, error) {
	link.URL = strings.TrimSpace(link.URL)
	if link.URL == "" {
		return nil, fmt.Errorf("a URL is required")
	}
	// Bare "example.com/handle" entries are fine; default them to https.
	if !strings.Contains(link.URL, "://") {
		link.URL = "https://" + link.URL
	}
	if parsed, err := url.Parse(link.URL); err != nil || parsed.Hostname() == "" {
		return nil, fmt.Errorf("that does not look like a valid URL")
	}
	link.Label = strings.TrimSpace(link.Label)
	link.IconFile = fetchFavicon(link.URL)
	if link.ID == "" {
		link.ID = fmt.Sprintf("brandlink_%d", time.Now().UnixNano())
	}
	if link.AddedAt == "" {
		link.AddedAt = time.Now().UTC().Format(time.RFC3339)
	}

	links := a.getBrandLinks()
	replaced := false
	for i := range links {
		if links[i].ID == link.ID {
			links[i] = link
			replaced = true
			break
		}
	}
	if !replaced {
		links = append(links, link)
	}
	return a.saveBrandLinks(links)
}

// linkHost returns a URL's bare hostname ("" when unparsable).
func linkHost(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
}

// brandLinksText renders the profile's brand links (Profile → Links) as a
// prompt block. Every AI feature that drafts outward-facing copy — stream and
// video plan descriptions, edit-session directions — appends this, so the
// audience-facing links are always at hand and never invented. Returns ""
// when no links are saved.
func (a *App) brandLinksText() string {
	links := a.getBrandLinks()
	if len(links) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("# Brand links\n")
	for _, l := range links {
		fmt.Fprintf(&b, "- %s: %s\n", firstNonEmpty(l.Label, linkHost(l.URL), "Link"), l.URL)
	}
	return b.String()
}

// DeleteBrandLink removes a link and returns the updated list. Cached icons
// stay put — they are shared per host and tiny.
func (a *App) DeleteBrandLink(id string) ([]BrandLink, error) {
	links := a.getBrandLinks()
	out := links[:0]
	for _, l := range links {
		if l.ID != id {
			out = append(out, l)
		}
	}
	return a.saveBrandLinks(out)
}

// DeleteBrandAsset removes an asset's metadata and its file on disk, and
// returns the updated list.
func (a *App) DeleteBrandAsset(assetID string) ([]BrandAsset, error) {
	assets := a.getBrandAssets()
	name := ""
	out := assets[:0]
	for _, asset := range assets {
		if asset.ID == assetID {
			name = asset.Name
			continue
		}
		out = append(out, asset)
	}
	updated, err := a.saveBrandAssets(out)
	if err != nil {
		return nil, err
	}
	if name != "" {
		if dir, derr := brandAssetsDir(); derr == nil {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
	return updated, nil
}

// ---------------------------------------------------------------------------
// Branding guidelines
//
// The brand's written rules — voice, tone, colors, typography, dos and
// don'ts — authored as markdown on the Profile page's Brand Assets tab.
// Readable over MCP (get_brand_guidelines) so every AI feature producing
// brand-facing visuals or copy can consult them instead of guessing.
// ---------------------------------------------------------------------------

// keyBrandGuidelines stores the markdown branding-guidelines document.
const keyBrandGuidelines = "brand_guidelines"

// GetBrandGuidelines returns the brand's written guidelines (markdown; ”
// when none have been written).
func (a *App) GetBrandGuidelines() string {
	if a.store == nil {
		return ""
	}
	text, err := a.store.getSetting(keyBrandGuidelines)
	if err != nil {
		log.Printf("jax: read brand guidelines: %v", err)
		return ""
	}
	return text
}

// SetBrandGuidelines stores the guidelines document.
func (a *App) SetBrandGuidelines(markdown string) error {
	if a.store == nil {
		return fmt.Errorf("store is not open")
	}
	return a.store.setSetting(keyBrandGuidelines, strings.TrimSpace(markdown))
}

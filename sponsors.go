package main

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ---------------------------------------------------------------------------
// Sponsors
//
// A Sponsor is a brand partner with a name, website, markdown description, and
// uploaded branding files. Each sponsor carries campaigns — dated engagements
// with their own messaging, promotion details, and asset uploads. Metadata is
// stored as a single JSON blob in the settings table; files live on disk under
// ~/.jax/sponsors/<id>/branding and ~/.jax/sponsors/<id>/campaigns/<cid> and
// are served by the loopback media server (see media.go).
// ---------------------------------------------------------------------------

// SponsorFile is one uploaded file belonging to a sponsor (branding) or one of
// its campaigns (assets).
type SponsorFile struct {
	ID string `json:"id"`
	// Name is the file's name on disk inside its owning folder.
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
	AddedAt   string `json:"addedAt"`
	// MediaURL is the app-served URL of the file ("/sponsorfiles/...");
	// computed on read, never persisted.
	MediaURL string `json:"mediaUrl"`
}

// SponsorCampaign is one dated engagement run for a sponsor.
type SponsorCampaign struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// StartDate/EndDate are calendar dates ("2026-07-18"); either may be
	// empty while the campaign is being drafted.
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	// Messaging and PromotionDetails are markdown.
	Messaging        string        `json:"messaging"`
	PromotionDetails string        `json:"promotionDetails"`
	Assets           []SponsorFile `json:"assets"`
	CreatedAt        string        `json:"createdAt"`
}

// Sponsor is a brand partner whose campaigns the producer runs.
type Sponsor struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Website string `json:"website"`
	// Description is markdown.
	Description string `json:"description"`
	// SelfPromotion marks a sponsor owned (or part-owned) by the streamer,
	// so mentions of it can carry the required disclaimers.
	SelfPromotion bool `json:"selfPromotion"`
	// LogoFileID names which branding file serves as the sponsor's logo
	// ("" = none); LogoURL is derived on read, never persisted.
	LogoFileID string            `json:"logoFileId"`
	LogoURL    string            `json:"logoUrl"`
	Branding   []SponsorFile     `json:"branding"`
	Campaigns  []SponsorCampaign `json:"campaigns"`
	CreatedAt  string            `json:"createdAt"`
}

// sponsorsDir returns the root directory holding per-sponsor files
// (~/.jax/sponsors), creating it if necessary.
func sponsorsDir() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(dir, "sponsors")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	return root, nil
}

// sponsorBrandingDir returns a sponsor's branding directory, creating it if
// needed.
func sponsorBrandingDir(sponsorID string) (string, error) {
	root, err := sponsorsDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, sponsorID, "branding")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// campaignAssetsDir returns a campaign's asset directory, creating it if
// needed.
func campaignAssetsDir(sponsorID, campaignID string) (string, error) {
	root, err := sponsorsDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, sponsorID, "campaigns", campaignID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// fillSponsorURLs stamps each file's app-served URL. Slices are also
// normalised so the Wails bindings marshal arrays rather than null.
func (a *App) fillSponsorURLs(s *Sponsor) {
	a.mu.Lock()
	base := a.mediaBaseURL
	a.mu.Unlock()

	if s.Branding == nil {
		s.Branding = []SponsorFile{}
	}
	if s.Campaigns == nil {
		s.Campaigns = []SponsorCampaign{}
	}
	s.LogoURL = ""
	for i := range s.Branding {
		s.Branding[i].MediaURL = base + sponsorFilesPrefix +
			url.PathEscape(s.ID) + "/branding/" +
			url.PathEscape(s.Branding[i].Name)
		if s.Branding[i].ID == s.LogoFileID {
			s.LogoURL = s.Branding[i].MediaURL
		}
	}
	for i := range s.Campaigns {
		c := &s.Campaigns[i]
		if c.Assets == nil {
			c.Assets = []SponsorFile{}
		}
		for j := range c.Assets {
			c.Assets[j].MediaURL = base + sponsorFilesPrefix +
				url.PathEscape(s.ID) + "/campaigns/" +
				url.PathEscape(c.ID) + "/" +
				url.PathEscape(c.Assets[j].Name)
		}
	}
}

// getSponsors reads the raw stored sponsor list (no URL filling). Never nil.
func (a *App) getSponsors() []Sponsor {
	if a.store == nil {
		return []Sponsor{}
	}
	var sponsors []Sponsor
	if _, err := a.store.getJSON(keySponsors, &sponsors); err != nil {
		log.Printf("jax: getSponsors: %v", err)
	}
	if sponsors == nil {
		return []Sponsor{}
	}
	return sponsors
}

// GetSponsors returns the saved sponsors, newest first. Never nil.
func (a *App) GetSponsors() []Sponsor {
	sponsors := a.getSponsors()
	for i := range sponsors {
		a.fillSponsorURLs(&sponsors[i])
	}
	return sponsors
}

// SaveSponsor upserts a sponsor's name, website, and description (matched by
// ID), assigning an ID and creation time on first save, and returns the stored
// value. Branding and campaigns are managed by their own methods and are
// preserved as stored — the supplied copies are ignored.
func (a *App) SaveSponsor(s Sponsor) (Sponsor, error) {
	if a.store == nil {
		return s, fmt.Errorf("storage unavailable")
	}
	if strings.TrimSpace(s.Name) == "" {
		return s, fmt.Errorf("a sponsor name is required")
	}

	all := a.getSponsors()
	if s.ID == "" {
		s.ID = fmt.Sprintf("sponsor_%d", time.Now().UnixNano())
	}
	if s.CreatedAt == "" {
		s.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	// Derived per read, never persisted.
	s.LogoURL = ""

	replaced := false
	for i, existing := range all {
		if existing.ID == s.ID {
			s.Branding = existing.Branding
			s.Campaigns = existing.Campaigns
			s.LogoFileID = existing.LogoFileID
			all[i] = s
			replaced = true
			break
		}
	}
	if !replaced {
		s.Branding = []SponsorFile{}
		s.Campaigns = []SponsorCampaign{}
		s.LogoFileID = ""
		all = append([]Sponsor{s}, all...)
	}

	if err := a.store.setJSON(keySponsors, all); err != nil {
		return s, err
	}
	a.fillSponsorURLs(&s)
	return s, nil
}

// DeleteSponsor removes a sponsor and its on-disk files.
func (a *App) DeleteSponsor(id string) error {
	if a.store == nil {
		return fmt.Errorf("storage unavailable")
	}
	all := a.getSponsors()
	out := make([]Sponsor, 0, len(all))
	for _, s := range all {
		if s.ID != id {
			out = append(out, s)
		}
	}
	if err := a.store.setJSON(keySponsors, out); err != nil {
		return err
	}
	// Best-effort: the metadata is already gone; orphaned files are harmless.
	if root, err := sponsorsDir(); err == nil && id != "" {
		_ = os.RemoveAll(filepath.Join(root, id))
	}
	return nil
}

// mutateSponsor loads the stored sponsors, applies fn to the one matching id,
// and persists the set. fn returns an error to abort without saving.
func (a *App) mutateSponsor(id string, fn func(s *Sponsor) error) (Sponsor, error) {
	if a.store == nil {
		return Sponsor{}, fmt.Errorf("storage unavailable")
	}
	all := a.getSponsors()
	for i := range all {
		if all[i].ID != id {
			continue
		}
		if err := fn(&all[i]); err != nil {
			return Sponsor{}, err
		}
		if err := a.store.setJSON(keySponsors, all); err != nil {
			return Sponsor{}, err
		}
		s := all[i]
		a.fillSponsorURLs(&s)
		return s, nil
	}
	return Sponsor{}, fmt.Errorf("that sponsor no longer exists")
}

// ---------------------------------------------------------------------------
// Branding files
// ---------------------------------------------------------------------------

// AddSponsorBranding opens a native multi-file picker and copies the chosen
// files into the sponsor's branding folder, recording one file per pick. It
// returns the updated sponsor (unchanged when the picker is cancelled).
func (a *App) AddSponsorBranding(sponsorID string) (Sponsor, error) {
	if a.ctx == nil {
		return Sponsor{}, fmt.Errorf("no window context")
	}
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Add branding files for this sponsor",
	})
	if err != nil {
		return Sponsor{}, err
	}
	if len(paths) == 0 {
		// Cancelled; hand back the current state so the frontend can no-op.
		return a.mutateSponsor(sponsorID, func(*Sponsor) error { return nil })
	}

	dir, err := sponsorBrandingDir(sponsorID)
	if err != nil {
		return Sponsor{}, err
	}

	return a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		for _, src := range paths {
			name, size, err := copyIntoDir(src, dir)
			if err != nil {
				return fmt.Errorf("could not copy %s: %w", filepath.Base(src), err)
			}
			s.Branding = append(s.Branding, SponsorFile{
				ID:        fmt.Sprintf("file_%d", time.Now().UnixNano()),
				Name:      name,
				SizeBytes: size,
				AddedAt:   time.Now().UTC().Format(time.RFC3339),
			})
		}
		return nil
	})
}

// SetSponsorLogo picks which branding file serves as the sponsor's logo
// ("" clears the pick) and returns the updated sponsor.
func (a *App) SetSponsorLogo(sponsorID, fileID string) (Sponsor, error) {
	return a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		if fileID == "" {
			s.LogoFileID = ""
			return nil
		}
		for _, f := range s.Branding {
			if f.ID == fileID {
				s.LogoFileID = fileID
				return nil
			}
		}
		return fmt.Errorf("that branding file no longer exists")
	})
}

// DeleteSponsorBranding removes a branding file's metadata and its file on
// disk, and returns the updated sponsor. Deleting the file that served as
// the logo clears the logo pick with it.
func (a *App) DeleteSponsorBranding(sponsorID, fileID string) (Sponsor, error) {
	var name string
	s, err := a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		out := s.Branding[:0]
		for _, f := range s.Branding {
			if f.ID == fileID {
				name = f.Name
				continue
			}
			out = append(out, f)
		}
		s.Branding = out
		if s.LogoFileID == fileID {
			s.LogoFileID = ""
		}
		return nil
	})
	if err != nil {
		return s, err
	}
	if name != "" {
		if dir, derr := sponsorBrandingDir(sponsorID); derr == nil {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
	return s, nil
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

// SaveSponsorCampaign upserts a campaign (matched by ID) on a sponsor,
// assigning an ID and creation time on first save, and returns the updated
// sponsor. Assets are managed by their own methods and are preserved as
// stored — the supplied copies are ignored.
func (a *App) SaveSponsorCampaign(sponsorID string, c SponsorCampaign) (Sponsor, error) {
	if strings.TrimSpace(c.Name) == "" {
		return Sponsor{}, fmt.Errorf("a campaign name is required")
	}
	return a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		if c.ID == "" {
			c.ID = fmt.Sprintf("campaign_%d", time.Now().UnixNano())
		}
		if c.CreatedAt == "" {
			c.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		}
		for i, existing := range s.Campaigns {
			if existing.ID == c.ID {
				c.Assets = existing.Assets
				s.Campaigns[i] = c
				return nil
			}
		}
		c.Assets = []SponsorFile{}
		s.Campaigns = append([]SponsorCampaign{c}, s.Campaigns...)
		return nil
	})
}

// DeleteSponsorCampaign removes a campaign and its on-disk files, and returns
// the updated sponsor.
func (a *App) DeleteSponsorCampaign(sponsorID, campaignID string) (Sponsor, error) {
	s, err := a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		out := s.Campaigns[:0]
		for _, c := range s.Campaigns {
			if c.ID != campaignID {
				out = append(out, c)
			}
		}
		s.Campaigns = out
		return nil
	})
	if err != nil {
		return s, err
	}
	// Best-effort: the metadata is already gone; orphaned files are harmless.
	if root, rerr := sponsorsDir(); rerr == nil && campaignID != "" {
		_ = os.RemoveAll(filepath.Join(root, sponsorID, "campaigns", campaignID))
	}
	return s, nil
}

// AddCampaignAssets opens a native multi-file picker and copies the chosen
// files into the campaign's asset folder, recording one file per pick. It
// returns the updated sponsor (unchanged when the picker is cancelled).
func (a *App) AddCampaignAssets(sponsorID, campaignID string) (Sponsor, error) {
	if a.ctx == nil {
		return Sponsor{}, fmt.Errorf("no window context")
	}
	paths, err := wruntime.OpenMultipleFilesDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Add files to this campaign",
	})
	if err != nil {
		return Sponsor{}, err
	}
	if len(paths) == 0 {
		// Cancelled; hand back the current state so the frontend can no-op.
		return a.mutateSponsor(sponsorID, func(*Sponsor) error { return nil })
	}

	dir, err := campaignAssetsDir(sponsorID, campaignID)
	if err != nil {
		return Sponsor{}, err
	}

	return a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		for i := range s.Campaigns {
			if s.Campaigns[i].ID != campaignID {
				continue
			}
			for _, src := range paths {
				name, size, err := copyIntoDir(src, dir)
				if err != nil {
					return fmt.Errorf("could not copy %s: %w", filepath.Base(src), err)
				}
				s.Campaigns[i].Assets = append(s.Campaigns[i].Assets, SponsorFile{
					ID:        fmt.Sprintf("file_%d", time.Now().UnixNano()),
					Name:      name,
					SizeBytes: size,
					AddedAt:   time.Now().UTC().Format(time.RFC3339),
				})
			}
			return nil
		}
		return fmt.Errorf("that campaign no longer exists")
	})
}

// DeleteCampaignAsset removes a campaign asset's metadata and its file on
// disk, and returns the updated sponsor.
func (a *App) DeleteCampaignAsset(sponsorID, campaignID, fileID string) (Sponsor, error) {
	var name string
	s, err := a.mutateSponsor(sponsorID, func(s *Sponsor) error {
		for i := range s.Campaigns {
			if s.Campaigns[i].ID != campaignID {
				continue
			}
			out := s.Campaigns[i].Assets[:0]
			for _, f := range s.Campaigns[i].Assets {
				if f.ID == fileID {
					name = f.Name
					continue
				}
				out = append(out, f)
			}
			s.Campaigns[i].Assets = out
			return nil
		}
		return fmt.Errorf("that campaign no longer exists")
	})
	if err != nil {
		return s, err
	}
	if name != "" {
		if dir, derr := campaignAssetsDir(sponsorID, campaignID); derr == nil {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
	return s, nil
}

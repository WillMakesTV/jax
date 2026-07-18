package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSponsorRoundTrip(t *testing.T) {
	a := newTestApp(t)

	if _, err := a.SaveSponsor(Sponsor{Name: "  "}); err == nil {
		t.Fatal("want error for a blank name")
	}

	s, err := a.SaveSponsor(Sponsor{
		Name:        "Acme",
		Website:     "https://acme.example",
		Description: "# Tools",
	})
	if err != nil {
		t.Fatalf("save sponsor: %v", err)
	}
	if s.ID == "" || s.CreatedAt == "" {
		t.Fatalf("save should assign id and createdAt, got %+v", s)
	}
	if s.Branding == nil || s.Campaigns == nil {
		t.Fatal("branding and campaigns should marshal as arrays, not null")
	}

	// Update in place; branding/campaigns supplied by the caller are ignored.
	s.Description = "# Better tools"
	s.Branding = []SponsorFile{{ID: "bogus"}}
	updated, err := a.SaveSponsor(s)
	if err != nil {
		t.Fatalf("update sponsor: %v", err)
	}
	if updated.Description != "# Better tools" {
		t.Fatalf("description not updated: %q", updated.Description)
	}
	if len(updated.Branding) != 0 {
		t.Fatal("supplied branding should be ignored on save")
	}

	all := a.GetSponsors()
	if len(all) != 1 || all[0].ID != s.ID {
		t.Fatalf("want the one saved sponsor, got %+v", all)
	}

	if err := a.DeleteSponsor(s.ID); err != nil {
		t.Fatalf("delete sponsor: %v", err)
	}
	if got := a.GetSponsors(); len(got) != 0 {
		t.Fatalf("sponsor should be gone, got %+v", got)
	}
}

func TestSponsorCampaignRoundTrip(t *testing.T) {
	a := newTestApp(t)

	s, err := a.SaveSponsor(Sponsor{Name: "Acme"})
	if err != nil {
		t.Fatalf("save sponsor: %v", err)
	}

	if _, err := a.SaveSponsorCampaign(s.ID, SponsorCampaign{Name: " "}); err == nil {
		t.Fatal("want error for a blank campaign name")
	}
	if _, err := a.SaveSponsorCampaign("nope", SponsorCampaign{Name: "Q3"}); err == nil {
		t.Fatal("want error for an unknown sponsor")
	}

	s, err = a.SaveSponsorCampaign(s.ID, SponsorCampaign{
		Name:             "Q3 Launch",
		StartDate:        "2026-07-01",
		EndDate:          "2026-09-30",
		Messaging:        "Lead with the free tier.",
		PromotionDetails: "Two mid-rolls per stream.",
	})
	if err != nil {
		t.Fatalf("save campaign: %v", err)
	}
	if len(s.Campaigns) != 1 {
		t.Fatalf("want one campaign, got %+v", s.Campaigns)
	}
	c := s.Campaigns[0]
	if c.ID == "" || c.CreatedAt == "" {
		t.Fatalf("save should assign id and createdAt, got %+v", c)
	}
	if c.Assets == nil {
		t.Fatal("assets should marshal as an array, not null")
	}

	// Update in place; assets supplied by the caller are ignored.
	c.EndDate = "2026-10-15"
	c.Assets = []SponsorFile{{ID: "bogus"}}
	s, err = a.SaveSponsorCampaign(s.ID, c)
	if err != nil {
		t.Fatalf("update campaign: %v", err)
	}
	if len(s.Campaigns) != 1 || s.Campaigns[0].EndDate != "2026-10-15" {
		t.Fatalf("campaign not updated: %+v", s.Campaigns)
	}
	if len(s.Campaigns[0].Assets) != 0 {
		t.Fatal("supplied assets should be ignored on save")
	}

	// A campaign's on-disk folder is removed with it.
	dir, err := campaignAssetsDir(s.ID, c.ID)
	if err != nil {
		t.Fatalf("campaign dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "banner.png"), []byte("x"), 0o600); err != nil {
		t.Fatalf("seed asset file: %v", err)
	}
	s, err = a.DeleteSponsorCampaign(s.ID, c.ID)
	if err != nil {
		t.Fatalf("delete campaign: %v", err)
	}
	if len(s.Campaigns) != 0 {
		t.Fatalf("campaign should be gone, got %+v", s.Campaigns)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("campaign folder should be removed, stat err = %v", err)
	}
}

func TestSponsorLogo(t *testing.T) {
	a := newTestApp(t)

	s, err := a.SaveSponsor(Sponsor{Name: "Acme"})
	if err != nil {
		t.Fatalf("save sponsor: %v", err)
	}
	s, err = a.mutateSponsor(s.ID, func(s *Sponsor) error {
		s.Branding = append(s.Branding, SponsorFile{ID: "f1", Name: "logo.png"})
		return nil
	})
	if err != nil {
		t.Fatalf("record branding: %v", err)
	}

	if _, err := a.SetSponsorLogo(s.ID, "nope"); err == nil {
		t.Fatal("want error for an unknown branding file")
	}
	s, err = a.SetSponsorLogo(s.ID, "f1")
	if err != nil {
		t.Fatalf("set logo: %v", err)
	}
	if s.LogoFileID != "f1" || s.LogoURL == "" {
		t.Fatalf("logo not set: %+v", s)
	}

	// A plain save must not drop the pick.
	s.Description = "# Notes"
	s, err = a.SaveSponsor(s)
	if err != nil {
		t.Fatalf("resave sponsor: %v", err)
	}
	if s.LogoFileID != "f1" {
		t.Fatalf("save dropped the logo pick: %+v", s)
	}

	// Deleting the logo's file clears the pick with it.
	s, err = a.DeleteSponsorBranding(s.ID, "f1")
	if err != nil {
		t.Fatalf("delete branding: %v", err)
	}
	if s.LogoFileID != "" || s.LogoURL != "" {
		t.Fatalf("logo pick should be cleared, got %+v", s)
	}
}

func TestDeleteSponsorBranding(t *testing.T) {
	a := newTestApp(t)

	s, err := a.SaveSponsor(Sponsor{Name: "Acme"})
	if err != nil {
		t.Fatalf("save sponsor: %v", err)
	}

	// Seed a branding file directly (the picker needs a window context).
	dir, err := sponsorBrandingDir(s.ID)
	if err != nil {
		t.Fatalf("branding dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "logo.svg"), []byte("x"), 0o600); err != nil {
		t.Fatalf("seed branding file: %v", err)
	}
	s, err = a.mutateSponsor(s.ID, func(s *Sponsor) error {
		s.Branding = append(s.Branding, SponsorFile{ID: "f1", Name: "logo.svg"})
		return nil
	})
	if err != nil {
		t.Fatalf("record branding: %v", err)
	}
	if len(s.Branding) != 1 || s.Branding[0].MediaURL == "" {
		t.Fatalf("branding should carry a media URL, got %+v", s.Branding)
	}

	s, err = a.DeleteSponsorBranding(s.ID, "f1")
	if err != nil {
		t.Fatalf("delete branding: %v", err)
	}
	if len(s.Branding) != 0 {
		t.Fatalf("branding should be gone, got %+v", s.Branding)
	}
	if _, err := os.Stat(filepath.Join(dir, "logo.svg")); !os.IsNotExist(err) {
		t.Fatalf("branding file should be removed, stat err = %v", err)
	}
}

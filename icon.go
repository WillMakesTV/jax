package main

import (
	"bp-temp/internal/httpx"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// ---------------------------------------------------------------------------
// Application icon
//
// The app icon follows the profile's Gravatar: whenever the profile is loaded
// or saved, the Gravatar is downloaded and cached at ~/.jax/appicon.png. The
// build step embeds that saved image as the executable/window icon, so the
// next build (and therefore the next launch of that build) picks it up —
// Windows bakes the icon into the exe at build time, so it cannot change on
// a running binary.
// ---------------------------------------------------------------------------

// savedIconPath is where the fetched Gravatar is cached for the build step.
func savedIconPath() (string, error) {
	dir, err := dataDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "appicon.png"), nil
}

// refreshAppIcon downloads the profile email's Gravatar (512px, identicon
// fallback) and saves it as the cached app icon. Silent no-op without an
// email or network.
func (a *App) refreshAppIcon() {
	email := strings.ToLower(strings.TrimSpace(a.GetProfile().Email))
	if email == "" {
		return
	}
	sum := md5.Sum([]byte(email))
	url := fmt.Sprintf(
		"https://www.gravatar.com/avatar/%s?s=512&d=identicon",
		hex.EncodeToString(sum[:]),
	)
	resp, err := httpx.Client.Get(url)
	if err != nil {
		log.Printf("jax: fetch gravatar icon: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		log.Printf("jax: fetch gravatar icon: status %d", resp.StatusCode)
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return
	}
	path, err := savedIconPath()
	if err != nil {
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		log.Printf("jax: save app icon: %v", err)
	}
}

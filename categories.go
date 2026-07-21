package main

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// Broadcast categories
//
// A content series carries one category per broadcast platform (a Twitch
// game/category and a YouTube video category) so going live can push accurate
// stream information to each service. These lookups return the platforms'
// canonical categories — the IDs are what the update APIs accept.
// ---------------------------------------------------------------------------

// ServiceCategory is a platform's canonical category. ID is the platform's
// identifier (Twitch game ID / YouTube video category ID); Name is its
// display title.
type ServiceCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// SearchTwitchCategories searches Twitch's game/category catalogue for the
// picker in the series form. An empty query returns no results. Never nil on
// success.
func (a *App) SearchTwitchCategories(query string) ([]ServiceCategory, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []ServiceCategory{}, nil
	}
	conn, ok := a.freshConn("twitch")
	if !ok {
		return nil, fmt.Errorf("connect Twitch in Settings → Services first")
	}

	found, status, err := twitchClient(conn).SearchCategories(query)
	if err != nil {
		if status == http.StatusUnauthorized {
			return nil, errors.New(errReauth)
		}
		return nil, fmt.Errorf("Twitch category search failed: %v", err)
	}

	out := make([]ServiceCategory, 0, len(found))
	for _, c := range found {
		out = append(out, ServiceCategory{ID: c.ID, Name: c.Name})
	}
	return out, nil
}

// GetYouTubeCategories returns the video categories YouTube allows a video or
// broadcast to be assigned to, sorted by name. Never nil on success.
func (a *App) GetYouTubeCategories() ([]ServiceCategory, error) {
	conn, ok := a.freshConn("youtube")
	if !ok {
		return nil, fmt.Errorf("connect YouTube in Settings → Services first")
	}

	found, status, err := youtubeClient(conn).Categories()
	if err != nil {
		if status == http.StatusUnauthorized {
			return nil, errors.New(errReauth)
		}
		return nil, fmt.Errorf("YouTube categories request failed: %v", err)
	}

	out := make([]ServiceCategory, 0, len(found))
	for _, it := range found {
		if !it.Assignable {
			continue
		}
		out = append(out, ServiceCategory{ID: it.ID, Name: it.Title})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

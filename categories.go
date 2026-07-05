package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
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

const twitchSearchCategoriesURL = "https://api.twitch.tv/helix/search/categories"

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

	var r struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	endpoint := twitchSearchCategoriesURL + "?first=25&query=" + url.QueryEscape(query)
	status, err := getJSON(endpoint, twitchHeaders(conn), &r)
	if err != nil {
		if status == http.StatusUnauthorized {
			return nil, errors.New(errReauth)
		}
		return nil, fmt.Errorf("Twitch category search failed: %v", err)
	}

	out := make([]ServiceCategory, 0, len(r.Data))
	for _, d := range r.Data {
		out = append(out, ServiceCategory{ID: d.ID, Name: d.Name})
	}
	return out, nil
}

// YouTube's video categories are a fixed per-region list; the US list is used
// as the canonical set (IDs are identical across regions for the assignable
// categories).
const youtubeCategoriesURL = "https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US"

// GetYouTubeCategories returns the video categories YouTube allows a video or
// broadcast to be assigned to, sorted by name. Never nil on success.
func (a *App) GetYouTubeCategories() ([]ServiceCategory, error) {
	conn, ok := a.freshConn("youtube")
	if !ok {
		return nil, fmt.Errorf("connect YouTube in Settings → Services first")
	}

	var r struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title      string `json:"title"`
				Assignable bool   `json:"assignable"`
			} `json:"snippet"`
		} `json:"items"`
	}
	status, err := getJSON(youtubeCategoriesURL, map[string]string{
		"Authorization": "Bearer " + conn.token,
	}, &r)
	if err != nil {
		if status == http.StatusUnauthorized {
			return nil, errors.New(errReauth)
		}
		return nil, fmt.Errorf("YouTube categories request failed: %v", err)
	}

	out := make([]ServiceCategory, 0, len(r.Items))
	for _, it := range r.Items {
		if !it.Snippet.Assignable {
			continue
		}
		out = append(out, ServiceCategory{ID: it.ID, Name: it.Snippet.Title})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// MCP tool catalog
//
// Each tool wraps one of the workflows the UI exposes, reusing the same bound
// App methods so behaviour (caching, quota throttling, persistence rules)
// stays identical whether the user or Claude drives it.
//
// Deliberately not exposed:
//   - outward-facing pushes (go-live, ApplyPlannedStream, SendBroadcastChat)
//     — those publish to Twitch/YouTube and stay behind an explicit click;
//   - OAuth/device flows, credentials, and service config;
//   - OBS control and routine execution (the obs-websocket session lives in
//     the frontend, not the Go backend);
//   - native dialogs (file pickers) and destructive deletes of media, series,
//     or projects (delete_debug_report is the intentional exception —
//     deleting a resolved report is the point of the AI debugging workflow);
//   - AI passthroughs (plan suggestions, description edits) — the MCP client
//     is already a model; it gets the raw data instead.
// ---------------------------------------------------------------------------

type mcpTool struct {
	name        string
	description string
	inputSchema map[string]any
	// handler returns either a string (used verbatim) or any JSON-encodable
	// value. A returned error becomes an isError tool result.
	handler func(a *App, args json.RawMessage) (any, error)
}

// mcpToolDescriptors returns the tools/list payload.
func mcpToolDescriptors() []map[string]any {
	tools := mcpToolCatalog()
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		schema := t.inputSchema
		if schema == nil {
			schema = objSchema(map[string]any{})
		}
		out = append(out, map[string]any{
			"name":        t.name,
			"description": t.description,
			"inputSchema": schema,
		})
	}
	return out
}

// mcpToolByName finds a tool in the catalog.
func mcpToolByName(name string) (mcpTool, bool) {
	for _, t := range mcpToolCatalog() {
		if t.name == name {
			return t, true
		}
	}
	return mcpTool{}, false
}

// decodeArgs unmarshals tool arguments, tolerating an absent object.
func decodeArgs(raw json.RawMessage, out any) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("invalid arguments: %v", err)
	}
	return nil
}

func objSchema(props map[string]any, required ...string) map[string]any {
	s := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

func prop(typ, desc string) map[string]any {
	return map[string]any{"type": typ, "description": desc}
}

func strArrayProp(desc string) map[string]any {
	return map[string]any{
		"type":        "array",
		"items":       map[string]any{"type": "string"},
		"description": desc,
	}
}

// streamKeysProp documents the broadcast-key format shared by the past-stream
// assignment tools.
func streamKeysProp() map[string]any {
	return strArrayProp(`Broadcast keys identifying the stream, "<platform>|<url>" as returned by list_past_streams (each broadcast's platform and url joined with "|"). For a stream that is currently live use "live|<startedAt>".`)
}

// mcpToolCatalog lists every exposed tool, grouped roughly by domain. Order
// is what tools/list reports.
func mcpToolCatalog() []mcpTool {
	return []mcpTool{
		// --- App / status ------------------------------------------------
		{
			name:        "get_app_status",
			description: "Overview of the Jax app: creator profile, connected services (Twitch, YouTube, Kick, Facebook, Instagram, X, TikTok, Anthropic, OpenAI), and the active stream session if one is open.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return map[string]any{
					"profile":  a.GetProfile(),
					"services": a.GetServiceStatuses(),
					"session":  a.GetActiveStreamSession(),
				}, nil
			},
		},
		{
			name:        "get_live_streams",
			description: "Current live-broadcast state and metrics for each connected channel (viewer counts, titles, categories, uptime). Results are throttled server-side to respect platform API quotas.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return a.GetLiveStreams(), nil
			},
		},

		// --- Application skills -------------------------------------------
		{
			name:        "list_skills",
			description: "The app's Application Skills: instruction documents on how to use each feature area (planning, series, going live, past streams, downloads, videos, projects, OBS). Returns ids, titles, and descriptions; read one with get_skill before working in its area.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				skills, err := a.ListAppSkills()
				if err != nil {
					return nil, err
				}
				out := make([]map[string]any, 0, len(skills))
				for _, s := range skills {
					out = append(out, map[string]any{
						"id":          s.ID,
						"title":       s.Title,
						"description": s.Description,
					})
				}
				return out, nil
			},
		},
		{
			name:        "get_skill",
			description: "One Application Skill's full markdown instructions, by id from list_skills. Follow it when working in that feature area — the user may have customized it with their own conventions.",
			inputSchema: objSchema(map[string]any{
				"id": prop("string", "The skill id from list_skills."),
			}, "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ID string `json:"id"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				skill, err := a.getAppSkill(in.ID)
				if err != nil {
					return nil, err
				}
				return skill.Content, nil
			},
		},

		// --- Brand ---------------------------------------------------------
		{
			name:        "list_brand_assets",
			description: "The brand's uploaded asset files (logos, banners, palettes, fonts, character art) with names and descriptions. The files themselves stay on this computer — features like thumbnail generation use them as references; manage them on the Profile page. See the brand-assets skill for conventions.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return a.GetBrandAssets(), nil
			},
		},
		{
			name:        "list_brand_links",
			description: "The brand's outward links (social profiles, website, store) with labels and URLs, managed on the Profile page's Links tab. Whenever you write audience-facing copy that mentions the brand's socials or site — descriptions, outros, CTAs — use these URLs verbatim; never invent links.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return a.GetBrandLinks(), nil
			},
		},

		// --- Past streams ------------------------------------------------
		{
			name:        "list_past_streams",
			description: "Finished streams aggregated across platforms (one entry can bundle the Twitch, YouTube, Kick, and Facebook broadcasts of the same session). Includes titles, timing, view counts, series/episode assignments, and each broadcast's platform+url (the parts of its broadcast key).",
			inputSchema: objSchema(map[string]any{
				"refresh": prop("boolean", "Bypass the cache and refetch from the platforms (costs API quota). Default false."),
			}),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Refresh bool `json:"refresh"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.GetPastStreams(in.Refresh), nil
			},
		},
		{
			name:        "get_stream_transcript",
			description: "The spoken-word transcript captured for a stream (live captions or a transcription of the downloaded video). Timestamps are unix milliseconds relative to real time.",
			inputSchema: objSchema(map[string]any{
				"startedAt": prop("string", "The stream's start time, RFC3339, as returned by list_past_streams."),
			}, "startedAt"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					StartedAt string `json:"startedAt"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				lines := a.GetTranscriptForStream(in.StartedAt)
				if len(lines) == 0 {
					return nil, fmt.Errorf("no transcript is stored for the stream that started at %s", in.StartedAt)
				}
				return lines, nil
			},
		},
		{
			name:        "get_stream_chat",
			description: "The chat log captured during a stream, across platforms.",
			inputSchema: objSchema(map[string]any{
				"startedAt":    prop("string", "The stream's start time, RFC3339."),
				"durationSecs": prop("integer", "The stream's length in seconds (bounds the chat window)."),
			}, "startedAt", "durationSecs"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					StartedAt    string `json:"startedAt"`
					DurationSecs int    `json:"durationSecs"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.GetChatForStream(in.StartedAt, in.DurationSecs), nil
			},
		},
		{
			name:        "get_stream_outline",
			description: "The stored AI-generated outline (timestamped chapters + summary) for a past stream, if one has been generated.",
			inputSchema: objSchema(map[string]any{
				"startedAt": prop("string", "The stream's start time, RFC3339."),
			}, "startedAt"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					StartedAt string `json:"startedAt"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.GetStreamOutline(in.StartedAt)
			},
		},
		{
			name:        "generate_stream_outline",
			description: "Generate (or regenerate) the AI outline for a past stream from its transcript and chat. Long-running — may take a few minutes. Requires an AI connection (Anthropic or OpenAI) in Jax.",
			inputSchema: objSchema(map[string]any{
				"startedAt":    prop("string", "The stream's start time, RFC3339."),
				"durationSecs": prop("integer", "The stream's length in seconds."),
			}, "startedAt", "durationSecs"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					StartedAt    string `json:"startedAt"`
					DurationSecs int    `json:"durationSecs"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.GenerateStreamOutline(in.StartedAt, in.DurationSecs)
			},
		},
		{
			name:        "set_stream_series",
			description: "Assign a past (or live) stream to a content series, or clear the assignment.",
			inputSchema: objSchema(map[string]any{
				"keys":     streamKeysProp(),
				"seriesId": prop("string", "The content series id from list_content_series; empty string clears the assignment."),
			}, "keys"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Keys     []string `json:"keys"`
					SeriesID string   `json:"seriesId"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				if err := a.SetPastStreamSeries(in.Keys, in.SeriesID); err != nil {
					return nil, err
				}
				return "series assignment saved", nil
			},
		},
		{
			name:        "set_stream_episode",
			description: "Set a stream's episode number and optional episode description, or clear it with number 0.",
			inputSchema: objSchema(map[string]any{
				"keys":        streamKeysProp(),
				"number":      prop("integer", "Episode number; 0 clears the assignment."),
				"description": prop("string", "Optional short episode description."),
			}, "keys", "number"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Keys        []string `json:"keys"`
					Number      int      `json:"number"`
					Description string   `json:"description"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				if err := a.SetStreamEpisode(in.Keys, in.Number, in.Description); err != nil {
					return nil, err
				}
				return "episode saved", nil
			},
		},

		// --- Planning ------------------------------------------------------
		{
			name:        "list_planned_streams",
			description: "Upcoming stream plans (title, markdown description, target channels, series/episode, tags).",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return a.GetPlannedStreams(), nil
			},
		},
		{
			name:        "save_planned_stream",
			description: `Create or update a stream plan. Omit "id" to create; include it to update. Going live with a plan stays in the app — this only edits the plan.`,
			inputSchema: objSchema(map[string]any{
				"id":            prop("string", "Plan id when updating an existing plan; omit to create."),
				"title":         prop("string", "Stream title."),
				"description":   prop("string", "Markdown broadcast description."),
				"channels":      strArrayProp(`Target channels, e.g. ["twitch", "youtube", "kick", "facebook", "instagram", "x", "tiktok"]. X, Facebook, and TikTok targets post a one-time go-live announcement.`),
				"seriesId":      prop("string", "Optional content series id."),
				"episodeNumber": prop("integer", "Optional episode number (episodic series)."),
				"tags":          strArrayProp("Optional stream tags."),
			}, "title"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var plan PlannedStream
				if err := decodeArgs(args, &plan); err != nil {
					return nil, err
				}
				return a.SavePlannedStream(plan)
			},
		},
		{
			name:        "delete_planned_stream",
			description: "Delete a stream plan by id.",
			inputSchema: objSchema(map[string]any{
				"id": prop("string", "The plan id from list_planned_streams."),
			}, "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ID string `json:"id"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				if err := a.DeletePlannedStream(in.ID); err != nil {
					return nil, err
				}
				return "plan deleted", nil
			},
		},
		{
			name:        "generate_plan_thumbnail",
			description: "Generate (or revise) a stream plan's thumbnail image from its title and description, following the stream-thumbnails skill and the brand's assets. With feedback, the plan's current thumbnail is revised; without, a fresh image is generated. Long-running (up to a couple of minutes); requires the OpenAI connection in Jax. The image is saved onto the plan.",
			inputSchema: objSchema(map[string]any{
				"planId":   prop("string", "The plan id from list_planned_streams."),
				"feedback": prop("string", "Requested changes to the current thumbnail; omit for a fresh generation."),
			}, "planId"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					PlanID   string `json:"planId"`
					Feedback string `json:"feedback"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				plan := a.findPlannedStream(in.PlanID)
				if plan == nil {
					return nil, fmt.Errorf("no plan with id %q", in.PlanID)
				}
				current := ""
				if strings.TrimSpace(in.Feedback) != "" {
					current = plan.ThumbnailFile
				}
				t, err := a.GeneratePlanThumbnail(plan.Title, plan.Description, in.Feedback, current)
				if err != nil {
					return nil, err
				}
				plan.ThumbnailFile = t.File
				updated, err := a.SavePlannedStream(*plan)
				if err != nil {
					return nil, err
				}
				return map[string]any{
					"thumbnailFile": updated.ThumbnailFile,
					"thumbnailUrl":  updated.ThumbnailURL,
				}, nil
			},
		},
		{
			name:        "set_plan_thumbnail",
			description: `Set a stream plan's thumbnail from an image file on this computer (png, jpg, jpeg, webp, or gif) — for hand-made thumbnails instead of generated ones. Pass an empty "path" to clear the plan's thumbnail.`,
			inputSchema: objSchema(map[string]any{
				"planId": prop("string", "The plan id from list_planned_streams."),
				"path":   prop("string", "Absolute path of the image file, or empty to clear the thumbnail."),
			}, "planId"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					PlanID string `json:"planId"`
					Path   string `json:"path"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				plan := a.findPlannedStream(in.PlanID)
				if plan == nil {
					return nil, fmt.Errorf("no plan with id %q", in.PlanID)
				}
				file := ""
				if strings.TrimSpace(in.Path) != "" {
					t, err := a.importPlanThumbnail(strings.TrimSpace(in.Path))
					if err != nil {
						return nil, err
					}
					file = t.File
				}
				plan.ThumbnailFile = file
				updated, err := a.SavePlannedStream(*plan)
				if err != nil {
					return nil, err
				}
				return map[string]any{
					"thumbnailFile": updated.ThumbnailFile,
					"thumbnailUrl":  updated.ThumbnailURL,
				}, nil
			},
		},
		{
			name:        "reset_planned_stream",
			description: "Forget that a plan has been broadcast: deletes its stream sessions and clears the series/episode assignments its go-lives registered, so the plan can be broadcast fresh later. The plan itself is kept. Use when a stream was a false start; conclude (in the app) is the normal path after a real broadcast.",
			inputSchema: objSchema(map[string]any{
				"id": prop("string", "The plan id from list_planned_streams."),
			}, "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ID string `json:"id"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				if err := a.ResetPlannedStream(in.ID); err != nil {
					return nil, err
				}
				return "plan reset — it reads as not yet broadcast", nil
			},
		},

		// --- Series ----------------------------------------------------
		{
			name:        "list_content_series",
			description: "Content series (reusable show metadata: categories, tags, notes, labels) plus the series types that classify them.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return map[string]any{
					"series": a.GetContentSeries(),
					"types":  a.GetSeriesTypes(),
				}, nil
			},
		},
		{
			name:        "save_content_series",
			description: `Create or update a content series. Omit "id" to create. Category objects need {"id", "name"} as returned by the app; leave categories untouched by passing the existing values when updating.`,
			inputSchema: objSchema(map[string]any{
				"id":                 prop("string", "Series id when updating; omit to create."),
				"title":              prop("string", "Series title."),
				"description":        prop("string", "Series description (markdown)."),
				"typeId":             prop("string", "Series type id from list_content_series."),
				"tags":               strArrayProp("Stream tags applied by this series."),
				"notes":              prop("string", "Internal notes."),
				"twitchCategory":     prop("object", `Twitch category {"id","name"}.`),
				"youtubeCategory":    prop("object", `YouTube category {"id","name"}.`),
				"twitchLabels":       strArrayProp("Twitch content-classification labels."),
				"youtubeMadeForKids": prop("boolean", "YouTube made-for-kids flag."),
			}, "title"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var series ContentSeries
				if err := decodeArgs(args, &series); err != nil {
					return nil, err
				}
				return a.SaveContentSeries(series)
			},
		},
		{
			name:        "get_episode_numbers",
			description: "Episode numbers already used by a series and the next free number — use before assigning episodes or planning an episodic stream.",
			inputSchema: objSchema(map[string]any{
				"seriesId": prop("string", "The content series id."),
			}, "seriesId"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					SeriesID string `json:"seriesId"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return map[string]any{
					"used": a.UsedEpisodeNumbers(in.SeriesID),
					"next": a.NextEpisodeNumber(in.SeriesID),
				}, nil
			},
		},

		// --- Videos ------------------------------------------------------
		{
			name:        "list_videos",
			description: "The channels' video catalogue (uploads, VODs, highlights, clips) excluding past-stream VODs, newest first.",
			inputSchema: objSchema(map[string]any{
				"refresh": prop("boolean", "Bypass the cache and refetch (costs API quota). Default false."),
			}),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Refresh bool `json:"refresh"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.GetVideos(in.Refresh), nil
			},
		},
		{
			name:        "get_video_details",
			description: "Analytics and top comments for one video.",
			inputSchema: objSchema(map[string]any{
				"platform": prop("string", `"twitch", "youtube", "kick", or "facebook".`),
				"id":       prop("string", "The video id from list_videos or list_past_streams."),
				"refresh":  prop("boolean", "Bypass the cache. Default false."),
			}, "platform", "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Platform string `json:"platform"`
					ID       string `json:"id"`
					Refresh  bool   `json:"refresh"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.GetVideoDetails(in.Platform, in.ID, in.Refresh)
			},
		},

		// --- Projects ------------------------------------------------------
		{
			name:        "list_projects",
			description: "Project summaries (bodies of work: launches, builds, campaigns) — ids, titles, descriptions, and asset/doc counts. Use get_project for full docs.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				type summary struct {
					ID          string `json:"id"`
					Title       string `json:"title"`
					Description string `json:"description"`
					CreatedAt   string `json:"createdAt"`
					AssetCount  int    `json:"assetCount"`
					DocCount    int    `json:"docCount"`
				}
				projects := a.GetProjects()
				out := make([]summary, 0, len(projects))
				for _, p := range projects {
					out = append(out, summary{
						ID: p.ID, Title: p.Title, Description: p.Description,
						CreatedAt: p.CreatedAt, AssetCount: len(p.Assets), DocCount: len(p.Docs),
					})
				}
				return out, nil
			},
		},
		{
			name:        "get_project",
			description: "One project in full: title, markdown description, asset list, and the complete documentation tree with content.",
			inputSchema: objSchema(map[string]any{
				"id": prop("string", "The project id from list_projects."),
			}, "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ID string `json:"id"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				for _, p := range a.GetProjects() {
					if p.ID == in.ID {
						return p, nil
					}
				}
				return nil, fmt.Errorf("no project with id %q", in.ID)
			},
		},
		{
			name:        "save_project",
			description: `Create or update a project's title and markdown description. Omit "id" to create. Assets and docs are untouched (docs are edited with save_project_doc).`,
			inputSchema: objSchema(map[string]any{
				"id":          prop("string", "Project id when updating; omit to create."),
				"title":       prop("string", "Project title."),
				"description": prop("string", "Markdown description."),
			}, "title"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var p Project
				if err := decodeArgs(args, &p); err != nil {
					return nil, err
				}
				return a.SaveProject(p)
			},
		},
		{
			name:        "save_project_doc",
			description: `Create or update a markdown doc in a project's documentation tree. Omit the doc "id" to create. "parentId" nests the doc under another doc ("" = top level).`,
			inputSchema: objSchema(map[string]any{
				"projectId": prop("string", "The project id."),
				"id":        prop("string", "Doc id when updating; omit to create."),
				"parentId":  prop("string", "Parent doc id, or empty for top level."),
				"title":     prop("string", "Doc title."),
				"content":   prop("string", "Markdown content."),
			}, "projectId", "title"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ProjectID string `json:"projectId"`
					ProjectDoc
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.SaveProjectDoc(in.ProjectID, in.ProjectDoc)
			},
		},

		// --- Downloads & transcription ------------------------------------
		{
			name:        "list_downloads",
			description: "Downloaded stream videos stored on this computer (title, platform, timing, file, subfolder).",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return a.GetDownloads(), nil
			},
		},
		{
			name:        "download_stream",
			description: "Download a past stream's VODs to this computer — the same action as the stream page's “Download videos” button. Resolves the best video per broadcast segment (preferring the configured source platform), then downloads in the background into the app's download folder. Only one download can run at a time.",
			inputSchema: objSchema(map[string]any{
				"startedAt": prop("string", "The stream's start time, RFC3339, exactly as returned by list_past_streams."),
				"source":    prop("string", `Preferred platform for the video: "auto" (default, honours the app setting), "twitch", "youtube", "kick", or "facebook".`),
				"force":     prop("boolean", "Download again even if a local copy already exists. Default false."),
			}, "startedAt"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					StartedAt string `json:"startedAt"`
					Source    string `json:"source"`
					Force     bool   `json:"force"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.downloadPastStream(in.StartedAt, in.Source, in.Force)
			},
		},
		{
			name:        "transcribe_download",
			description: "Queue a downloaded stream video for local Whisper transcription, replacing any live-captured transcript for that stream. Returns immediately; the job runs in the background (progress is visible in the app).",
			inputSchema: objSchema(map[string]any{
				"subfolder": prop("string", "The download's subfolder from list_downloads."),
			}, "subfolder"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Subfolder string `json:"subfolder"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				if err := a.TranscribeDownload(in.Subfolder); err != nil {
					return nil, err
				}
				return "transcription queued", nil
			},
		},

		// --- Chat & routines -------------------------------------------
		{
			name:        "get_chat_history",
			description: "Recent chat messages across streams, newest last.",
			inputSchema: objSchema(map[string]any{
				"limit": prop("integer", "Maximum messages to return (default 200)."),
			}),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Limit int `json:"limit"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				if in.Limit <= 0 {
					in.Limit = 200
				}
				return a.GetChatHistory(in.Limit), nil
			},
		},
		{
			name:        "list_routines",
			description: "Stream routines (Start/End Stream and custom OBS action sequences) with their steps. Read-only — routines run from the app, which owns the OBS connection.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return a.GetRoutines(), nil
			},
		},

		// --- AI debug reports -----------------------------------------------
		// See skills/ai-debugging.md (the ai-debugging skill). Reports are
		// filed from the app's debug button; a client works each one and
		// deletes it once resolved.
		{
			name:        "list_debug_reports",
			description: "All open developer debug reports (bug reports filed from the app), newest first: id, title, description, route (the app view id), global flag, a checkedOut flag, and timestamps. Any result is work to pick up — see the ai-debugging skill. When several agents share the queue, skip reports whose checkedOut is true (another agent is on them) and claim one with check_out_debug_report before starting.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				return a.ListDebugReports(), nil
			},
		},
		{
			name:        "check_out_debug_report",
			description: "Claim a debug report before working it, so multiple agents can share the same queue without duplicating effort. Call this the moment you pick a report; it fails if another agent already checked it out. On success the report's checkedOut becomes true for everyone else. Resolve it with delete_debug_report once the fix is verified.",
			inputSchema: objSchema(map[string]any{
				"id": prop("integer", "The report id to check out."),
			}, "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ID int64 `json:"id"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.CheckOutDebugReport(in.ID)
			},
		},
		{
			name:        "count_debug_reports",
			description: "How many developer debug reports are open. Zero means nothing is known to be broken.",
			handler: func(a *App, _ json.RawMessage) (any, error) {
				n, err := a.CountDebugReports()
				if err != nil {
					return nil, err
				}
				return map[string]any{"count": n}, nil
			},
		},
		{
			name:        "search_debug_reports",
			description: "Debug reports whose title or description contains the query (case-insensitive), newest first.",
			inputSchema: objSchema(map[string]any{
				"query": prop("string", "Words to look for in report titles and descriptions."),
			}, "query"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					Query string `json:"query"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.SearchDebugReports(in.Query)
			},
		},
		{
			name:        "get_debug_report",
			description: "One debug report by id, as returned by list_debug_reports.",
			inputSchema: objSchema(map[string]any{
				"id": prop("integer", "The report id."),
			}, "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ID int64 `json:"id"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				return a.GetDebugReport(in.ID)
			},
		},
		{
			name:        "save_debug_report",
			description: `Create or update a debug report. Omit "id" to file a new report; include it to update an existing one (e.g. to append findings before pausing an investigation). Description is required.`,
			inputSchema: objSchema(map[string]any{
				"id":          prop("integer", "Report id when updating; omit to create."),
				"title":       prop("string", "Short summary line."),
				"description": prop("string", "Long-form description of the bug: symptoms, expectations, reproduction notes."),
				"route":       prop("string", "The app view id the bug appears on (e.g. \"dashboard\", \"planning\"). May be blank for global reports."),
				"global":      prop("boolean", "True when the problem is app-wide rather than tied to one view."),
			}, "description"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var r DebugReport
				if err := decodeArgs(args, &r); err != nil {
					return nil, err
				}
				return a.SaveDebugReport(r)
			},
		},
		{
			name:        "delete_debug_report",
			description: "Remove a debug report — the resolve step of the AI debugging workflow. Only delete a report after its fix is verified; this is deliberately the one destructive delete exposed over MCP. The reporter is left a read-once notice in the app that the bug was fixed, linking to the report's page.",
			inputSchema: objSchema(map[string]any{
				"id": prop("integer", "The report id to delete."),
			}, "id"),
			handler: func(a *App, args json.RawMessage) (any, error) {
				var in struct {
					ID int64 `json:"id"`
				}
				if err := decodeArgs(args, &in); err != nil {
					return nil, err
				}
				if err := a.ResolveDebugReport(in.ID); err != nil {
					return nil, err
				}
				return fmt.Sprintf("debug report %d deleted; the reporter will see a fixed notice", in.ID), nil
			},
		},
	}
}

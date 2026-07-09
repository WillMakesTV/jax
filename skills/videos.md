The Videos section covers two things: the channels' published video catalogue (uploads, VODs, highlights, clips) and video plans — projects that turn downloaded stream footage into new edited videos.

## The video catalogue

- `list_videos` returns every video from the connected channels, newest first, excluding past-stream VODs (those live in the streams archive). Results come from a 1-hour cache; pass `refresh: true` only when the newest upload is missing.
- `get_video_details` returns one video's analytics and top comments — pass the `platform` and `id` from the listing. Useful for performance reviews ("how did last week's upload do?") and mining comments for content ideas.

## Video plans

A video plan is the non-live counterpart of a stream plan: a title, format (short/long form), markdown description, tags, a thumbnail (generated from the plan like stream-plan thumbnails, or uploaded), and the past streams whose footage will be used as source material.

- Plans are created in the app from the Videos page ("Plan a video") and shown at the top of the list. The form's AI description helpers always receive the brand's links (Profile → Links; `list_brand_links` over MCP) — video descriptions link to the brand's socials/site using those URLs verbatim, never invented ones. Follow the same rule when drafting video-plan descriptions over MCP.
- A plan's details page has a Dashboard tab (format, description, tags, source-stream thumbnails) and a Content tab showing which source footage is downloaded and on disk.
- Source footage comes from stream downloads — see the "Downloads and transcription" skill. Downloading the source streams (and transcribing them) before editing gives the editor both the video and its transcript to work with.

## The video editor

The plan's editor produces the actual video: it runs a headless Claude Code session in a per-plan workspace pre-seeded with the source videos, cached transcripts, each source stream's overview and timestamped outline (edit/source-notes.md), and the plan's metadata, using a vendored video-editing skill (ffmpeg-driven). Sessions are briefed with "session directions" the user composes in the app — drafted and revised with AI via the "Video edit session directions" skill. The editor is launched and supervised from the app's Video Plan Editor page — not over MCP.

Over MCP your leverage is upstream: pick promising source streams (outlines and transcripts from the "Past streams" tools), draft the plan's description with concrete timestamps and beats, and make sure the sources are downloaded and transcribed before the user opens the editor.

Going live is driven from a plan's **Broadcast** page in the app. It is deliberately kept behind explicit clicks — none of the outward-facing pushes are available over MCP — so your role over MCP is preparation, monitoring, and follow-up.

## The broadcast-day flow

1. **Prepare** — make sure the plan is complete (`list_planned_streams`); title, description, channels, series/episode, and tags should all be set. See the "Planning streams" skill.
2. **Go Live** (app button) — pushes the plan's stream info (title, category, tags — and on YouTube the plan's thumbnail onto the broadcast video; Twitch has no thumbnail API) to each target channel and runs the Start Stream routine (OBS scene changes, source toggles, then starts the OBS broadcast). Plans targeting X, Facebook, or TikTok also post ONE go-live announcement (title + watch links; TikTok posts a short video rendered from the plan thumbnail) once the stream session is on the air — announcements never post during off-air "Update Stream Info" rehearsals and never repeat for the same plan.
3. **While live** — the Broadcast section shows the OBS program preview, aggregated chat, live platform events, and the live transcript. The plan stays on the Broadcast dashboard while on air.
4. **Update Stream Info** (app button) — re-pushes title/category/tags (and the YouTube thumbnail) mid-stream without touching the broadcast, e.g. after retitling or swapping the thumbnail.
5. **Conclude episode** (app button) — after the stream ends, attaches the plan to the finished stream (carrying series/episode and description over) and removes the plan from the upcoming list.
6. **Reset broadcast** (plan form button, or `reset_planned_stream` over MCP) — the false-start escape hatch: forgets the plan was broadcast (sessions and go-live assignments cleared) while keeping the plan for a future stream. Use it when a stream aborted early and the episode will be re-broadcast.

## What you can do over MCP while live

- `get_app_status` — reports the active stream session.
- `get_live_streams` — per-channel live state: viewers, titles, categories, uptime (quota-throttled).
- `get_chat_history` — recent chat across platforms, useful for surfacing questions or summarizing sentiment.
- `set_stream_series` / `set_stream_episode` with the key `live|<startedAt>` — series/episode can be assigned while still on air.

## Routines

Start/End Stream are built-in two-phase routines (steps before and after the broadcast toggle); custom routines can also be defined. `list_routines` shows every routine and its steps, but execution happens only in the app — the OBS connection lives in the frontend. If a routine needs to run, direct the user to the OBS Studio → Routines tab or the go-live buttons.

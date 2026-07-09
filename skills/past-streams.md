Every finished broadcast is archived as a past stream: one entry can bundle the Twitch, YouTube, Kick, and Facebook broadcasts of the same session, with timing, view counts, chat, transcript, and an optional AI outline. This archive is the raw material for episode recaps, clip hunting, and planning the next show.

## Finding streams

- `list_past_streams` is the entry point: titles, start times, durations, views, series/episode assignments, and each broadcast's platform+url (the parts of its broadcast key). Pass `refresh: true` only when the latest stream is missing — it costs API quota.
- Identify a stream by its `startedAt` (RFC3339) in the transcript/chat/outline tools, and by broadcast key (`<platform>|<url>`) in the assignment tools.

## What's stored per stream

- `get_stream_transcript` — the spoken-word transcript, either captured live or produced later from the downloaded video (see the "Downloads and transcription" skill). Timestamps are unix milliseconds.
- `get_stream_chat` — the cross-platform chat log; requires `startedAt` and `durationSecs` from the stream listing.
- `get_stream_outline` — the stored AI outline: timestamped chapters plus a summary, if one has been generated.
- `generate_stream_outline` — builds (or rebuilds) the outline from transcript + chat. Long-running and requires an AI connection (Anthropic or OpenAI); check `get_stream_outline` first so you don't regenerate one that exists.

## Common workflows

- **Episode recap**: outline (generate if missing) + chat highlights → a summary or social post draft.
- **Clip hunting**: scan the transcript for the moment, then use the outline chapters to bound the timestamp range.
- **Archive hygiene**: unassigned streams from `list_past_streams` → `set_stream_series` / `set_stream_episode` (see the "Content series" skill).

In the app, each stream has a details page (Overview, downloaded Video, Chat, Transcript tabs) with a "Download videos" button; downloads and re-transcription have their own skill.

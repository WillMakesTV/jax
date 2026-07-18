Content series are reusable show definitions: the metadata a recurring show carries from episode to episode — title, description, per-platform categories, tags, and labels. Assigning streams to a series is what turns a pile of VODs into an organized show archive with episode numbers.

## Managing series

- `list_content_series` returns every series plus the series types that classify them (e.g. episodic show vs one-off format).
- `save_content_series` creates or updates a series. Each connected platform needs a category from that platform's own catalogue (Twitch and Kick categories are searched; YouTube uses its fixed list), so when creating a series over MCP, copy categories from an existing similar series unless the user specifies them.
- In the app, series are edited under **Broadcasting → Content Series**; the edit form also maps episode info to OBS text sources.

## Episode numbering

- `get_episode_numbers` returns the numbers a series has already used and the next free number. Always call it before assigning a new episode.
- `set_stream_episode` sets a stream's episode number and an optional episode description; passing 0 clears it.

## Assigning streams to series

- `set_stream_series` assigns one or more streams (by broadcast key) to a series, or clears the assignment with an empty `seriesId`.
- Broadcast keys come from `list_past_streams` (`<platform>|<url>`); use `live|<startedAt>` for the stream currently on air.
- A typical backfill flow: `list_past_streams` → identify episodes of the show by title/timing → `set_stream_series` in batches → `set_stream_episode` per stream, using `get_episode_numbers` to keep the sequence consistent.

Series assignments feed plan generation (previous episodes' outlines become context), the episode smart sources in OBS, and the Streams page's grouping — keep them current.

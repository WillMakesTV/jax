Jax can pull a finished stream's VODs down to the local machine (via yt-dlp) and re-transcribe them with local Whisper. Downloads power the in-app video player, accurate transcripts, and the video editor's source footage — nothing is uploaded anywhere.

## Downloading a stream

- `download_stream` downloads a past stream's videos — the same action as the stream page's "Download videos" button. It resolves the best VOD per broadcast segment, preferring the configured source platform.
  - `startedAt`: the stream's RFC3339 start time from `list_past_streams`.
  - `source`: `"auto"` (default, honours the Settings → Streams preference), `"twitch"`, `"youtube"`, `"kick"`, or `"facebook"`.
  - `force: true` re-downloads even if a local copy exists.
- Only one download runs at a time; the call returns immediately and progress is visible in the app's status bar.
- `list_downloads` shows what's already on disk: title, platform, timing, file, and the `subfolder` that identifies the download to other tools.

Downloads land in the folder configured under **Settings → Streams** (with a sensible default). There is also a toggle to download past streams automatically.

## Re-transcribing from the download

Live captions are convenient but rough; transcribing the downloaded video produces a cleaner transcript.

- `transcribe_download` queues a downloaded video for local Whisper transcription, **replacing** any live-captured transcript for that stream. Pass the `subfolder` from `list_downloads`.
- The job runs in the background; it returns immediately and progress appears in the app. Transcription concurrency is configurable under Settings → Streams.
- Once finished, `get_stream_transcript` returns the new transcript.

## Practical notes

- Downloading requires yt-dlp and ffmpeg to be installed; transcription uses a local Python Whisper sidecar. If a tool call fails with an environment error, point the user at the setup rather than retrying.
- Deleting downloads is local-only and app-only (stream details page) — it never touches the platform VOD, and it is not exposed over MCP.

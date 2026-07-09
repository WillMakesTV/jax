Jax is a desktop control room for a streaming creator: it plans streams, pushes stream info to Twitch, YouTube, Kick, and Facebook, drives OBS, captures chat and transcripts while live, and archives everything for review and repurposing afterwards.

## The main areas

- **Dashboard** — live metrics and channel analytics at a glance.
- **Broadcast** — the on-air view: OBS program preview, cross-channel chat, live events, and the live transcript.
- **Planning** — upcoming stream plans, past streams, and content series (reusable show metadata).
- **Projects** — bodies of work (launches, campaigns) with markdown docs and asset files.
- **OBS Studio** — scenes, audio mixer, routines (action sequences), and smart sources (token-templated text).
- **Videos** — the channels' video catalogue, plus video plans that turn downloaded stream footage into edited videos.
- **Settings** — service connections (Twitch, YouTube, Kick, Facebook, Instagram, X, TikTok, OBS, Anthropic, OpenAI), stream download preferences, and these Application Skills.

## Working over MCP

The `jax` MCP server exposes read and planning tools that mirror what the app's pages show. General rules:

- Start with `get_app_status` to learn the creator's profile, which services are connected, and whether a stream session is open.
- Streams are identified by broadcast keys (`<platform>|<url>`) or by their RFC3339 `startedAt` time, both returned by `list_past_streams`. A currently live stream uses `live|<startedAt>`.
- List tools serve cached platform data; pass `refresh: true` only when freshness matters, because refetching costs API quota.
- Deliberately **not** available over MCP: going live or publishing stream info, OAuth and credentials, OBS control and routine execution, native file dialogs, and destructive deletes. Those stay behind an explicit click in the app — tell the user which button to press instead.

## Where to go deeper

Each feature area has its own Application Skill: planning streams, content series, going live, past streams, downloads and transcription, videos, projects, and OBS setup. Read the relevant one before working in that area.

Jax is a desktop control room for a streaming creator: it plans streams, pushes stream info to Twitch, YouTube, Kick, and Facebook, drives OBS, captures chat and transcripts while live, and archives everything for review and repurposing afterwards.

## The main areas

- **Dashboard** — live metrics and channel analytics at a glance.
- **Broadcasting** — the whole broadcast lifecycle: upcoming stream plans with go-live actions, the on-air view (OBS program preview, cross-channel chat, live events, live transcript), past streams, and content series (reusable show metadata).
- **Projects** — bodies of work (launches, campaigns) with markdown docs and asset files.
- **OBS Studio** — scenes, audio mixer, routines (action sequences), and stream widgets (on-stream overlay elements served locally as OBS Browser Sources, each with its own skill); opened from the top bar's CTA.
- **Videos** — the channels' video catalogue, plus video plans that turn downloaded stream footage into edited videos.
- **Settings** — service connections (Twitch, YouTube, Kick, Facebook, Instagram, X, TikTok, OBS, Anthropic, OpenAI), stream download preferences, and these Application Skills.

## Working over MCP

The `jax` MCP server exposes read and planning tools that mirror what the app's pages show. General rules:

- Start with `get_app_status` to learn the creator's profile, which services are connected, and whether a stream session is open.
- Before producing anything brand-facing (thumbnails, descriptions, outros), read `get_brand_guidelines` — the producer's written branding rules — plus `list_brand_assets` and `list_brand_links` (see the brand-assets skill). The written guidelines outrank generic style choices.
- Streams are identified by broadcast keys (`<platform>|<url>`) or by their RFC3339 `startedAt` time, both returned by `list_past_streams`. A currently live stream uses `live|<startedAt>`.
- List tools serve cached platform data; pass `refresh: true` only when freshness matters, because refetching costs API quota.
- Stream widgets are fully workable over MCP: `list_stream_widgets` discovers each widget's fields (kinds, caps, current values) and names its skill (`stream-widget-<id>`). Read that skill with `get_skill` before producing content for a widget, set text fields with `set_widget_field`, change how the widget is used by editing its skill with `save_skill`, and fire a 15-second on-stream test with `test_stream_widget`.
- Deliberately **not** available over MCP: going live or publishing stream info, OAuth and credentials, OBS control and routine execution, native file dialogs, and destructive deletes. Those stay behind an explicit click in the app — tell the user which button to press instead.

## Where to go deeper

Each feature area has its own Application Skill: planning streams, content series, going live, past streams, downloads and transcription, videos, projects, and OBS setup. Read the relevant one before working in that area.

- **Inspiration** is the reference shelf: other creators' videos, studied into summaries, outlines, manifests and takeaways. `search_inspiration` grounds an answer in what has actually been watched, and every hit carries a citation — see the "Inspiration library" skill.

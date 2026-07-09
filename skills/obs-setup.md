Jax connects to OBS over obs-websocket and layers three things on top: a control dashboard, routines (repeatable action sequences), and smart sources (text sources whose content is rendered from live data). The OBS connection lives in the app's frontend, so over MCP everything here is read-only — use `list_routines` for data and direct the user to the right panel for actions.

## The OBS Studio section

- **Dashboard** — program preview, scene list with one-click switching, the selected scene's sources, an audio mixer (mic inputs, a "Music" app-audio source with live meters and mute), webcam visibility, and start/stop broadcast controls.
- Stream start/stop from the app runs the built-in Start/End Stream routine steps around the OBS broadcast toggle.

## Routines

Routines are ordered step sequences: OBS actions (scene switches, source visibility, mute), waits, and steps replayed from a Stream Deck Multi Action (parsed from Stream Deck profiles — there is no API to press Stream Deck buttons directly).

- Built-ins: **Start Stream** and **End Stream**, each two-phase (steps before and after the broadcast toggle), tied to the go-live and stop buttons.
- Custom routines run manually from the Routines panel.
- `list_routines` returns every routine with its steps — use it to answer "what happens when I go live?" or to review a sequence before suggesting changes. Editing and execution happen in the app.

## Smart sources

Smart sources are OBS Text (GDI+) sources rendered from a token template — for example `{viewers} watching · {uptime}` — with live values pushed into OBS while streaming.

- Built-in tokens include `{viewers}`, `{uptime}`, `{title}`, `{category}`, `{followers}`, `{latest_sub}`, `{time}`, and episode-info tokens fed by the stream's series/episode assignment.
- **Custom tokens** (OBS Studio → Custom Tokens) are reusable name → static value pairs that any smart-source template can reference — good for handles, hashtags, or a season name that changes rarely.
- Edits to smart sources persist immediately and update OBS live.

Since series/episode assignments feed the episode smart sources, keeping assignments current (see the "Content series" skill) is part of keeping overlays correct.

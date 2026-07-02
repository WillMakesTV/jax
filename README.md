# Jax

A cross-platform desktop application for planning streams and managing video
content, built with [Wails](https://wails.io) (Go) and React + TypeScript.
Developed and tested on **Windows 11** with **GoLand**.

## Features

- **Dashboard** landing view with at-a-glance summary and quick actions.
- **Collapsible left navigation** (Streams, Videos, Settings) with a
  border-mounted chevron toggle; Settings is pinned to the bottom.
- **Light / dark theming** that defaults to your system setting, is toggleable
  (System / Light / Dark), persists, and meets **WCAG AAA** contrast.
- **User profile & avatar** — set a name and email; the avatar uses your
  [Gravatar](https://gravatar.com) when one exists, otherwise a default icon.
- **Service connections** (Settings → Services) with real integrations:
  - **OBS Studio** over its local WebSocket (obs-websocket v5).
  - **Twitch** via OAuth 2.0 Device Code Flow.
  - **YouTube** via Google's OAuth 2.0 limited-input device flow.

## Tech stack

| Layer    | Technology                                   |
| -------- | -------------------------------------------- |
| Backend  | Go 1.23, Wails v2                            |
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS 4 |
| Icons    | lucide-react, Simple Icons (brand logos)     |

## Prerequisites

You need **Go**, **Node.js**, and the **Wails CLI** installed.

### 1. Install Go (1.23+)

- Download the Windows installer from <https://go.dev/dl/> and run it (it adds
  Go to your `PATH`).
- Verify in a new terminal:
  ```powershell
  go version
  ```

### 2. Install Node.js (18+, 22 recommended)

- Install from <https://nodejs.org/> (or via `nvm`).
- Verify:
  ```powershell
  node --version
  npm --version
  ```

### 3. Install the Wails CLI (v2)

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Ensure Go's bin directory is on your `PATH` (the installer typically sets this):

- Default: `%USERPROFILE%\go\bin` (e.g. `C:\Users\you\go\bin`).

Then check your environment — this reports Go/Node versions, the WebView2
runtime (preinstalled on Windows 11), and anything missing:

```powershell
wails doctor
```

## Getting started

```powershell
# 1. Clone
git clone git@github.com:WillMakes/jax.git
cd jax

# 2. Install frontend dependencies
cd frontend
npm install
cd ..

# 3. Run in live-development mode (hot reload)
wails dev
```

`wails dev` builds the frontend, starts a Vite dev server with hot reload,
regenerates the Go↔TypeScript bindings, and opens the app window. It also serves
a dev build at <http://localhost:34115> so you can use browser devtools against
your Go methods.

## Building

To produce a redistributable, production binary:

```powershell
wails build
```

The executable is written to `build/bin/jax.exe`. Useful variants:

- `wails build -clean` — clean rebuild.
- `wails build -debug` — keep devtools and debug symbols in the binary.

## Project structure

```
jax/
├── main.go              # Wails app entry point & window options
├── app.go               # App struct + bound methods (persistence, service state)
├── store.go             # SQLite persistence layer (~/.jax/jax.db)
├── models.go            # Stream, ChannelSource, Profile, ServiceConfig models
├── services.go          # Twitch / YouTube OAuth device-flow backend
├── wails.json           # Wails project config
├── build/               # Build assets (icons, platform files)
└── frontend/
    ├── index.html
    ├── src/
    │   ├── App.tsx              # Layout + view routing
    │   ├── components/          # Sidebar, TopBar, Modal, Avatar, brand logos…
    │   ├── views/               # Dashboard, Streams, Videos, Settings, Profile
    │   ├── theme/               # ThemeProvider (light/dark/system)
    │   ├── profile/             # ProfileProvider
    │   ├── services/            # ServicesProvider + connect modals
    │   └── lib/                 # gravatar, obs-websocket client
    └── wailsjs/                 # Generated Go bindings (do not edit)
```

## Running & debugging in GoLand

GoLand isn't Wails-aware, so you wire the Wails CLI and a Go Build configuration
yourself. For day-to-day development with frontend hot reload, prefer running
`wails dev` from the terminal (or a Shell Script run configuration). To run and
**debug the Go backend** with native breakpoints, use a Go Build configuration:

1. **Open the project** (`File → Open` → the repo root, the folder with
   `go.mod`). Enable Go modules integration if prompted, and confirm
   `Settings → Go → GOROOT` points at your Go SDK.

2. **Build the frontend once.** `main.go` embeds `frontend/dist`
   (`//go:embed all:frontend/dist`), and that directory is git-ignored, so a
   fresh checkout has nothing to embed. Any Go compile (`go run`, `go build`,
   `go test`) fails until you build it once:
   ```powershell
   cd frontend; npm install; npm run build; cd ..
   # or simply: wails build
   ```

3. **Create the Go Build configuration:**
   `Run → Edit Configurations… → + → Go Build`, then set:
   - **Name:** `jax`
   - **Run kind:** `Directory`
   - **Directory:** the project root (folder containing `main.go`)
   - **Working directory:** the project root
   - **Go tool arguments** *(optional, Windows):* `-ldflags "-H windowsgui"`
     to suppress the background console window.

4. **Run or Debug.** Press **Run** (▶) to launch the app, or **Debug** (🐞) to
   launch it under the debugger — breakpoints in `app.go`, `services.go`, etc.
   are hit when the frontend calls your bound methods.

> Note: a Go Build configuration uses the **last-built** frontend assets (it
> does not start Vite), so rebuild the frontend or use `wails dev` when you are
> iterating on the UI.

## Connecting services

Open **Settings → Services** and select a service:

- **OBS Studio** — enable OBS's WebSocket server
  (`Tools → WebSocket Server Settings`), then enter the host, port, and
  password.
- **Twitch** — register an app in the
  [Twitch Developer Console](https://dev.twitch.tv/console/apps) and paste its
  Client ID. You'll authorize access in your browser.
- **YouTube** — create a **"TV and Limited Input"** OAuth client in the
  [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
  enable the **YouTube Data API v3**, and paste the Client ID and secret.

Connections persist across restarts: OAuth sessions (access + refresh tokens)
are stored locally and refreshed automatically when they expire, and OBS is
reconnected on launch using the saved settings (see Data storage below).

## Data storage

App data is persisted in a SQLite database at `~/.jax/jax.db` (on Windows,
`%USERPROFILE%\.jax\jax.db`), created automatically on first run. It holds your
profile, service connection config, OAuth sessions (tokens, refreshed on
demand), streams and channel sources, and UI preferences (theme, collapsed
navigation). The theme is additionally mirrored to `localStorage` so the
correct theme can be applied before first paint. Tokens and the OBS password
are stored in plaintext in this local, per-user file — acceptable for a local
single-user app; moving them to the OS keychain is a planned improvement.

To reset all local data, close the app and delete `~/.jax/jax.db` — it is
recreated empty on the next launch.

## Configuration

Project settings live in `wails.json`. See the
[Wails project config reference](https://wails.io/docs/reference/project-config).

import {GetSetting, SetSetting} from '../../wailsjs/go/main/App'

/**
 * Keys for the scalar UI preferences stored in the SQLite-backed settings
 * table (see store.go). Kept in one place so the Go and TS sides stay aligned.
 */
export const SETTING_KEYS = {
  theme: 'theme',
  navCollapsed: 'nav_collapsed',
  /** Minutes of tolerance when matching simulcast broadcasts (see past.go). */
  streamMatchMargin: 'stream_match_margin_min',
  /** "true"/"false": download past streams to disk. */
  downloadPastStreams: 'download_past_streams',
  /** Target directory for past-stream downloads ('' = the Videos/jax default). */
  downloadDir: 'download_dir',
  /** Preferred platform to download from: 'auto' | 'youtube' | 'twitch' | 'kick'. */
  downloadSource: 'download_source',
  /** How many downloaded videos may be transcribed at once: '1' | '2'. */
  transcribeConcurrency: 'transcribe_concurrency',
  /** Root for video-plan edit workspaces ('' = the Videos/jax edits default). */
  editWorkspaceDir: 'edit_workspace_dir',
  /** OBS input name of the audio input capture designated as primary mic. */
  obsMicSource: 'obs_mic_source',
  /** OBS input name of the Application Audio Capture designated as "Music". */
  obsMusicSource: 'obs_music_source',
  /**
   * JSON map of OBS scene name → the source designated as that scene's
   * primary camera. The active scene's entry drives the Primary Webcam.
   */
  obsSceneCameras: 'obs_scene_cameras',
  /**
   * JSON map of OBS Text (GDI+) source name → its smart-source template. The
   * app renders the template's tokens with live values and pushes the result
   * into the OBS source.
   */
  obsSmartSources: 'obs_smart_sources',
  /**
   * JSON map of custom smart-source token name → static value. Merged into the
   * built-in tokens when rendering smart-source templates.
   */
  obsSmartTokens: 'obs_smart_tokens',
  /**
   * JSON {title, number}: the OBS text sources the on-air episode's info is
   * written into directly (title verbatim, number as "Episode N").
   */
  obsEpisodeSources: 'obs_episode_sources',
  /**
   * "true"/"false": exclude the app window from screen capture
   * (SetWindowDisplayAffinity, like OBS's hide-from-capture option). Written
   * by the SetHideFromCapture binding, not saveSetting, so the Go side can
   * apply it as it persists.
   */
  hideFromCapture: 'hide_from_capture',
  /**
   * "true"/"false": keep the native script window above every other window.
   * Written by the SetScriptWindowTopmost binding, not saveSetting, so the Go
   * side can move an already-open window as it persists.
   */
  scriptWindowTopmost: 'script_window_topmost',
  /** Optional Google API key for reading public YouTube comments. */
  youtubeApiKey: 'youtube_api_key',
  /**
   * Prefix prepended to YouTube broadcast titles (e.g. "🔴 LIVE: "); blank
   * falls back to the default. Mirrors youtubeLivePrefix in planning.go.
   */
  youtubeLivePrefix: 'youtube_live_prefix',
  /**
   * "true"/"": show the optional AI Debugging skill in the skill catalog
   * (Settings → Development). Mirrors keyDevDebugSkillEnabled in store.go.
   */
  devDebugSkill: 'dev_ai_debug_skill_enabled',
  /**
   * GitHub OAuth app Client ID for the Development tab's device-flow
   * connection, kept so a reconnect doesn't ask for it again.
   */
  githubClientId: 'github_client_id',
  /**
   * The OpenCut web app the editor's OpenCut panel embeds ('' = the hosted
   * default). Point it at a self-hosted or bundled instance to work offline.
   */
  openCutUrl: 'opencut_url',
} as const

/**
 * Read a scalar UI setting from the backend store. Returns null when the key is
 * unset or the Wails runtime is unavailable (e.g. plain `npm run dev` without
 * a Go backend), so callers can fall back to a default or local cache.
 */
export async function loadSetting(key: string): Promise<string | null> {
  try {
    const value = await GetSetting(key)
    return value === '' ? null : value
  } catch {
    return null
  }
}

/**
 * Persist a scalar UI setting. Fire-and-forget: these preferences are
 * non-critical and the in-session React state is authoritative, so backend
 * write failures are intentionally ignored.
 */
export function saveSetting(key: string, value: string): void {
  try {
    void SetSetting(key, value)
  } catch {
    // Backend unavailable; nothing to persist to.
  }
}

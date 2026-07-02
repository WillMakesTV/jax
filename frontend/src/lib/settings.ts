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

import {SETTING_KEYS, loadSetting, saveSetting} from './settings'

// ---------------------------------------------------------------------------
// Per-scene primary-camera designations, persisted as a JSON map of
// scene name → camera source name (see SETTING_KEYS.obsSceneCameras).
// ---------------------------------------------------------------------------

/** Load the scene → primary-camera map (empty when unset or unparsable). */
export async function loadSceneCameras(): Promise<Record<string, string>> {
  const raw = (await loadSetting(SETTING_KEYS.obsSceneCameras)) ?? ''
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/** Persist the scene → primary-camera map. */
export function saveSceneCameras(map: Record<string, string>): void {
  saveSetting(SETTING_KEYS.obsSceneCameras, JSON.stringify(map))
}

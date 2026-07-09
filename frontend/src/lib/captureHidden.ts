import {useEffect, useState} from 'react'
import {SetHideFromCapture} from '../../wailsjs/go/main/App'
import {SETTING_KEYS, loadSetting} from './settings'

/**
 * Shared "hide application from screen capture" state. Both the Streams
 * settings toggle and the status-bar eye button flip the same preference, so
 * the module keeps one client-side copy (loaded once from the backend) and
 * notifies every mounted subscriber when either control changes it.
 */

let current = false
let loadPromise: Promise<void> | null = null
const listeners = new Set<(hidden: boolean) => void>()

function ensureLoaded(): Promise<void> {
  loadPromise ??= loadSetting(SETTING_KEYS.hideFromCapture).then((value) => {
    current = value === 'true'
    listeners.forEach((l) => l(current))
  })
  return loadPromise
}

/**
 * Subscribe to the hide-from-capture flag. The setter calls the Go binding
 * (which applies the window affinity and persists the preference) and only
 * updates subscribers once it succeeds — a rejection leaves the state as-is,
 * so callers can surface the error without the UI lying about the result.
 */
export function useCaptureHidden(): [
  boolean,
  (next: boolean) => Promise<void>,
] {
  const [hidden, setHidden] = useState(current)

  useEffect(() => {
    listeners.add(setHidden)
    setHidden(current)
    void ensureLoaded()
    return () => {
      listeners.delete(setHidden)
    }
  }, [])

  const set = async (next: boolean) => {
    await SetHideFromCapture(next)
    current = next
    listeners.forEach((l) => l(current))
  }

  return [hidden, set]
}

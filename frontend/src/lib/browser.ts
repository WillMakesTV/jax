import {BrowserOpenURL} from '../../wailsjs/runtime/runtime'

/**
 * Open a URL in the system browser via the Wails runtime, falling back to a
 * regular window.open when the runtime is unavailable (plain Vite dev).
 */
export function openExternal(url: string): void {
  if (!url) return
  try {
    BrowserOpenURL(url)
  } catch {
    window.open(url, '_blank', 'noreferrer')
  }
}

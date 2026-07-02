import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {SETTING_KEYS, loadSetting, saveSetting} from '../lib/settings'

/** The user's chosen theme preference. "system" follows the OS setting. */
export type ThemePreference = 'system' | 'light' | 'dark'

/** The concrete theme actually applied to the document. */
export type ResolvedTheme = 'light' | 'dark'

/**
 * The theme lives in the SQLite-backed store (source of truth), but is also
 * mirrored to localStorage under this key. The inline script in index.html
 * reads that cache synchronously before first paint to avoid a flash of the
 * wrong theme — something an async backend read cannot do.
 */
const STORAGE_KEY = 'jax:theme'

const isPreference = (v: string | null): v is ThemePreference =>
  v === 'light' || v === 'dark' || v === 'system'

interface ThemeContextValue {
  /** The user's preference: system | light | dark. */
  preference: ThemePreference
  /** The concrete theme currently applied (system resolved to light/dark). */
  resolved: ResolvedTheme
  /** Update the preference (persisted to localStorage). */
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

const readStoredPreference = (): ThemePreference => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // localStorage may be unavailable; fall through to default.
  }
  return 'system'
}

const resolve = (preference: ThemePreference): ResolvedTheme => {
  if (preference === 'system') return prefersDark() ? 'dark' : 'light'
  return preference
}

const applyToDocument = (resolved: ResolvedTheme): void => {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

export function ThemeProvider({children}: {children: ReactNode}) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readStoredPreference)
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolve(readStoredPreference()),
  )

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    // Update the pre-paint cache and the backing store.
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore persistence failures.
    }
    saveSetting(SETTING_KEYS.theme, next)
  }, [])

  // Hydrate the preference from the backend store on mount. The synchronous
  // localStorage read above gives the correct first paint; this reconciles with
  // the source of truth and seeds it on first run.
  useEffect(() => {
    let cancelled = false
    loadSetting(SETTING_KEYS.theme).then((stored) => {
      if (cancelled) return
      if (isPreference(stored)) {
        setPreferenceState(stored)
        try {
          localStorage.setItem(STORAGE_KEY, stored)
        } catch {
          // Ignore cache write failures.
        }
      } else {
        // Backend has no value yet: migrate the current (cached) preference.
        saveSetting(SETTING_KEYS.theme, preference)
      }
    })
    return () => {
      cancelled = true
    }
    // Run once on mount; `preference` is only read to seed the empty backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the resolved theme whenever the preference changes, and keep it in
  // sync with the OS when the preference is "system".
  useEffect(() => {
    const next = resolve(preference)
    setResolved(next)
    applyToDocument(next)

    if (preference !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const updated: ResolvedTheme = media.matches ? 'dark' : 'light'
      setResolved(updated)
      applyToDocument(updated)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  const value = useMemo<ThemeContextValue>(
    () => ({preference, resolved, setPreference}),
    [preference, resolved, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

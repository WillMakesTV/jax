import clsx from 'clsx'
import {Monitor, Moon, Sun, type LucideIcon} from 'lucide-react'
import {useEffect, useState} from 'react'
import {SETTING_KEYS, loadSetting, saveSetting} from '../../lib/settings'
import {useTheme, type ThemePreference} from '../../theme/ThemeProvider'

interface ThemeOption {
  value: ThemePreference
  label: string
  icon: LucideIcon
}

const THEME_OPTIONS: ThemeOption[] = [
  {value: 'system', label: 'System', icon: Monitor},
  {value: 'light', label: 'Light', icon: Sun},
  {value: 'dark', label: 'Dark', icon: Moon},
]

export function PreferencesTab() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <AppearanceSection />
      <ApplicationVoiceSection />
    </div>
  )
}

function AppearanceSection() {
  const {preference, resolved, setPreference} = useTheme()

  return (
    <section
      aria-labelledby="appearance-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <h2 id="appearance-heading" className="text-base font-semibold text-fg">
        Appearance
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Choose a theme. “System” follows your operating system setting
        (currently {resolved}).
      </p>

      <div
        role="radiogroup"
        aria-label="Theme"
        className="mt-4 inline-flex gap-1 rounded-lg border border-edge bg-bg p-1"
      >
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon
          const selected = preference === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(option.value)}
              className={clsx(
                'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                selected
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <Icon size={18} aria-hidden />
              {option.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** The gpt-4o-mini-tts voices; mirrors openaiTTSVoices in widget_tts.go. */
const VOICE_OPTIONS = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
] as const

/** Default voice; mirrors openaiTTSVoice in widget_tts.go. */
const DEFAULT_VOICE = 'alloy'

/** The voice used to speak the app's sound bytes and clips. */
function ApplicationVoiceSection() {
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE)

  useEffect(() => {
    let cancelled = false
    loadSetting(SETTING_KEYS.applicationVoice).then((value) => {
      if (cancelled) return
      if (value && (VOICE_OPTIONS as readonly string[]).includes(value)) {
        setVoice(value)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const change = (value: string) => {
    setVoice(value)
    saveSetting(SETTING_KEYS.applicationVoice, value)
  }

  return (
    <section
      aria-labelledby="voice-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <h2 id="voice-heading" className="text-base font-semibold text-fg">
        Application Voice
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        The voice used to speak sound bytes and clips — the same text-to-speech
        that renders a widget’s Sound field. Applies when an OpenAI API key is
        connected; without one, the local Windows voice is used instead.
      </p>

      <label
        htmlFor="application-voice"
        className="mb-1.5 mt-4 block text-sm font-medium text-fg"
      >
        Voice
      </label>
      <select
        id="application-voice"
        value={voice}
        onChange={(e) => change(e.target.value)}
        className="w-full max-w-xs rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg"
      >
        {VOICE_OPTIONS.map((name) => (
          <option key={name} value={name}>
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </option>
        ))}
      </select>
    </section>
  )
}

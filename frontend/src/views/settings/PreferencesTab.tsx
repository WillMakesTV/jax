import clsx from 'clsx'
import {Monitor, Moon, Sun, type LucideIcon} from 'lucide-react'
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
  const {preference, resolved, setPreference} = useTheme()

  return (
    <section
      aria-labelledby="appearance-heading"
      className="max-w-2xl rounded-xl border border-edge bg-surface p-6"
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

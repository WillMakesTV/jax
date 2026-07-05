import {Check, Folder, FolderOpen} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState, type FormEvent} from 'react'
import {
  DefaultDownloadDir,
  SelectDirectory,
} from '../../../wailsjs/go/main/App'
import {SETTING_KEYS, loadSetting, saveSetting} from '../../lib/settings'

/** Default matching margin in minutes; mirrors defaultMatchMargin in past.go. */
const DEFAULT_MARGIN_MIN = 5
const MIN_MARGIN = 1
const MAX_MARGIN = 120

export function StreamsTab() {
  const [margin, setMargin] = useState(String(DEFAULT_MARGIN_MIN))
  const [stored, setStored] = useState(String(DEFAULT_MARGIN_MIN))
  const [saved, setSaved] = useState(false)

  // Load the persisted margin on mount.
  useEffect(() => {
    let cancelled = false
    loadSetting(SETTING_KEYS.streamMatchMargin).then((value) => {
      if (cancelled || value === null) return
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed > 0) {
        setMargin(String(parsed))
        setStored(String(parsed))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const parsed = Number(margin)
  const valid =
    Number.isFinite(parsed) && parsed >= MIN_MARGIN && parsed <= MAX_MARGIN
  const dirty = margin.trim() !== stored

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid) return
    const value = String(parsed)
    saveSetting(SETTING_KEYS.streamMatchMargin, value)
    setMargin(value)
    setStored(value)
    setSaved(true)
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
    <DownloadsSection />
    <section
      aria-labelledby="stream-matching-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <h2
        id="stream-matching-heading"
        className="text-base font-semibold text-fg"
      >
        Stream matching
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Past broadcasts from different platforms are grouped into one stream by
        comparing their go-live times and durations, since titles often differ
        per platform (e.g. a &ldquo;🔴 LIVE:&rdquo; prefix on YouTube). The
        margin of error below controls how close those timings must be to count
        as the same stream.
      </p>

      <form onSubmit={onSubmit} className="mt-4">
        <label
          htmlFor="stream-match-margin"
          className="mb-1.5 block text-sm font-medium text-fg"
        >
          Margin of error (minutes)
        </label>
        <div className="flex items-center gap-3">
          <input
            id="stream-match-margin"
            type="number"
            inputMode="numeric"
            min={MIN_MARGIN}
            max={MAX_MARGIN}
            step={1}
            value={margin}
            onChange={(e) => {
              setMargin(e.target.value)
              setSaved(false)
            }}
            className="w-28 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg"
          />
          <button
            type="submit"
            disabled={!dirty || !valid}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity disabled:opacity-50"
          >
            Save
          </button>
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
              <Check size={16} aria-hidden />
              Saved
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-fg-muted">
          {valid
            ? `Broadcasts starting within ${parsed} minute${parsed === 1 ? '' : 's'} of each other (with similar durations) are treated as one stream. Default is ${DEFAULT_MARGIN_MIN}.`
            : `Enter a value between ${MIN_MARGIN} and ${MAX_MARGIN} minutes.`}
        </p>
      </form>
    </section>
    </div>
  )
}

/** Download-past-streams toggle and target directory. */
const SOURCE_OPTIONS = [
  {id: 'auto', label: 'Automatic (prefer YouTube)'},
  {id: 'youtube', label: 'YouTube'},
  {id: 'twitch', label: 'Twitch'},
] as const

function DownloadsSection() {
  const [enabled, setEnabled] = useState(false)
  const [dir, setDir] = useState('') // '' = use the default
  const [defaultDir, setDefaultDir] = useState('')
  const [source, setSource] = useState('auto')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [on, stored, def, src] = await Promise.all([
        loadSetting(SETTING_KEYS.downloadPastStreams),
        loadSetting(SETTING_KEYS.downloadDir),
        DefaultDownloadDir().catch(() => ''),
        loadSetting(SETTING_KEYS.downloadSource),
      ])
      if (cancelled) return
      setEnabled(on === 'true')
      setDir(stored ?? '')
      setDefaultDir(def)
      setSource(src ?? 'auto')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    saveSetting(SETTING_KEYS.downloadPastStreams, String(next))
  }

  const changeSource = (value: string) => {
    setSource(value)
    saveSetting(SETTING_KEYS.downloadSource, value)
  }

  const chooseFolder = async () => {
    try {
      const chosen = await SelectDirectory('Choose a download folder')
      if (chosen) {
        setDir(chosen)
        saveSetting(SETTING_KEYS.downloadDir, chosen)
      }
    } catch {
      // Dialog unavailable (e.g. plain Vite dev); ignore.
    }
  }

  const useDefault = () => {
    setDir('')
    saveSetting(SETTING_KEYS.downloadDir, '')
  }

  const effective = dir || defaultDir

  return (
    <section
      aria-labelledby="downloads-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="downloads-heading" className="text-base font-semibold text-fg">
            Download past streams
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Save a local copy of your past broadcasts. Choose where the files
            land, or leave it to default to a{' '}
            <span className="font-mono text-xs">jax</span> folder in your Videos
            directory.
          </p>
        </div>
        {/* Toggle switch. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Download past streams"
          onClick={toggle}
          className={clsx(
            'relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
            enabled ? 'bg-accent' : 'bg-surface-hover',
          )}
        >
          <span
            className={clsx(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-5 border-t border-edge pt-5">
          <label
            htmlFor="download-source"
            className="mb-1.5 block text-sm font-medium text-fg"
          >
            Preferred source
          </label>
          <select
            id="download-source"
            value={source}
            onChange={(e) => changeSource(e.target.value)}
            className="mb-4 w-full max-w-xs rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mb-4 -mt-2 text-xs text-fg-muted">
            Streams are simulcast to several channels; downloads pull the VOD
            from this source. If it isn&apos;t available for a stream, another
            connected channel is used.
          </p>

          <p className="mb-1.5 text-sm font-medium text-fg">Download folder</p>
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-2">
            <Folder size={16} aria-hidden className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
              {effective || 'Videos/jax'}
            </span>
            {!dir && (
              <span className="shrink-0 rounded-full border border-edge bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                Default
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void chooseFolder()}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <FolderOpen size={14} aria-hidden />
              Choose folder
            </button>
            {dir && (
              <button
                type="button"
                onClick={useDefault}
                className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                Use default
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

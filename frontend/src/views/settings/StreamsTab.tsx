import {Check} from 'lucide-react'
import {useEffect, useState, type FormEvent} from 'react'
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
    <section
      aria-labelledby="stream-matching-heading"
      className="max-w-2xl rounded-xl border border-edge bg-surface p-6"
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
  )
}

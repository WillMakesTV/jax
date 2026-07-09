import {Check, Folder, FolderInput, FolderOpen, MoveRight} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState, type FormEvent} from 'react'
import {
  DefaultDownloadDir,
  MoveDownloadFolder,
  SelectDirectory,
} from '../../../wailsjs/go/main/App'
import {Modal} from '../../components/Modal'
import {DEFAULT_YOUTUBE_LIVE_PREFIX} from '../../lib/broadcastTitles'
import {useCaptureHidden} from '../../lib/captureHidden'
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
    <StreamTitlesSection />
    <ScreenCaptureSection />
    <DownloadsSection />
    <TranscriptionSection />
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

/**
 * Keeps the app window out of screen captures, screen shares and display
 * captures — the same SetWindowDisplayAffinity trick as OBS's own
 * "hide from capture" option. The Go binding applies it to the live window
 * and persists the preference so it's re-applied on launch.
 */
function ScreenCaptureSection() {
  const [hidden, setHidden] = useCaptureHidden()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      await setHidden(!hidden)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : String(err) || 'The screen-capture setting could not be changed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="screen-capture-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="screen-capture-heading"
            className="text-base font-semibold text-fg"
          >
            Screen capture
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Hide application from screen capture. While enabled, display
            captures, screen shares and screenshots show nothing where this
            window sits — the same protection OBS offers its own windows — so
            capturing your screen on stream never reveals the app.
          </p>
        </div>
        {/* Toggle switch. */}
        <button
          type="button"
          role="switch"
          aria-checked={hidden}
          aria-label="Hide application from screen capture"
          onClick={() => void toggle()}
          disabled={busy}
          className={clsx(
            'relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
            hidden ? 'bg-accent' : 'bg-surface-hover',
          )}
        >
          <span
            className={clsx(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              hidden ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>
      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </section>
  )
}

/**
 * The "🔴 LIVE: " marker prepended to YouTube broadcast titles. YouTube keeps
 * a stream's title on the VOD afterwards, so the marker distinguishes the
 * live airing; Twitch titles are per-stream and carry no marker.
 */
function StreamTitlesSection() {
  const [prefix, setPrefix] = useState('')
  const [stored, setStored] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadSetting(SETTING_KEYS.youtubeLivePrefix).then((value) => {
      if (cancelled || value === null) return
      setPrefix(value)
      setStored(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const dirty = prefix !== stored
  const effective = prefix.trim() ? prefix : DEFAULT_YOUTUBE_LIVE_PREFIX

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    saveSetting(SETTING_KEYS.youtubeLivePrefix, prefix)
    setStored(prefix)
    setSaved(true)
  }

  return (
    <section
      aria-labelledby="stream-titles-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <h2 id="stream-titles-heading" className="text-base font-semibold text-fg">
        Stream titles
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        YouTube broadcasts go out with a live marker prepended to the
        plan&apos;s title, so the live airing stands apart from the VOD it
        becomes. Twitch uses the plan&apos;s title as-is.
      </p>

      <form onSubmit={onSubmit} className="mt-4">
        <label
          htmlFor="youtube-live-prefix"
          className="mb-1.5 block text-sm font-medium text-fg"
        >
          YouTube live prefix
        </label>
        <div className="flex items-center gap-3">
          <input
            id="youtube-live-prefix"
            value={prefix}
            onChange={(e) => {
              setPrefix(e.target.value)
              setSaved(false)
            }}
            placeholder={DEFAULT_YOUTUBE_LIVE_PREFIX}
            className="w-full max-w-xs rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!dirty}
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
          e.g. &ldquo;{effective}Episode 7 | Building the planner&rdquo; — leave
          blank to use the default.
        </p>
      </form>
    </section>
  )
}

/** Mirrors maxTranscribeConcurrency in transcribe_video.go. */
const DEFAULT_TRANSCRIBE_CONCURRENCY = '2'

/** How many downloaded videos may be transcribed at the same time. */
function TranscriptionSection() {
  const [concurrency, setConcurrency] = useState(
    DEFAULT_TRANSCRIBE_CONCURRENCY,
  )

  useEffect(() => {
    let cancelled = false
    loadSetting(SETTING_KEYS.transcribeConcurrency).then((value) => {
      if (cancelled) return
      if (value === '1' || value === '2') setConcurrency(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const change = (value: string) => {
    setConcurrency(value)
    saveSetting(SETTING_KEYS.transcribeConcurrency, value)
  }

  return (
    <section
      aria-labelledby="transcription-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <h2 id="transcription-heading" className="text-base font-semibold text-fg">
        Video transcription
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Downloaded videos queue for transcription; this controls how many are
        processed at the same time. Each run keeps a CPU-heavy speech model
        busy, so lower this if the app feels sluggish while transcribing.
      </p>

      <label
        htmlFor="transcribe-concurrency"
        className="mb-1.5 mt-4 block text-sm font-medium text-fg"
      >
        Simultaneous transcriptions
      </label>
      <select
        id="transcribe-concurrency"
        value={concurrency}
        onChange={(e) => change(e.target.value)}
        className="w-full max-w-xs rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg"
      >
        <option value="1">1 — one at a time</option>
        <option value="2">2 — two at once</option>
      </select>
    </section>
  )
}

/** Download-past-streams toggle and target directory. */
const SOURCE_OPTIONS = [
  {id: 'auto', label: 'Automatic (prefer YouTube)'},
  {id: 'youtube', label: 'YouTube'},
  {id: 'twitch', label: 'Twitch'},
  {id: 'kick', label: 'Kick'},
] as const

function DownloadsSection() {
  const [enabled, setEnabled] = useState(false)
  const [dir, setDir] = useState('') // '' = use the default
  const [defaultDir, setDefaultDir] = useState('')
  const [source, setSource] = useState('auto')
  // Move-folder flow: the picked target opens the confirmation, moving marks
  // the backend call in flight, and moveNote/moveError report how it went.
  const [moveTarget, setMoveTarget] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [moveNote, setMoveNote] = useState('')

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

  const pickMoveTarget = async () => {
    try {
      const chosen = await SelectDirectory('Move downloads to…')
      if (chosen) {
        setMoveError('')
        setMoveNote('')
        setMoveTarget(chosen)
      }
    } catch {
      // Dialog unavailable (e.g. plain Vite dev); ignore.
    }
  }

  const confirmMove = async () => {
    setMoving(true)
    setMoveError('')
    try {
      const count = await MoveDownloadFolder(moveTarget)
      setDir(moveTarget)
      setMoveNote(
        count === 0
          ? 'Folder moved; there were no downloads to carry over.'
          : `Moved ${count} download${count === 1 ? '' : 's'} to the new folder.`,
      )
      setMoveTarget('')
    } catch (err) {
      setMoveError(
        err instanceof Error && err.message
          ? err.message
          : String(err) || 'Could not move the download folder.',
      )
    } finally {
      setMoving(false)
    }
  }

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
            <button
              type="button"
              onClick={() => void pickMoveTarget()}
              className="inline-flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              <FolderInput size={14} aria-hidden />
              Move folder…
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
          <p className="mt-1.5 text-xs text-fg-muted">
            &ldquo;Choose folder&rdquo; only changes where new downloads land;
            &ldquo;Move folder&rdquo; also relocates the downloads you already
            have, and everything keeps working from the new location.
          </p>
          {moveNote && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <Check size={14} aria-hidden />
              {moveNote}
            </p>
          )}
          {moveError && !moveTarget && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {moveError}
            </p>
          )}
        </div>
      )}

      <Modal
        open={Boolean(moveTarget)}
        onClose={() => {
          if (!moving) setMoveTarget('')
        }}
        title="Move the download folder?"
        icon={<FolderInput size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          Your downloaded videos will be moved to the new folder and the app
          will use it from now on — transcripts, playback and stream history
          follow automatically.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-2">
            <Folder size={14} aria-hidden className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
              {effective}
            </span>
          </div>
          <MoveRight size={14} aria-hidden className="ml-3 text-fg-muted" />
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-2">
            <Folder size={14} aria-hidden className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
              {moveTarget}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          Moving between drives copies the files, which can take a while for a
          large library. Downloads and transcriptions can&apos;t run while the
          move is in progress.
        </p>
        {moveError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {moveError}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setMoveTarget('')}
            disabled={moving}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirmMove()}
            disabled={moving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {moving ? 'Moving…' : 'Move downloads'}
          </button>
        </div>
      </Modal>
    </section>
  )
}

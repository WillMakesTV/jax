import {Loader2, NotebookText, RefreshCw, Sparkles} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {GetStreamOutline, OutlineInProgress} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {formatDateTime} from '../lib/format'
import {useOutlineJobs} from '../outline/OutlineProvider'
import {useServices} from '../services/ServicesProvider'
import {MediaEmptyState} from './StreamMedia'

const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

/**
 * The past-stream Outline tab: an AI-generated, timestamped table of contents
 * built from the stream's chat and transcript via the connected Anthropic
 * service. Generated once and stored; regeneration is on demand.
 */
export function OutlinePanel({
  startedAt,
  durationSecs,
  title,
}: {
  startedAt: string
  /** The stream's full window in seconds (start → last broadcast end). */
  durationSecs: number
  /** Stream title for the status-bar chip. */
  title: string
}) {
  const {statuses} = useServices()
  const anthropicConnected =
    statuses.anthropic.connected || statuses.openai.connected
  const {jobs, generate} = useOutlineJobs()
  // A run owned by the app-wide provider (this page or a previous visit).
  const runningHere = jobs.some((j) => j.startedAt === startedAt)

  const [outline, setOutline] = useState<main.StreamOutline | null>(null)
  const [loaded, setLoaded] = useState(false)
  // A run only the backend knows about (e.g. after a frontend reload).
  const [backendBusy, setBackendBusy] = useState(false)
  const [error, setError] = useState('')

  const generating = runningHere || backendBusy

  // Load the stored outline, and pick up a backend generation already
  // running.
  useEffect(() => {
    let cancelled = false
    GetStreamOutline(startedAt)
      .then((o) => {
        if (!cancelled && o?.generatedAt) setOutline(o)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    OutlineInProgress(startedAt)
      .then((busy) => {
        if (!cancelled && busy) setBackendBusy(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [startedAt])

  // Poll a backend-only run until it finishes, then pick up the result.
  useEffect(() => {
    if (!backendBusy) return
    const id = window.setInterval(async () => {
      try {
        if (await OutlineInProgress(startedAt)) return
        setBackendBusy(false)
        const o = await GetStreamOutline(startedAt)
        if (o?.generatedAt) setOutline(o)
      } catch {
        // Transient; the next tick retries.
      }
    }, 3000)
    return () => window.clearInterval(id)
  }, [backendBusy, startedAt])

  // When a provider-owned run finishes while this page is open (started here
  // or on a previous visit), reload the stored result.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !runningHere) {
      GetStreamOutline(startedAt)
        .then((o) => {
          if (o?.generatedAt) setOutline(o)
        })
        .catch(() => {})
    }
    wasRunning.current = runningHere
  }, [runningHere, startedAt])

  const startGenerate = async () => {
    setError('')
    try {
      const result = await generate(startedAt, durationSecs, title)
      setOutline(result)
    } catch (err) {
      const message = messageOf(err, 'Could not generate the outline.')
      // The backend already has a run going — show progress instead.
      if (message.includes('already being generated')) {
        setBackendBusy(true)
      } else {
        setError(message)
      }
    }
  }

  if (!loaded) return <p className="text-sm text-fg-muted">Loading outline…</p>

  if (generating) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-edge bg-surface p-8 text-center">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <Loader2
            size={56}
            aria-hidden
            className="absolute inset-0 animate-spin text-accent/40"
          />
          <Sparkles
            size={22}
            aria-hidden
            className="animate-pulse text-accent"
          />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">
            Building the outline…
          </p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Claude is reading the stream's chat and transcript. This can take
            a minute or two — feel free to browse elsewhere; the outline is
            saved when it's done.
          </p>
        </div>
      </div>
    )
  }

  if (!outline) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-edge bg-surface p-8 text-center">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
        >
          <NotebookText size={24} />
        </span>
        <p className="max-w-sm text-sm text-fg-muted">
          No outline yet. Generate a timestamped breakdown of this stream from
          its chat and transcript.
        </p>
        {anthropicConnected ? (
          <button
            type="button"
            onClick={() => void startGenerate()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <Sparkles size={15} aria-hidden />
            Generate outline
          </button>
        ) : (
          <p className="text-xs text-fg-muted">
            Connect Anthropic in Settings → AI to generate outlines.
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          Generated {formatDateTime(outline.generatedAt) || outline.generatedAt}
          {outline.model && ` · ${outline.model}`}
        </p>
        {anthropicConnected && (
          <button
            type="button"
            onClick={() => void startGenerate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
          >
            <RefreshCw size={14} aria-hidden />
            Regenerate
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge bg-surface p-5">
        {outline.summary && (
          <p className="mb-5 text-sm leading-relaxed text-fg">
            {outline.summary}
          </p>
        )}
        {outline.items.length === 0 ? (
          <MediaEmptyState
            icon={NotebookText}
            text="The outline came back empty — try regenerating."
          />
        ) : (
          <ol className="space-y-4">
            {outline.items.map((item, i) => (
              <li key={`${item.at}-${i}`} className="flex items-start gap-3">
                <span className="shrink-0 rounded-md bg-surface-hover px-2 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
                  {item.at}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-fg">{item.title}</p>
                  {item.note && (
                    <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">
                      {item.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

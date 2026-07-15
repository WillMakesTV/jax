import clsx from 'clsx'
import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  RefreshCw,
  Scissors,
  Sparkles,
  Zap,
} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {
  ChooseClipIdea,
  ClipIdeasInProgress,
  GetClipIdeas,
  GetVideoPlans,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useClipIdeas} from '../clips/ClipIdeasProvider'
import type {VideoPlanTab} from '../views/VideoPlanDetails'
import {formatDate} from '../lib/format'
import {Markdown} from './markdown/Markdown'

type ClipFormat = 'short' | 'long'

const FORMATS: {id: ClipFormat; label: string; icon: typeof Zap}[] = [
  {id: 'short', label: 'Short', icon: Zap},
  {id: 'long', label: 'Long form', icon: Clapperboard},
]

interface ClipsPanelProps {
  stream: main.PastStream
  /** The stream's effective display title. */
  streamName: string
  /** Open a video plan, optionally on a specific tab. */
  onOpenVideoPlan: (plan: main.VideoPlan, tab?: VideoPlanTab) => void
}

/**
 * The Clips tab: make videos from this broadcast without the Plan Video
 * ceremony. The app pitches three scripts from the stream's outline and
 * transcript (per the video-script-ideas skill); picking one creates the plan
 * — source fixed to this stream, script already on the Editor tab — and the
 * pick quietly teaches the skill what to pitch next time.
 */
export function ClipsPanel({stream, streamName, onOpenVideoPlan}: ClipsPanelProps) {
  const clipIdeas = useClipIdeas()
  const [format, setFormat] = useState<ClipFormat>('short')
  const [ideas, setIdeas] = useState<main.ClipIdeaSet | null>(null)
  // A run the provider doesn't know about (started before a frontend
  // reload) still shows in the backend's job registry; tracked separately
  // and polled below until it clears.
  const [backendBusy, setBackendBusy] = useState(false)
  const [choosing, setChoosing] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [error, setError] = useState('')
  // Plans already cut from this stream.
  const [plans, setPlans] = useState<main.VideoPlan[]>([])

  // Generation is owned by ClipIdeasProvider so it survives navigating away;
  // this page just reflects whether a run for this stream + format is live.
  const generating =
    backendBusy ||
    clipIdeas.jobs.some(
      (j) => j.startedAt === stream.startedAt && j.format === format,
    )

  useEffect(() => {
    GetVideoPlans()
      .then((all) =>
        setPlans(
          (all ?? []).filter((p) =>
            (p.streams ?? []).some((s) => s.startedAt === stream.startedAt),
          ),
        ),
      )
      .catch(() => {})
  }, [stream.startedAt])

  // Show the stored set (and any run still going) when arriving or switching
  // formats — generation survives navigating away.
  useEffect(() => {
    let cancelled = false
    setIdeas(null)
    setExpanded(null)
    setError('')
    setBackendBusy(false)
    GetClipIdeas(stream.startedAt, format)
      .then((set) => {
        if (!cancelled && set.generatedAt) setIdeas(set)
      })
      .catch(() => {})
    ClipIdeasInProgress(stream.startedAt, format)
      .then((busy) => {
        if (!cancelled && busy) setBackendBusy(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [stream.startedAt, format])

  // The provider forgets a run when the frontend reloads mid-generation, so
  // a backend-reported run is polled until it clears (the finish is then
  // picked up by the refresh effect below).
  useEffect(() => {
    if (!backendBusy) return
    const id = window.setInterval(() => {
      ClipIdeasInProgress(stream.startedAt, format)
        .then((busy) => {
          if (!busy) setBackendBusy(false)
        })
        .catch(() => {})
    }, 4000)
    return () => window.clearInterval(id)
  }, [backendBusy, stream.startedAt, format])

  // When a run finishes while this page is open — including one started
  // before navigating away and back — pick up the stored result.
  const wasGenerating = useRef(false)
  useEffect(() => {
    if (wasGenerating.current && !generating) {
      GetClipIdeas(stream.startedAt, format)
        .then((set) => {
          if (set.generatedAt) setIdeas(set)
        })
        .catch(() => {})
    }
    wasGenerating.current = generating
  }, [generating, stream.startedAt, format])

  const generate = async () => {
    setError('')
    setExpanded(null)
    try {
      // Owned by the provider: the run keeps going (with a status-bar chip)
      // if the producer leaves this page; the refresh effect above shows the
      // result here.
      await clipIdeas.generate(stream.startedAt, streamName, format)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const choose = async (index: number) => {
    setChoosing(index)
    setError('')
    try {
      const plan = await ChooseClipIdea(
        stream.startedAt,
        streamName,
        format,
        index,
      )
      onOpenVideoPlan(plan, 'editor')
    } catch (err) {
      setError(String(err))
      setChoosing(null)
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section
        aria-labelledby="clip-ideas-heading"
        className="rounded-xl border border-edge bg-surface p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2
              id="clip-ideas-heading"
              className="text-base font-semibold text-fg"
            >
              Make a video from this stream
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Three script ideas, pitched from this broadcast's outline and
              transcript. Pick one and it becomes a video plan with the script
              already in the Editor — and your pick teaches the next pitch.
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="Video format"
            className="flex items-center gap-1 rounded-lg border border-edge bg-bg p-1"
          >
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                onClick={() => setFormat(f.id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  format === f.id
                    ? 'bg-accent text-accent-fg'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                <f.icon size={14} aria-hidden />
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {generating ? (
              <RefreshCw size={14} aria-hidden className="animate-spin" />
            ) : (
              <Sparkles size={14} aria-hidden />
            )}
            {generating
              ? 'Reading the transcript…'
              : ideas
                ? 'Regenerate ideas'
                : 'Generate 3 script ideas'}
          </button>
          {generating && (
            <p className="mt-2 text-xs text-fg-muted">
              This reads the whole broadcast — it can take a couple of minutes.
              Feel free to leave this page; the run keeps going, and its status
              lives in the bar at the bottom of the window.
            </p>
          )}
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        {ideas && ideas.ideas.length > 0 && !generating && (
          <ul className="mt-5 flex flex-col gap-3">
            {ideas.ideas.map((idea, i) => {
              const open = expanded === i
              return (
                <li
                  key={`${ideas.generatedAt}-${i}`}
                  className="rounded-lg border border-edge bg-bg p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-fg">
                        {idea.title}
                      </h3>
                      <p className="mt-0.5 text-sm text-fg-muted">{idea.hook}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void choose(i)}
                      disabled={choosing !== null}
                      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {choosing === i ? 'Creating…' : 'Use this script'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : i)}
                    aria-expanded={open}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
                  >
                    {open ? (
                      <ChevronDown size={14} aria-hidden />
                    ) : (
                      <ChevronRight size={14} aria-hidden />
                    )}
                    {open ? 'Hide script' : 'Read the script'}
                  </button>
                  {open && (
                    <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-edge bg-surface p-3">
                      <Markdown>{idea.script}</Markdown>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {plans.length > 0 && (
        <section
          aria-labelledby="stream-clips-heading"
          className="rounded-xl border border-edge bg-surface p-6"
        >
          <h2
            id="stream-clips-heading"
            className="inline-flex items-center gap-1.5 text-base font-semibold text-fg"
          >
            <Scissors size={15} aria-hidden />
            Videos from this stream
          </h2>
          <ul className="mt-3 flex flex-col divide-y divide-edge">
            {plans.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpenVideoPlan(p)}
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg hover:underline">
                      {p.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-fg-muted">
                      {[
                        p.format === 'short' ? 'Short form' : 'Long form',
                        p.status === 'completed'
                          ? `completed ${formatDate(p.completedAt)}`
                          : 'in production',
                      ].join(' · ')}
                    </span>
                  </span>
                  <span
                    className={clsx(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      p.status === 'completed'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-surface-hover text-fg-muted',
                    )}
                  >
                    {p.status === 'completed' ? 'Tracked' : 'Planned'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

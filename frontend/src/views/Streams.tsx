import {
  CalendarPlus,
  Link2,
  Radio,
  RefreshCw,
  Video,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState, type ReactNode} from 'react'
import {
  GetPastStreams,
  GroupPastStreams,
  UngroupPastStreams,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {openExternal} from '../lib/browser'
import {formatCompact, formatDate} from '../lib/format'
import {useLiveData} from '../live/LiveDataProvider'
import {SERVICES} from '../services/services'

interface StreamsProps {
  /** Open the details view for an aggregated past stream. */
  onOpenStream: (stream: main.PastStream) => void
  /** Open the details view for the current live stream. */
  onOpenLive: () => void
}

/**
 * Streams overview: a hero banner, stream-planning cards, and past streams
 * aggregated by timing across platforms. Live broadcast metrics and OBS
 * controls live on the Live Dashboard; chat has its own page.
 */
export function Streams({onOpenStream, onOpenLive}: StreamsProps) {
  return (
    <div className="flex flex-col gap-8">
      <Hero />
      <PlanningSection />
      <PastStreamsSection onOpenStream={onOpenStream} onOpenLive={onOpenLive} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-accent p-8 text-accent-fg">
      {/* Decorative watermark. */}
      <Radio
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 opacity-10"
        size={180}
        strokeWidth={1.5}
      />
      <div className="relative max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
          Streams
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Plan, go live, and review
        </h1>
        <p className="mt-2 text-sm opacity-90">
          Plan what&apos;s next and revisit past streams — all in one place.
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Past streams
//
// One stream is broadcast to several platforms under the same title, so the
// backend aggregates Twitch VODs and completed YouTube broadcasts by title
// into PastStream records referencing each channel's copy. The current live
// stream (if any) leads the grid.
// ---------------------------------------------------------------------------

/** Stable identity for one broadcast; mirrors broadcastKey in past.go. */
const broadcastKeyOf = (b: main.PastBroadcast) => `${b.platform}|${b.url}`

/** Selection identity for an aggregated stream. */
const streamKeyOf = (s: main.PastStream) =>
  s.broadcasts.map(broadcastKeyOf).join(',')

function PastStreamsSection({
  onOpenStream,
  onOpenLive,
}: {
  onOpenStream: (stream: main.PastStream) => void
  onOpenLive: () => void
}) {
  const {platforms} = useLiveData()
  const [past, setPast] = useState<main.PastStream[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(async (force = false) => {
    if (force) setRefreshing(true)
    try {
      const result = await GetPastStreams(force)
      setPast(result ?? [])
    } catch {
      // Backend unavailable (e.g. plain Vite dev); leave the list empty.
    } finally {
      setLoaded(true)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleSelected = useCallback((stream: main.PastStream) => {
    setError('')
    setSelected((prev) => {
      const key = streamKeyOf(stream)
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const selectedStreams = past.filter((s) => selected.has(streamKeyOf(s)))
  // Ungroup applies when exactly one manually-grouped stream is selected.
  const ungroupTarget =
    selectedStreams.length === 1 && selectedStreams[0].groupId
      ? selectedStreams[0]
      : null

  const onGroup = async () => {
    setBusy(true)
    setError('')
    try {
      await GroupPastStreams(
        selectedStreams.flatMap((s) => s.broadcasts.map(broadcastKeyOf)),
      )
      setSelected(new Set())
      await reload()
    } catch {
      setError('Could not group the selected streams.')
    } finally {
      setBusy(false)
    }
  }

  const onUngroup = async () => {
    if (!ungroupTarget) return
    setBusy(true)
    setError('')
    try {
      await UngroupPastStreams(ungroupTarget.groupId)
      setSelected(new Set())
      await reload()
    } catch {
      setError('Could not ungroup the selected stream.')
    } finally {
      setBusy(false)
    }
  }

  const live = platforms.filter((p) => p.live)
  const empty = loaded && past.length === 0 && live.length === 0

  return (
    <section aria-label="Past streams">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Past streams
          </h2>
          {/* Past broadcasts are served from the 1-hour API cache; this
              forces a fresh fetch. */}
          <button
            type="button"
            onClick={() => void reload(true)}
            disabled={refreshing}
            title="Fetch the latest data from the platforms"
            aria-label="Refresh past streams"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              aria-hidden
              className={clsx(refreshing && 'animate-spin')}
            />
          </button>
        </div>

        {/* Selection CTA: group the checked streams into one, or dissolve a
            manual group. Timing-based matching occasionally misses, so this
            is the manual escape hatch. */}
        {selectedStreams.length > 0 && (
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
            <span className="text-xs text-fg-muted">
              {selectedStreams.length} selected
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              Clear
            </button>
            {ungroupTarget && (
              <button
                type="button"
                onClick={onUngroup}
                disabled={busy}
                className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                Ungroup
              </button>
            )}
            {selectedStreams.length >= 2 && (
              <button
                type="button"
                onClick={onGroup}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Link2 size={14} aria-hidden />
                {busy ? 'Grouping…' : 'Group streams'}
              </button>
            )}
          </div>
        )}
      </div>

      {!loaded && past.length === 0 ? (
        <p className="text-sm text-fg-muted">Loading past streams…</p>
      ) : empty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Video size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">No past streams yet</p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Once you&apos;ve streamed on a connected channel, your broadcasts
            appear here aggregated across platforms.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.length > 0 && <LiveNowCard live={live} onOpen={onOpenLive} />}
          {past.map((stream) => (
            <PastStreamCard
              key={streamKeyOf(stream)}
              stream={stream}
              selected={selected.has(streamKeyOf(stream))}
              onToggleSelect={() => toggleSelected(stream)}
              onOpen={() => onOpenStream(stream)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** Thumbnail area shared by the live and past cards. */
function CardThumbnail({
  url,
  alt,
  overlay,
}: {
  url: string
  alt: string
  overlay?: ReactNode
}) {
  return (
    <div className="relative">
      {url ? (
        <img src={url} alt={alt} className="aspect-video w-full object-cover" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
          <Video size={28} aria-hidden />
        </div>
      )}
      {overlay}
    </div>
  )
}

/** Small platform chip linking out to one channel's copy of the stream. */
function BroadcastChip({
  platform,
  label,
  url,
}: {
  platform: string
  label: string
  url: string
}) {
  const def = SERVICES.find((s) => s.id === platform)
  const Icon = def?.Icon
  return (
    <button
      type="button"
      onClick={() => url && openExternal(url)}
      title={`Open on ${def?.name ?? platform}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
    >
      {Icon && (
        <span
          aria-hidden
          className="flex h-4 w-4 items-center justify-center rounded-full text-white"
          style={{backgroundColor: def?.brand}}
        >
          <Icon size={10} />
        </span>
      )}
      {label}
    </button>
  )
}

/** The current broadcast, aggregated across platforms, leading the grid. */
function LiveNowCard({
  live,
  onOpen,
}: {
  live: main.LiveStream[]
  onOpen: () => void
}) {
  const title = live.find((p) => p.title)?.title ?? 'Live now'
  const thumbnail = live.find((p) => p.thumbnailUrl)?.thumbnailUrl ?? ''
  const viewers = live.reduce((sum, p) => sum + p.viewerCount, 0)

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-red-500/40 bg-surface">
      {/* Thumbnail and title open the live details view; the platform chips
          below deep-link to each channel's stream instead. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open live stream details"
        className="text-left transition-opacity hover:opacity-90"
      >
        <CardThumbnail
          url={thumbnail}
          alt="Current live stream preview"
          overlay={
            <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Live
            </span>
          }
        />
      </button>
      <div className="flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left text-sm font-semibold text-fg hover:underline"
        >
          {title}
        </button>
        <p className="mt-1 text-xs text-fg-muted">
          {formatCompact(viewers)} watching now
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {live.map((p) => (
            <BroadcastChip
              key={p.platform}
              platform={p.platform}
              label={`${formatCompact(p.viewerCount)} watching`}
              url={p.streamUrl}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

function PastStreamCard({
  stream,
  selected,
  onToggleSelect,
  onOpen,
}: {
  stream: main.PastStream
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
}) {
  const duration = stream.broadcasts.find((b) => b.duration)?.duration
  const meta = [
    formatDate(stream.startedAt),
    duration,
    stream.totalViews > 0 ? `${formatCompact(stream.totalViews)} views` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-xl border bg-surface',
        selected ? 'border-accent ring-1 ring-accent' : 'border-edge',
      )}
    >
      {/* Selection checkbox for manual grouping, floating over the thumbnail. */}
      <label
        className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-edge bg-bg/85 backdrop-blur-sm"
        title="Select stream for grouping"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${stream.title || 'untitled stream'} for grouping`}
          className="h-3.5 w-3.5 accent-accent"
        />
      </label>
      {/* Thumbnail and title open the stream's details view; the platform
          chips below deep-link to each channel's VOD instead. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${stream.title || 'untitled stream'}`}
        className="text-left transition-opacity hover:opacity-90"
      >
        <CardThumbnail
          url={stream.thumbnailUrl}
          alt={`${stream.title || 'Untitled stream'} thumbnail`}
        />
      </button>
      <div className="flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left text-sm font-semibold text-fg hover:underline"
        >
          {stream.title || 'Untitled stream'}
        </button>
        {meta && <p className="mt-1 text-xs text-fg-muted">{meta}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {stream.broadcasts.map((b) => (
            <BroadcastChip
              key={`${b.platform}-${b.url}`}
              platform={b.platform}
              label={
                b.viewCount > 0 ? `${formatCompact(b.viewCount)} views` : 'Watch'
              }
              url={b.url}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Stream planning
// ---------------------------------------------------------------------------

interface PlanningCard {
  title: string
  description: string
  icon: LucideIcon
}

const PLANNING_CARDS: PlanningCard[] = [
  {
    title: 'Plan a stream',
    description:
      'Outline your next broadcast — title, description, and the plan for the run.',
    icon: CalendarPlus,
  },
  {
    title: 'Link a channel source',
    description:
      'Associate a Twitch or YouTube channel so streams post to the right place.',
    icon: Link2,
  },
]

function PlanningSection() {
  return (
    <section aria-label="Stream planning">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Stream planning
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PLANNING_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.title}
              className="flex items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
              >
                <Icon size={20} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-fg">
                    {card.title}
                  </span>
                  <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                    Soon
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{card.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

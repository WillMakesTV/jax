import {
  Calendar,
  CalendarPlus,
  Clapperboard,
  Eye,
  HardDrive,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState, type ReactNode} from 'react'
import {
  DeletePlannedStream,
  GetContentSeries,
  GetPastStreams,
  GetPlanSessions,
  GetPlannedStreams,
  GroupPastStreams,
  UngroupPastStreams,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {PlanStreamedActions} from '../components/PlanStreamedActions'
import {DownloadThumb} from '../components/DownloadThumb'
import {Modal} from '../components/Modal'
import {useDownloads} from '../downloads/useDownloads'
import {openExternal} from '../lib/browser'
import {useDataChanged} from '../lib/dataChanged'
import {
  formatCompact,
  formatDate,
  formatDurationMs,
  truncateText,
} from '../lib/format'
import {useLiveData} from '../live/LiveDataProvider'
import {SERVICES, platformName} from '../services/services'

// ---------------------------------------------------------------------------
// Stream sections rendered as tabs inside the Go Live! section (see
// LiveStream.tsx): stream planning and past streams. One stream is broadcast
// to several platforms under the same title, so the backend aggregates Twitch
// VODs and completed YouTube broadcasts by title into PastStream records
// referencing each channel's copy. The current live stream (if any) leads the
// past-streams grid.
// ---------------------------------------------------------------------------

/** Stable identity for one broadcast; mirrors broadcastKey in past.go. */
const broadcastKeyOf = (b: main.PastBroadcast) => `${b.platform}|${b.url}`

/** Selection identity for an aggregated stream. */
const streamKeyOf = (s: main.PastStream) =>
  s.broadcasts.map(broadcastKeyOf).join(',')

export function PastStreamsSection({
  onOpenStream,
  onOpenLive,
  onPlanVideo,
  showSummary,
}: {
  onOpenStream: (stream: main.PastStream) => void
  onOpenLive: () => void
  /** Open the "Plan a video" form (a short- or long-form video plan). */
  onPlanVideo?: () => void
  /** Render aggregate stat cards (count, total views, last stream) on top. */
  showSummary?: boolean
}) {
  const {platforms} = useLiveData()
  // Maps each stream to its downloaded copy (if any) so a card with a
  // missing or dead platform thumbnail can heal from the local video.
  const {byUrl} = useDownloads()
  const [past, setPast] = useState<main.PastStream[]>([])
  // The plan currently on the air (if the live stream was started from one)
  // and the plans themselves, so the live card can show the plan's thumbnail
  // instead of a platform's remote-source frame.
  const [plans, setPlans] = useState<main.PlannedStream[]>([])
  const [sessions, setSessions] = useState<main.PlanSessionInfo[]>([])
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

  // The live card's thumbnail comes from the plan that's on the air, so keep
  // the plans and their broadcast sessions in step with the current stream.
  const loadPlans = useCallback(() => {
    GetPlannedStreams()
      .then((p) => setPlans(p ?? []))
      .catch(() => {})
    GetPlanSessions()
      .then((s) => setSessions(s ?? []))
      .catch(() => {})
  }, [])

  useDataChanged(['planned_streams'], loadPlans)

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

  // Going live or concluding flips a plan's open session; refresh so the live
  // card picks up (or drops) the plan thumbnail without a manual reload.
  const anyLive = live.length > 0
  useEffect(() => {
    loadPlans()
  }, [loadPlans, anyLive])

  // The plan on the air is the one with an open broadcast session; its
  // thumbnail leads the live card in place of a platform's remote frame.
  const activePlanThumb = (() => {
    const open = sessions.find((s) => s.endedAt === '')
    if (!open) return ''
    return plans.find((p) => p.id === open.planId)?.thumbnailUrl ?? ''
  })()

  const totalViews = past.reduce((sum, s) => sum + s.totalViews, 0)
  const lastStream = past[0]

  return (
    <section aria-label="Broadcasting">
      {/* Aggregate stat cards. */}
      {showSummary && past.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatTile
            icon={Video}
            label="Recent streams"
            value={String(past.length)}
          />
          <StatTile
            icon={Eye}
            label="Total stream views"
            value={totalViews > 0 ? formatCompact(totalViews) : '—'}
          />
          <StatTile
            icon={Calendar}
            label="Last stream"
            value={lastStream ? formatDate(lastStream.startedAt) || '—' : '—'}
          />
        </div>
      )}

      <div className="mb-3 flex min-h-8 items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Broadcasting
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

        <div className="flex items-center gap-2">
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
          {/* Plan a produced video (short or long form) — the Videos-page
            counterpart of "Plan a stream"; plans surface atop that page. */}
          {onPlanVideo && (
            <button
              type="button"
              onClick={onPlanVideo}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Clapperboard size={14} aria-hidden />
              Plan a video
            </button>
          )}
        </div>
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
        // Three across on medium viewports, five at full width.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {live.length > 0 && (
            <LiveNowCard
              live={live}
              planThumbnailUrl={activePlanThumb}
              onOpen={onOpenLive}
            />
          )}
          {past.map((stream) => (
            <PastStreamCard
              key={streamKeyOf(stream)}
              stream={stream}
              subfolder={
                stream.broadcasts
                  .map((b) => byUrl.get(b.url)?.subfolder)
                  .find(Boolean) ?? ''
              }
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

/** Aggregate stat card for the past-streams summary. */
function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon size={16} aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold text-fg">{value}</p>
    </div>
  )
}

/** Thumbnail area shared by the live and past cards. */
function CardThumbnail({
  url,
  alt,
  subfolder,
  overlay,
}: {
  url: string
  alt: string
  /** The stream's download subfolder ('' when it has no downloaded copy).
   *  When set, a missing or dead platform thumbnail is replaced by a frame
   *  extracted from the downloaded video (see DownloadThumb). */
  subfolder?: string
  overlay?: ReactNode
}) {
  return (
    <div className="relative">
      {/* Placeholder underneath keeps the card's aspect while an image loads
          (or when there is none); a loaded image simply covers it. */}
      <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
        <Video size={28} aria-hidden />
      </div>
      {subfolder ? (
        <DownloadThumb
          subfolder={subfolder}
          src={url}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : url ? (
        <img
          src={url}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
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

/**
 * The current broadcast, leading the grid. It is shaped into a PastStream and
 * rendered through the same card as every finished stream — same fields, same
 * layout — with the card's live mode adding the on-air signals.
 */
function LiveNowCard({
  live,
  planThumbnailUrl,
  onOpen,
}: {
  live: main.LiveStream[]
  /** The on-air plan's thumbnail; preferred over the platform remote frame. */
  planThumbnailUrl: string
  onOpen: () => void
}) {
  const stream = main.PastStream.createFrom({
    title: live.find((p) => p.title)?.title ?? 'Live now',
    thumbnailUrl:
      planThumbnailUrl ||
      (live.find((p) => p.thumbnailUrl)?.thumbnailUrl ?? ''),
    startedAt:
      live
        .map((p) => p.startedAt)
        .filter(Boolean)
        .sort()[0] ?? '',
    totalViews: live.reduce((sum, p) => sum + p.viewerCount, 0),
    groupId: '',
    seriesId: '',
    episodeNumber: 0,
    episodeDescription: '',
    broadcasts: live.map((p) => ({
      platform: p.platform,
      title: p.title,
      url: p.streamUrl,
      thumbnailUrl: p.thumbnailUrl,
      startedAt: p.startedAt,
      duration: '',
      durationSecs: 0,
      viewCount: p.viewerCount,
    })),
  })

  return <PastStreamCard stream={stream} onOpen={onOpen} live />
}

function PastStreamCard({
  stream,
  subfolder = '',
  selected = false,
  onToggleSelect,
  onOpen,
  live = false,
}: {
  stream: main.PastStream
  /** The stream's download subfolder ('' when it has no downloaded copy). */
  subfolder?: string
  selected?: boolean
  /** Absent on the live card — an active broadcast cannot be grouped. */
  onToggleSelect?: () => void
  onOpen: () => void
  /** Renders the same card with active-broadcast signals. */
  live?: boolean
}) {
  // Live: runtime so far; past: the recorded duration.
  const startedMs = Date.parse(stream.startedAt)
  const duration = live
    ? Number.isFinite(startedMs)
      ? formatDurationMs(Date.now() - startedMs)
      : ''
    : stream.broadcasts.find((b) => b.duration)?.duration
  const meta = [
    formatDate(stream.startedAt),
    duration,
    stream.totalViews > 0
      ? `${formatCompact(stream.totalViews)} ${live ? 'watching now' : 'views'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-xl border bg-surface',
        live
          ? 'border-red-500/40'
          : selected
            ? 'border-accent ring-1 ring-accent'
            : 'border-edge',
      )}
    >
      {/* Selection checkbox for manual grouping, floating over the thumbnail;
          the live card carries the on-air badge in that corner instead. */}
      {!live && onToggleSelect && (
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
      )}
      {/* Thumbnail and title open the stream's details view; the platform
          chips below deep-link to each channel's copy instead. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${stream.title || 'untitled stream'}`}
        className="text-left transition-opacity hover:opacity-90"
      >
        <CardThumbnail
          url={stream.thumbnailUrl}
          alt={`${stream.title || 'Untitled stream'} thumbnail`}
          subfolder={subfolder}
          overlay={
            live ? (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                </span>
                Live
              </span>
            ) : stream.local ? (
              // The platforms no longer list this stream; only the
              // downloaded copy remains (top-right — the grouping checkbox
              // owns the other corner).
              <span
                title="No longer available on its platforms — only the downloaded copy remains"
                className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm"
              >
                <HardDrive size={11} aria-hidden />
                Local
              </span>
            ) : undefined
          }
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
                live
                  ? `${formatCompact(b.viewCount)} watching`
                  : b.viewCount > 0
                    ? `${formatCompact(b.viewCount)} views`
                    : 'Watch'
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

export function PlanningSection({
  onPlanStream,
  onOpenPlan,
}: {
  onPlanStream: () => void
  /** Open a planned stream's own view/edit page. */
  onOpenPlan: (plan: main.PlannedStream) => void
}) {
  const [plans, setPlans] = useState<main.PlannedStream[]>([])
  // Series titles for the plan cards' series tags, keyed by series id.
  const [seriesTitles, setSeriesTitles] = useState<Record<string, string>>({})
  // Each plan's latest broadcast session — how a card knows the plan has
  // already been streamed and can offer Conclude / Reset.
  const [sessions, setSessions] = useState<main.PlanSessionInfo[]>([])
  // The plan awaiting delete confirmation.
  const [toDelete, setToDelete] = useState<main.PlannedStream | null>(null)

  const {obs} = useLiveData()
  const streaming = Boolean(obs?.outputActive)

  const load = useCallback(() => {
    GetPlannedStreams()
      .then((p) => setPlans(p ?? []))
      .catch(() => {})
    GetContentSeries()
      .then((s) =>
        setSeriesTitles(
          Object.fromEntries((s ?? []).map((x) => [x.id, x.title])),
        ),
      )
      .catch(() => {})
    GetPlanSessions()
      .then((s) => setSessions(s ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [load, streaming])
  // New or edited plans (an MCP client planning a stream, a generated
  // thumbnail landing) appear without leaving the page.
  useDataChanged(['planned_streams', 'content_series'], load)

  const remove = async (id: string) => {
    try {
      await DeletePlannedStream(id)
      setPlans((prev) => prev.filter((p) => p.id !== id))
    } catch {
      // Non-fatal; the list will reconcile on the next load.
    }
  }

  return (
    <section aria-label="Stream planning">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Stream planning
        </h2>
        {plans.length > 0 && (
          <button
            type="button"
            onClick={onPlanStream}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            Plan a stream
          </button>
        )}
      </div>

      {plans.length === 0 ? (
        <button
          type="button"
          onClick={onPlanStream}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover sm:w-1/2"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            <CalendarPlus size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">Plan a stream</span>
            <p className="mt-1 text-sm text-fg-muted">
              Outline your next broadcast — title, description, and the channels
              it goes out to.
            </p>
          </div>
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              seriesTitle={seriesTitles[plan.seriesId] ?? ''}
              session={sessions.find((s) => s.planId === plan.id) ?? null}
              onOpen={() => onOpenPlan(plan)}
              onDelete={() => setToDelete(plan)}
              onConcluded={() =>
                setPlans((prev) => prev.filter((p) => p.id !== plan.id))
              }
              onReset={() =>
                setSessions((prev) => prev.filter((s) => s.planId !== plan.id))
              }
            />
          ))}
        </ul>
      )}

      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete this plan?"
        icon={<Trash2 size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          “{toDelete?.title}” will be removed from your planning. This can't be
          undone.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setToDelete(null)}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const plan = toDelete
              setToDelete(null)
              if (plan) void remove(plan.id)
            }}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Delete plan
          </button>
        </div>
      </Modal>
    </section>
  )
}

function PlanCard({
  plan,
  seriesTitle,
  session,
  onOpen,
  onDelete,
  onConcluded,
  onReset,
}: {
  plan: main.PlannedStream
  /** Title of the plan's linked content series ('' when none). */
  seriesTitle: string
  /** The plan's latest broadcast session, when it has gone live. */
  session: main.PlanSessionInfo | null
  onOpen: () => void
  onDelete: () => void
  /** The plan was concluded (it no longer exists). */
  onConcluded: () => void
  /** The plan's broadcast was forgotten; the plan remains. */
  onReset: () => void
}) {
  // Series + episode read as the card's own label — an eyebrow line above
  // the title rather than generic pills.
  const eyebrow = [
    seriesTitle,
    plan.episodeNumber > 0 ? `Episode ${plan.episodeNumber}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="flex flex-col rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        {/* The plan's generated thumbnail (from its thumbnail workbench),
            when it has one — small, inline with the plan's metadata. */}
        {plan.thumbnailUrl && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open the plan for ${plan.title}`}
            className="shrink-0 overflow-hidden rounded-md border border-edge"
          >
            <img
              src={plan.thumbnailUrl}
              alt=""
              aria-hidden
              className="aspect-video w-24 object-cover transition-opacity hover:opacity-90"
            />
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
        >
          {eyebrow && (
            <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-accent">
              {eyebrow}
            </span>
          )}
          <span className="block text-sm font-semibold text-fg hover:underline">
            {plan.title}
          </span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete plan"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      {/* The description sits on its own line below the header row. */}
      {plan.description && (
        <button
          type="button"
          onClick={onOpen}
          className="mt-2 text-left text-sm text-fg-muted"
        >
          {truncateText(plan.description, 150)}
        </button>
      )}
      {/* Channels sit on their own row below the plan's text. */}
      {plan.channels.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {plan.channels.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted"
            >
              <BrandTile platform={c} size={14} />
              {platformName(c)}
            </span>
          ))}
        </div>
      )}
      {/* Already gone live? The card wraps the episode up in place. */}
      <PlanStreamedActions
        planId={plan.id}
        session={session}
        onConcluded={onConcluded}
        onReset={onReset}
      />
    </li>
  )
}

import {
  AlertTriangle,
  Clapperboard,
  ExternalLink,
  Eye,
  Link2,
  Layers,
  Lightbulb,
  Loader2,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  DeleteInspirationVideo,
  GetInspirationChannel,
  GetInspirationTakeaways,
  GetInspirationTypes,
  GetInspirationVideos,
  ProcessInspirationVideo,
  SetInspirationChannelTakeaways,
  SetInspirationChannelTypes,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {PageHeader} from '../components/PageHeader'
import {openExternal} from '../lib/browser'
import {useDataChanged} from '../lib/dataChanged'
import {formatCompact, formatDate} from '../lib/format'
import {
  clock,
  inspirationError,
  isWorking,
  StatusPill,
  videoMeta,
} from './Inspiration'
import {InspirationPicker} from './InspirationPicker'
import {KindChip} from './InspirationTakeaways'

type ChannelTab = 'videos' | 'takeaways' | 'options'

/** How each takeaway's kind reads on its chip. */
const TAKEAWAY_KINDS: Record<string, string> = {
  tip: 'Tip',
  technique: 'Technique',
  concept: 'Concept',
  hook: 'Hook',
  format: 'Format',
  other: 'Note',
}

/**
 * One inspiration channel: the videos indexed from it, in the same card
 * language the Videos section uses. Tracked videos carry a Process CTA that
 * runs the whole pipeline: download, transcribe, study, extract takeaways.
 */
export function InspirationChannelDetails({
  channel: initial,
  onOpenVideo,
}: {
  channel: main.InspirationChannel
  /** Open one video's manifest page. */
  onOpenVideo: (video: main.InspirationVideo) => void
}) {
  const [channel, setChannel] = useState(initial)
  const [videos, setVideos] = useState<main.InspirationVideo[]>([])
  const [takeaways, setTakeaways] = useState<main.InspirationTakeawayRef[]>([])
  const [tab, setTab] = useState<ChannelTab>('videos')
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(() => {
    GetInspirationVideos(initial.id)
      .then((v) => setVideos(v ?? []))
      .catch(() => {})
    GetInspirationTakeaways(initial.id)
      .then((t) => setTakeaways(t ?? []))
      .catch(() => {})
    // Indexing a video refreshes the channel's own branding and metrics
    // behind the page, so re-read it alongside the videos.
    GetInspirationChannel(initial.id)
      .then(setChannel)
      .catch(() => {})
  }, [initial.id])

  useEffect(load, [load])
  useDataChanged(['inspiration'], load)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        description={
          channel.handle
            ? `${channel.handle} — ${videos.length} indexed video${videos.length === 1 ? '' : 's'}`
            : `${videos.length} indexed video${videos.length === 1 ? '' : 's'}`
        }
        actions={
          <div className="flex items-center gap-2">
            {channel.url && (
              <button
                type="button"
                onClick={() => openExternal(channel.url)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                <ExternalLink size={14} aria-hidden />
                Open on YouTube
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={14} aria-hidden />
              Add videos
            </button>
          </div>
        }
      />

      <ChannelHero
        channel={channel}
        videos={videos}
        takeawayCount={takeaways.length}
      />

      <div
        role="tablist"
        aria-label="Channel sections"
        className="mb-4 flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
      >
        {(
          [
            {id: 'videos', label: 'Videos', count: videos.length},
            {id: 'takeaways', label: 'Takeaways', count: takeaways.length},
            {id: 'options', label: 'Options'},
          ] as {id: ChannelTab; label: string; count?: number}[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-accent text-accent-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            {t.label}
            {Boolean(t.count) && (
              <span
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  tab === t.id
                    ? 'bg-accent-fg/20 text-accent-fg'
                    : 'bg-surface-hover text-fg-muted',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'videos' && (
        <ChannelVideos videos={videos} onOpenVideo={onOpenVideo} />
      )}

      {tab === 'takeaways' && (
        <ChannelTakeaways
          takeaways={takeaways}
          videos={videos}
          onOpenVideo={onOpenVideo}
        />
      )}

      {tab === 'options' && (
        <div className="flex flex-col gap-4">
          <ChannelTypeOptions channel={channel} onSaved={setChannel} />
          <TakeawaySkillOptions channel={channel} onSaved={setChannel} />
        </div>
      )}

      <InspirationPicker
        open={addOpen}
        channel={channel}
        onClose={() => setAddOpen(false)}
      />
    </div>
  )
}

/**
 * The channel at the top of its page: its banner, avatar, what it says about
 * itself, the links it publishes, and two rows of numbers — what the platform
 * reports about the channel, and what this library has made of it.
 */
function ChannelHero({
  channel,
  videos,
  takeawayCount,
}: {
  channel: main.InspirationChannel
  videos: main.InspirationVideo[]
  takeawayCount: number
}) {
  const studied = videos.filter((v) => v.status === 'ready').length
  const views = videos.reduce((sum, v) => sum + v.views, 0)
  const runtime = videos.reduce((sum, v) => sum + v.durationSecs, 0)
  const stats: {label: string; value: string}[] = [
    channel.subscribers > 0
      ? {label: 'Subscribers', value: formatCompact(channel.subscribers)}
      : null,
    channel.videoCount > 0
      ? {label: 'Videos published', value: formatCompact(channel.videoCount)}
      : null,
    {label: 'Indexed here', value: String(videos.length)},
    {label: 'Studied', value: String(studied)},
    takeawayCount > 0
      ? {label: 'Takeaways', value: String(takeawayCount)}
      : null,
    views > 0 ? {label: 'Views (indexed)', value: formatCompact(views)} : null,
    views > 0 && videos.length > 0
      ? {
          label: 'Median views',
          value: formatCompact(medianViews(videos)),
        }
      : null,
    runtime > 0 ? {label: 'Runtime (indexed)', value: clock(runtime)} : null,
  ].filter((s): s is {label: string; value: string} => s !== null)

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-edge bg-surface">
      {/* The banner, with the channel's numbers overlaid on it as cards. With
          no banner image a slate gradient stands in, so the cards always have
          a backdrop to sit on. */}
      <div className="relative">
        {channel.bannerUrl ? (
          <img
            src={channel.bannerUrl}
            alt={`${channel.name} banner`}
            className="h-40 w-full object-cover sm:h-52"
          />
        ) : (
          <div className="h-40 w-full bg-gradient-to-br from-slate-800 to-slate-900 sm:h-52" />
        )}
        {/* A scrim under the cards so light banners never wash them out. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/70 to-transparent" />
        {stats.length > 0 && (
          <dl className="absolute inset-x-0 bottom-0 flex flex-wrap gap-2 p-3">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 backdrop-blur-sm"
              >
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
                  {s.label}
                </dt>
                <dd className="mt-0.5 text-base font-semibold text-white">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        {channel.avatarUrl && (
          <img
            src={channel.avatarUrl}
            alt={`${channel.name} avatar`}
            className="h-16 w-16 shrink-0 rounded-full border border-edge object-cover sm:h-20 sm:w-20"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-fg">
              {channel.name}
            </span>
            {channel.handle && (
              <span className="text-sm text-fg-muted">{channel.handle}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <Users size={12} aria-hidden />
              {channel.subscribers > 0
                ? `${formatCompact(channel.subscribers)} subscribers`
                : 'Subscriber count unknown'}
            </span>
            {channel.indexedAt && (
              <span>Indexed {formatDate(channel.indexedAt)}</span>
            )}
          </div>
          {channel.description && (
            <p className="line-clamp-4 whitespace-pre-wrap text-sm text-fg-muted">
              {channel.description}
            </p>
          )}
          {channel.links.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {channel.links.map((l, i) => (
                <li key={`${l.url}-${i}`}>
                  <button
                    type="button"
                    onClick={() => openExternal(l.url)}
                    title={l.url}
                    className="inline-flex items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    <Link2 size={11} aria-hidden />
                    {l.label || l.url}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {channel.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {channel.tags.slice(0, 10).map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-edge bg-bg px-2 py-0.5 text-xs text-fg-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** The middle view count across a channel's indexed videos. */
function medianViews(videos: main.InspirationVideo[]): number {
  const counts = videos
    .map((v) => v.views)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  if (counts.length === 0) return 0
  const mid = Math.floor(counts.length / 2)
  return counts.length % 2 === 0
    ? Math.round((counts[mid - 1] + counts[mid]) / 2)
    : counts[mid]
}

/**
 * Everything this channel's videos have taught, in one place: the takeaways
 * from every studied video, packed by height and labelled with the video they
 * came from (clicking one opens it).
 */
function ChannelTakeaways({
  takeaways,
  videos,
  onOpenVideo,
}: {
  takeaways: main.InspirationTakeawayRef[]
  videos: main.InspirationVideo[]
  onOpenVideo: (video: main.InspirationVideo) => void
}) {
  const [kind, setKind] = useState('')

  // One count per kind, so the filter only offers kinds this channel actually
  // has and each chip carries how many.
  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const t of takeaways) out.set(t.kind, (out.get(t.kind) ?? 0) + 1)
    return out
  }, [takeaways])

  const shown = useMemo(
    () => (kind ? takeaways.filter((t) => t.kind === kind) : takeaways),
    [takeaways, kind],
  )

  if (takeaways.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
        Nothing lifted out of this channel yet — process a video and its
        takeaways collect here.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <KindChip
          label={`All (${takeaways.length})`}
          active={kind === ''}
          onClick={() => setKind('')}
        />
        {Object.entries(TAKEAWAY_KINDS)
          .filter(([id]) => (counts.get(id) ?? 0) > 0)
          .map(([id, label]) => (
            <KindChip
              key={id}
              label={`${label} (${counts.get(id)})`}
              active={kind === id}
              onClick={() => setKind(kind === id ? '' : id)}
            />
          ))}
      </div>

      <ul className="columns-1 gap-3 sm:columns-2 xl:columns-3">
        {shown.map((t, i) => (
          <li
            key={`${t.videoId}-${t.title}-${i}`}
            className="mb-3 flex break-inside-avoid flex-col gap-2 rounded-xl border border-edge bg-surface p-4"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                {TAKEAWAY_KINDS[t.kind] ?? t.kind}
              </span>
              {t.atSecs >= 0 && (
                <span className="font-mono text-xs text-accent">
                  {clock(t.atSecs)}
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-fg">{t.title}</p>
            {t.detail && <p className="text-sm text-fg-muted">{t.detail}</p>}
            {t.apply && (
              <p className="flex gap-2 rounded-lg bg-surface-hover p-2 text-sm text-fg">
                <Lightbulb
                  size={14}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-accent"
                />
                {t.apply}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                const video = videos.find((v) => v.id === t.videoId)
                if (video) onOpenVideo(video)
              }}
              className="truncate text-left text-xs text-fg-muted transition-colors hover:text-accent"
            >
              {t.videoTitle}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What this channel is studied for. Each tagged type's brief rides along with
 * its videos' takeaway extraction (see the "Inspiration types" skill).
 */
function ChannelTypeOptions({
  channel,
  onSaved,
}: {
  channel: main.InspirationChannel
  onSaved: (channel: main.InspirationChannel) => void
}) {
  const [types, setTypes] = useState<main.InspirationType[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    GetInspirationTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
  }, [])

  const toggle = async (id: string) => {
    const next = channel.typeIds.includes(id)
      ? channel.typeIds.filter((t) => t !== id)
      : [...channel.typeIds, id]
    setBusy(true)
    setError('')
    try {
      onSaved(await SetInspirationChannelTypes(channel.id, next))
    } catch (err) {
      setError(inspirationError(err, 'That could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex max-w-3xl flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <div>
        <p className="text-sm font-semibold text-fg">Studied for</p>
        <p className="mt-1 text-xs text-fg-muted">
          The lenses this channel is mined through. Each one adds its brief to
          the takeaway pass for this channel's videos; with none it is studied
          generically.
        </p>
      </div>
      {types.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No types defined yet — add them from Inspiration → Types.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {types.map((t) => {
            const on = channel.typeIds.includes(t.id)
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => void toggle(t.id)}
                  disabled={busy}
                  title={t.summary}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50',
                    on
                      ? 'border-accent bg-accent text-accent-fg'
                      : 'border-edge bg-bg text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  <Layers size={12} aria-hidden />
                  {t.name}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </section>
  )
}

/**
 * The channel's own definition of a takeaway. Blank means the app-wide
 * "Inspiration takeaways" skill (Settings → Skills) applies; anything here
 * replaces it for this channel's videos only.
 */
function TakeawaySkillOptions({
  channel,
  onSaved,
}: {
  channel: main.InspirationChannel
  onSaved: (channel: main.InspirationChannel) => void
}) {
  const [draft, setDraft] = useState(channel.takeawaysSkill)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => setDraft(channel.takeawaysSkill), [channel.takeawaysSkill])

  const save = async (content: string) => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const saved = await SetInspirationChannelTakeaways(channel.id, content)
      onSaved(saved)
      setNote(
        content.trim()
          ? 'Saved — this channel now uses its own brief.'
          : 'Cleared — this channel follows the app-wide skill again.',
      )
    } catch (err) {
      setError(inspirationError(err, 'That could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex max-w-3xl flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <div>
        <p className="text-sm font-semibold text-fg">Takeaways brief</p>
        <p className="mt-1 text-xs text-fg-muted">
          What counts as a takeaway for this channel. Leave it empty to follow
          the app-wide "Inspiration takeaways" skill (Settings → Skills). Keep
          the JSON shape the skill describes — the app parses the reply.
        </p>
      </div>
      <MarkdownField
        id={`inspiration-channel-takeaways-${channel.id}`}
        value={draft}
        onChange={setDraft}
        placeholder="Empty — following the app-wide skill."
      />
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {note && <p className="text-sm text-fg-muted">{note}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save(draft)}
          disabled={busy || draft === channel.takeawaysSkill}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={14} aria-hidden className="animate-spin" />}
          Save override
        </button>
        {channel.takeawaysSkill && (
          <button
            type="button"
            onClick={() => void save('')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Use the app-wide skill
          </button>
        )}
      </div>
    </section>
  )
}

/** How many video cards to reveal per lazy-load page. */
const VIDEO_PAGE = 20

/**
 * The channel's indexed videos: searchable across their titles, and revealed a
 * page at a time as the list is scrolled so a channel with hundreds of videos
 * doesn't render them all at once.
 */
function ChannelVideos({
  videos,
  onOpenVideo,
}: {
  videos: main.InspirationVideo[]
  onOpenVideo: (video: main.InspirationVideo) => void
}) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(VIDEO_PAGE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      q
        ? videos.filter((v) => (v.title || '').toLowerCase().includes(q))
        : videos,
    [videos, q],
  )

  // Start each new search back at the first page.
  useEffect(() => {
    setLimit(VIDEO_PAGE)
  }, [q])

  const visible = filtered.slice(0, limit)
  const hasMore = visible.length < filtered.length

  // Reveal the next page when the sentinel scrolls near the viewport; it sits
  // below the current cards, so more load a little before the list runs out.
  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setLimit((n) => n + VIDEO_PAGE)
      },
      {rootMargin: '400px'},
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, visible.length])

  if (videos.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
        Nothing indexed from this channel yet. Add videos to download,
        transcribe, and break them down.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-sm">
        <Search
          size={15}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search these videos…"
          aria-label="Search videos"
          className="w-full rounded-lg border border-edge bg-bg py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
          No videos match “{query.trim()}”.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {visible.map((v) => (
              <VideoCard key={v.id} video={v} onOpen={() => onOpenVideo(v)} />
            ))}
          </ul>
          {hasMore ? (
            <div ref={sentinelRef} aria-hidden className="h-1" />
          ) : (
            filtered.length > VIDEO_PAGE && (
              <p className="text-center text-xs text-fg-muted">
                All {filtered.length} videos shown.
              </p>
            )
          )}
        </>
      )}
    </div>
  )
}

function VideoCard({
  video,
  onOpen,
}: {
  video: main.InspirationVideo
  onOpen: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const working = isWorking(video.status)
  const thumb = video.thumbUrl || video.thumbnailUrl

  const process = async () => {
    setBusy(true)
    setError('')
    try {
      await ProcessInspirationVideo(video.id)
    } catch (err) {
      setError(inspirationError(err, 'That video could not be processed.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    try {
      await DeleteInspirationVideo(video.id)
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-edge bg-surface text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
      >
        <div className="relative">
          {thumb ? (
            <img
              src={thumb}
              alt={`${video.title || 'Untitled video'} thumbnail`}
              className="aspect-video w-full object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
              <Clapperboard size={28} aria-hidden />
            </div>
          )}
          {video.durationSecs > 0 && (
            <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {clock(video.durationSecs)}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-4">
          <p className="line-clamp-2 text-sm font-semibold text-fg">
            {video.title || 'Untitled video'}
          </p>
          {videoMeta(video) && (
            <p className="mt-1 text-xs text-fg-muted">{videoMeta(video)}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill video={video} />
            {video.views > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <Eye size={12} aria-hidden />
                {formatCompact(video.views)}
              </span>
            )}
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            {!working && video.status !== 'ready' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void process()
                }}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={12} aria-hidden className="animate-spin" />
                ) : (
                  <Play size={12} aria-hidden />
                )}
                {video.status === 'error' ? 'Try again' : 'Process'}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void remove()
              }}
              title="Remove this video"
              aria-label="Remove this video"
              className="ml-auto text-fg-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

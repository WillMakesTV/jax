import {
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Eye,
  Film,
  Link2,
  Plus,
  Radio,
  RefreshCw,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState} from 'react'
import {
  GetContentSeries,
  GetPastStreams,
  GetTrackedVideos,
  GetVideoPlans,
  GetVideos,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {PageHeader} from '../components/PageHeader'
import {PlatformPill} from '../components/PlatformPill'
import {TrackedSharesModal} from '../components/TrackedSharesModal'
import {useDataChanged} from '../lib/dataChanged'
import {formatAgo, formatCompact, formatDate} from '../lib/format'
import {useServices} from '../services/ServicesProvider'
import {anyChannelConnected} from '../services/services'

interface VideosProps {
  /** Open the details view for one video. */
  onOpenVideo: (video: main.Video) => void
  /** Open a saved video plan's view page. */
  onOpenVideoPlan: (plan: main.VideoPlan) => void
  /** Start planning a new video. */
  onPlanVideo: () => void
}

/** Visibility filter options; "public" is the default view. */
const STATUS_FILTERS = [
  {id: 'public', label: 'Public'},
  {id: 'unlisted', label: 'Unlisted'},
  {id: 'private', label: 'Private'},
  {id: 'all', label: 'All'},
] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]['id']

/**
 * Long-form and short-form are different catalogues that happen to live on the
 * same channels — a Short, a Reel and a full upload are not browsed the same
 * way — so the page separates them.
 */
const KIND_TABS = [
  {id: 'long', label: 'Long form'},
  {id: 'short', label: 'Shorts & Reels'},
] as const

type KindTab = (typeof KIND_TABS)[number]['id']

/**
 * Long form means YouTube, and only YouTube.
 *
 * Twitch and Kick VODs are recordings of broadcasts, not published videos —
 * they belong under Broadcasting, where they already appear, and listing them
 * here again just makes the catalogue look like something it isn't. Facebook's
 * video edge is the same story. What's left is the thing this page is actually
 * for: the produced, long-form YouTube catalogue.
 */
const isLongForm = (v: main.Video) => v.platform === 'youtube' && !v.isShort

/** A video's visibility; entries predating the field count as public. */
const statusOf = (v: main.Video) => v.status || 'public'

/** One of a plan's source streams, resolved to what it actually was. */
interface PlanSource {
  startedAt: string
  title: string
  /** "S2" — the season of the stream's content series ("" when it has none). */
  season: string
  episodeNumber: number
  thumbnailUrl: string
}

/** Render a series' season as a badge: a bare number becomes "S1". */
const seasonLabel = (season: string): string => {
  const s = season.trim()
  if (!s) return ''
  return /^\d+$/.test(s) ? `S${s}` : s
}

/**
 * Resolve a plan's source references (which store only a start time and a
 * snapshotted title) to the streams they actually point at — the episode
 * number, the season of the show they belong to, and the screenshot.
 *
 * A reference whose stream has since disappeared keeps the title the plan
 * snapshotted, rather than vanishing from the card: the plan still draws on it.
 */
const resolveSources = (
  plan: main.VideoPlan,
  pastStreams: main.PastStream[],
  seasonBySeries: Map<string, string>,
): PlanSource[] =>
  (plan.streams ?? []).map((ref) => {
    const stream = pastStreams.find((s) => s.startedAt === ref.startedAt)
    return {
      startedAt: ref.startedAt,
      title: stream?.title || ref.title || 'Untitled stream',
      season: stream?.seriesId
        ? seasonLabel(seasonBySeries.get(stream.seriesId) ?? '')
        : '',
      episodeNumber: stream?.episodeNumber ?? 0,
      thumbnailUrl: stream?.thumbnailUrl ?? '',
    }
  })

// ---------------------------------------------------------------------------
// Grouping short-form across platforms
//
// One short gets posted to YouTube, TikTok, Instagram and Facebook — that is
// one video with four sets of numbers, not four videos. Listed separately it
// buries the catalogue in near-duplicates and hides the only question worth
// asking: where did this one land?
//
// The platforms give us nothing to join on — no shared id, no cross-post
// marker — so the title is the join key. It is normalized hard (case, emoji,
// hashtags, punctuation) because the same short is rarely captioned
// identically twice.
// ---------------------------------------------------------------------------

/**
 * Reduce a caption to the words in it, so "Boss fight! 🔥 #gaming" and
 * "boss fight" land together.
 */
const shortKey = (title: string): string =>
  title
    .toLowerCase()
    .replace(/#\S+/g, '') // hashtags are platform noise, not the title
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // emoji and punctuation
    .replace(/\s+/g, ' ')
    .trim()

/** One short, and every platform it was posted to. */
interface ShortGroup {
  key: string
  /** The posting used for the title, thumbnail and date. */
  lead: main.Video
  /** Every platform's copy, one per platform. */
  postings: main.Video[]
  totalViews: number
}

/**
 * Group the shorts, one card per video rather than one per posting.
 *
 * Two join keys, in order of authority. First the tracked videos' share
 * links: postings the user has linked to one plan are one video, whatever
 * they're captioned — the user's word beats any heuristic. Then the title,
 * for everything unlinked.
 *
 * Within the title heuristic, two videos from the *same* platform never
 * merge, however alike their titles: a channel with two shorts called "Day 3"
 * has two shorts, and quietly folding one into the other would lose it.
 * Same-titled postings on one platform are therefore spread across sibling
 * groups instead of being collapsed.
 */
function groupShorts(
  videos: main.Video[],
  planByVideo: Map<string, string> = new Map(),
): ShortGroup[] {
  const sortPostings = (list: main.Video[]) =>
    [...list].sort((a, b) => b.viewCount - a.viewCount)
  // The lead carries the card: prefer a posting that actually has a
  // thumbnail, then the most-watched one.
  const pickLead = (list: main.Video[]) =>
    [...list].sort(
      (a, b) =>
        Number(Boolean(b.thumbnailUrl)) - Number(Boolean(a.thumbnailUrl)) ||
        b.viewCount - a.viewCount,
    )[0] ?? list[0]
  const makeGroup = (key: string, postings: main.Video[]): ShortGroup => ({
    key,
    lead: pickLead(postings),
    postings: sortPostings(postings),
    totalViews: postings.reduce((sum, v) => sum + v.viewCount, 0),
  })

  // Pull the share-linked postings out first, one group per plan.
  const byPlan = new Map<string, main.Video[]>()
  const rest: main.Video[] = []
  for (const v of videos) {
    const planId = planByVideo.get(`${v.platform}|${v.id}`)
    if (planId) {
      const list = byPlan.get(planId)
      if (list) list.push(v)
      else byPlan.set(planId, [v])
    } else {
      rest.push(v)
    }
  }
  const planGroups = [...byPlan].map(([planId, postings]) =>
    makeGroup(`plan:${planId}`, postings),
  )
  const planByTitle = new Map<string, ShortGroup[]>()
  for (const g of planGroups) {
    const k = shortKey(g.lead.title)
    if (!k) continue
    const list = planByTitle.get(k)
    if (list) list.push(g)
    else planByTitle.set(k, [g])
  }

  const byTitle = new Map<string, main.Video[]>()
  for (const v of rest) {
    // An untitled short can't be matched to anything, so it stands alone.
    const key = shortKey(v.title) || `${v.platform}:${v.id}`
    const list = byTitle.get(key)
    if (list) list.push(v)
    else byTitle.set(key, [v])
  }

  const groups: ShortGroup[] = []
  for (const [key, postings] of byTitle) {
    // The title heuristic used to merge e.g. a YouTube Short with its TikTok
    // cross-post; linking only one of them to a plan must not split the
    // pair. A title bucket whose key matches exactly one plan group folds
    // into it — provided no platform appears twice afterwards, which would
    // mean it wasn't the same video after all.
    const candidates = planByTitle.get(key)
    if (
      candidates?.length === 1 &&
      new Set(postings.map((p) => p.platform)).size === postings.length
    ) {
      const target = candidates[0]
      const targetPlatforms = new Set(target.postings.map((p) => p.platform))
      if (!postings.some((p) => targetPlatforms.has(p.platform))) {
        target.postings = sortPostings([...target.postings, ...postings])
        target.lead = pickLead(target.postings)
        target.totalViews = target.postings.reduce(
          (sum, v) => sum + v.viewCount,
          0,
        )
        continue
      }
    }

    // Bucket by platform: each group takes at most one posting per platform,
    // so duplicates on a single platform become their own groups rather than
    // vanishing.
    const byPlatform = new Map<string, main.Video[]>()
    for (const v of postings) {
      const list = byPlatform.get(v.platform)
      if (list) list.push(v)
      else byPlatform.set(v.platform, [v])
    }
    const slots = Math.max(...[...byPlatform.values()].map((l) => l.length))

    for (let i = 0; i < slots; i++) {
      const slot = [...byPlatform.values()]
        .map((l) => l[i])
        .filter(Boolean) as main.Video[]
      if (slot.length === 0) continue
      groups.push(makeGroup(`${key}#${i}`, slot))
    }
  }
  groups.push(...planGroups)

  // Newest first, like the rest of the page.
  return groups.sort((a, b) =>
    (b.lead.publishedAt || '').localeCompare(a.lead.publishedAt || ''),
  )
}

/**
 * All videos/VODs from the connected channels, aggregated newest-first.
 * Results come from the backend's 1-hour API cache; the refresh CTA forces a
 * fresh fetch.
 */
export function Videos({onOpenVideo, onOpenVideoPlan, onPlanVideo}: VideosProps) {
  const {statuses} = useServices()
  const [list, setList] = useState<main.VideoList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('public')
  const [kindTab, setKindTab] = useState<KindTab>('long')

  // Video plans lead the page, like planned streams on the Broadcast page.
  // Completed ones drop out of production and into Tracked Videos below.
  const [plans, setPlans] = useState<main.VideoPlan[]>([])
  const [tracked, setTracked] = useState<main.TrackedVideo[]>([])
  // The tracked video whose share links are being edited (id, so the modal
  // follows the entry through onSaved replacements).
  const [sharesForId, setSharesForId] = useState<string | null>(null)
  // A plan's sources store only a start time; the streams and their series are
  // what turn that into "S2 · EP04 — Boss fight" with a screenshot.
  const [pastStreams, setPastStreams] = useState<main.PastStream[]>([])
  const [seasonBySeries, setSeasonBySeries] = useState(new Map<string, string>())

  const loadPlans = useCallback(() => {
    GetVideoPlans()
      .then((p) => setPlans((p ?? []).filter((v) => v.status !== 'completed')))
      .catch(() => {})
    GetTrackedVideos()
      .then((t) => setTracked(t ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadPlans()
    GetPastStreams(false)
      .then((s) => setPastStreams(s ?? []))
      .catch(() => {})
    GetContentSeries()
      .then((series) =>
        setSeasonBySeries(
          new Map((series ?? []).map((s) => [s.id, s.season ?? ''])),
        ),
      )
      .catch(() => {})
  }, [loadPlans])
  // Plans and tracked videos change behind this page's back — a plan
  // completed elsewhere, a publish landing, share links edited — so re-read
  // them whenever their stores move.
  useDataChanged(
    ['video_plans', 'video_plan_publish', 'video_plan_publish_tiktok'],
    loadPlans,
  )

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    setError('')
    try {
      setList(await GetVideos(force))
    } catch {
      setError('Could not load videos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const oauthConnected = anyChannelConnected(statuses)
  // Everything this page will ever show: the YouTube long-form catalogue, and
  // short-form from wherever it was posted.
  const allVideos = (list?.videos ?? []).filter(
    (v) => isLongForm(v) || v.isShort,
  )
  const videos = allVideos.filter(
    (v) =>
      (statusFilter === 'all' || statusOf(v) === statusFilter) &&
      (kindTab === 'short' ? v.isShort : isLongForm(v)),
  )
  // The tracked videos' share links assert which postings are one video —
  // the join key the platforms never gave us.
  const planByVideo = new Map<string, string>()
  for (const t of tracked) {
    for (const s of t.shares) {
      if (s.video) planByVideo.set(`${s.video.platform}|${s.video.id}`, t.plan.id)
    }
    if (t.record?.videoId) planByVideo.set(`youtube|${t.record.videoId}`, t.plan.id)
  }
  // One card per short, not one per posting — the tab count follows suit, or
  // it would promise four videos and show one.
  const shortGroups = groupShorts(videos.filter((v) => v.isShort), planByVideo)
  const shortCount = groupShorts(
    allVideos.filter((v) => v.isShort),
    planByVideo,
  ).length

  return (
    <div className="flex flex-col">
      <PageHeader
        description="Your published catalogue: long-form videos on YouTube, and short-form from every channel."
        actions={
          <div className="flex items-center gap-3">
            {list?.fetchedAt && (
              <span className="text-xs text-fg-muted">
                Updated {formatAgo(list.fetchedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              title="Fetch the latest data from the platforms"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                aria-hidden
                className={clsx(loading && 'animate-spin')}
              />
              Refresh
            </button>
          </div>
        }
      />

      {error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Planned videos: the ideas being produced, ahead of the published
          list — the Videos-page counterpart of the Broadcast page's planned
          streams. Each card opens its plan; hidden when nothing is planned. */}
      {plans.length > 0 && (
        <section aria-label="Planned videos" className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Planned Videos
            </h2>
            <button
              type="button"
              onClick={onPlanVideo}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={14} aria-hidden />
              Plan a video
            </button>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {plans.map((plan) => (
              <li key={plan.id}>
                <PlannedVideoCard
                  plan={plan}
                  sources={resolveSources(plan, pastStreams, seasonBySeries)}
                  onOpen={() => onOpenVideoPlan(plan)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tracked videos: the plans that made it out. They no longer need
          producing, so the question is how they are doing. */}
      {tracked.length > 0 && (
        <section aria-label="Tracked videos" className="mb-6">
          <h2 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            <CheckCircle2 size={13} aria-hidden />
            Tracked Videos ({tracked.length})
          </h2>
          {/* Dense tiles, the thumbnail as each card's backdrop (like the
              planned cards above): 4-up on medium viewports, 6-up on full
              screens. The card carries the aggregate across every source —
              per-platform numbers live on the video's page. */}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 2xl:grid-cols-6">
            {tracked.map((t) => {
              const thumb = t.live?.thumbnailUrl || t.plan.thumbnailUrl
              const views =
                t.totalViews > 0
                  ? t.totalViews
                  : t.live && t.live.viewCount > 0
                    ? t.live.viewCount
                    : 0
              return (
                <li key={t.plan.id}>
                  <div className="relative flex h-full min-h-28 flex-col overflow-hidden rounded-xl border border-edge bg-surface p-3 transition-colors hover:border-accent/50">
                    {thumb && (
                      <span aria-hidden className="absolute inset-0">
                        <img
                          src={thumb}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                        {/* Anchored at the top so the title always sits on a
                            solid surface; the thumbnail shows through lower
                            down. */}
                        <span className="absolute inset-0 bg-gradient-to-b from-surface via-surface/80 to-surface/50" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenVideoPlan(t.plan)}
                      title="Open the plan this video came from"
                      className="relative min-w-0 flex-1 text-left"
                    >
                      <span className="line-clamp-2 text-sm font-semibold text-fg hover:underline">
                        {t.live?.title || t.record?.title || t.plan.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-fg-muted">
                        {[
                          t.plan.format === 'short' ? 'Short' : 'Long form',
                          t.plan.completedAt
                            ? formatDate(t.plan.completedAt)
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                    <div className="relative mt-2 flex items-center justify-between gap-2">
                      <span
                        className="inline-flex items-center gap-1 text-xs font-semibold text-fg"
                        title={`${views ? formatCompact(views) : 'No'} views across ${t.shares.length + (t.record ? 1 : 0) || 1} source${t.shares.length + (t.record ? 1 : 0) === 1 ? '' : 's'}`}
                      >
                        <Eye size={12} aria-hidden />
                        {views ? `${formatCompact(views)} views` : '— views'}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSharesForId(t.plan.id)}
                          title="Add links to everywhere this video was shared"
                          aria-label="Edit share links"
                          className="inline-flex items-center rounded-lg border border-edge bg-bg/80 p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                        >
                          <Link2 size={13} aria-hidden />
                        </button>
                        {t.record?.url && (
                          <a
                            href={t.record.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Watch the published video"
                            aria-label="Watch the published video"
                            className="inline-flex items-center rounded-lg border border-edge bg-bg/80 p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                          >
                            <ExternalLink size={13} aria-hidden />
                          </a>
                        )}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Long form and short form are separate catalogues; the visibility
          filter narrows whichever one is open. */}
      {allVideos.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Filter videos by format"
            className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
          >
            {KIND_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={kindTab === t.id}
                onClick={() => setKindTab(t.id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  kindTab === t.id
                    ? 'bg-accent text-accent-fg'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {t.id === 'short' && <Zap size={11} aria-hidden />}
                {t.label}
                {t.id === 'short' && shortCount > 0 && ` (${shortCount})`}
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Filter videos by visibility"
            className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
          >
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                aria-pressed={statusFilter === f.id}
                className={clsx(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  statusFilter === f.id
                    ? 'bg-accent text-accent-fg'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && allVideos.length === 0 ? (
        <p className="text-sm text-fg-muted">Loading videos…</p>
      ) : allVideos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Clapperboard size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">
            {oauthConnected ? 'No videos yet' : 'No services connected'}
          </p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            {oauthConnected
              ? 'Your YouTube long-form videos, and short-form from every channel, will appear here. Broadcast recordings live under Broadcasting.'
              : 'Connect Twitch or YouTube in Settings → Services to see your videos here.'}
          </p>
        </div>
      ) : videos.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {kindTab === 'short'
            ? 'No Shorts or Reels yet — YouTube Shorts, Facebook and Instagram Reels, and TikTok posts appear here.'
            : `No ${
                STATUS_FILTERS.find(
                  (f) => f.id === statusFilter,
                )?.label.toLowerCase() ?? ''
              } long-form videos on your YouTube channel.`}
        </p>
      ) : (
        // Shorts are tall, so they tile narrower — six across at full width,
        // four on medium viewports, two on the narrowest. Long form runs
        // three across on medium viewports and five at full-screen widths.
        <div
          className={clsx(
            'grid grid-cols-1 gap-4',
            kindTab === 'short'
              ? 'grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6'
              : 'sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-5',
          )}
        >
          {kindTab === 'short'
            ? shortGroups.map((g) => {
                // A short one of the tracked videos claims (by share link or
                // publish record) clicks through to that plan's page.
                const planId = g.postings
                  .map((p) => planByVideo.get(`${p.platform}|${p.id}`))
                  .find(Boolean)
                const t = planId
                  ? tracked.find((x) => x.plan.id === planId)
                  : undefined
                return (
                  <ShortCard
                    key={g.key}
                    group={g}
                    onOpen={onOpenVideo}
                    onOpenPlan={t ? () => onOpenVideoPlan(t.plan) : undefined}
                  />
                )
              })
            : videos.map((v) => (
                <VideoCard
                  key={`${v.platform}-${v.id}`}
                  video={v}
                  onOpen={() => onOpenVideo(v)}
                />
              ))}
        </div>
      )}

      <TrackedSharesModal
        tracked={tracked.find((t) => t.plan.id === sharesForId) ?? null}
        onClose={() => setSharesForId(null)}
        onSaved={(updated) =>
          setTracked((list) =>
            list.map((t) => (t.plan.id === updated.plan.id ? updated : t)),
          )
        }
      />
    </div>
  )
}

/**
 * A planned video, as the thing it is actually made of: the footage it draws
 * on, and — once the Publish tab has drafted one — the thumbnail it will go out
 * under.
 *
 * The source streams are the point. A plan called "Boss fight highlights" tells
 * you nothing about which broadcasts it cuts together, so their screenshots
 * form the card's own backdrop — every referenced thumbnail visible at once,
 * faded under the card surface — which frees the foreground for the plan's
 * metadata: sources, clips, age, tags.
 */
function PlannedVideoCard({
  plan,
  sources,
  onOpen,
}: {
  plan: main.VideoPlan
  sources: PlanSource[]
  onOpen: () => void
}) {
  const short = plan.format === 'short'
  const backdrop = sources.filter((s) => s.thumbnailUrl).slice(0, 4)
  // Three badges are enough to recognize the plan; more turns it into a list.
  const shown = sources.slice(0, 3)
  const hidden = sources.length - shown.length
  const clipCount = (plan.files ?? []).length

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:border-accent/50"
    >
      {/* The referenced footage as the card's backdrop: every source
          screenshot side by side, dimmed under a surface gradient that keeps
          the foreground readable while letting the thumbnails show. */}
      {backdrop.length > 0 && (
        <span aria-hidden className="absolute inset-0">
          <span className="absolute inset-0 flex">
            {backdrop.map((s) => (
              <img
                key={s.startedAt}
                src={s.thumbnailUrl}
                alt=""
                className="h-full w-full min-w-0 flex-1 object-cover"
              />
            ))}
          </span>
          <span className="absolute inset-0 bg-gradient-to-r from-surface via-surface/95 to-surface/70" />
          <span className="absolute inset-0 bg-gradient-to-t from-surface via-surface/60 to-surface/30" />
        </span>
      )}

      <div className="relative flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
          {plan.title}
        </p>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
          {short ? <Zap size={11} aria-hidden /> : <Film size={11} aria-hidden />}
          {short ? 'Short form' : 'Long form'}
        </span>
      </div>

      <div className="relative mt-3 flex gap-3">
        {/* The thumbnail this video will publish under, once it has one. Shaped
            to the format — a short's cover is vertical, and cropping it into a
            16:9 box would misrepresent what goes out. */}
        {plan.thumbnailUrl && (
          <img
            src={plan.thumbnailUrl}
            alt=""
            aria-hidden
            className={clsx(
              'shrink-0 rounded-md border border-edge object-cover',
              short ? 'aspect-[9/16] w-16' : 'aspect-video w-28',
            )}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {plan.description && (
            <p className="line-clamp-2 text-sm text-fg-muted">
              {plan.description}
            </p>
          )}

          {/* The footage it's cut from, as compact badges — the screenshots
              themselves are the card's backdrop. */}
          {shown.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-1.5">
              {shown.map((s) => {
                const badge = [s.season, s.episodeNumber > 0 ? `EP${s.episodeNumber}` : '']
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <li
                    key={s.startedAt}
                    className="inline-flex max-w-48 items-center gap-1.5 rounded-full border border-edge bg-bg/80 px-2 py-0.5"
                    title={`${badge ? badge + ' — ' : ''}${s.title}`}
                  >
                    {badge ? (
                      <span className="shrink-0 text-[10px] font-semibold text-accent">
                        {badge}
                      </span>
                    ) : (
                      <Radio
                        size={10}
                        aria-hidden
                        className="shrink-0 text-fg-muted"
                      />
                    )}
                    <span className="min-w-0 truncate text-xs text-fg-muted">
                      {s.title}
                    </span>
                  </li>
                )
              })}
              {hidden > 0 && (
                <li className="text-xs text-fg-muted">+{hidden} more</li>
              )}
            </ul>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <Radio size={11} aria-hidden />
              No source streams picked yet
            </p>
          )}

          {/* What the plan amounts to so far, at a glance. */}
          <p className="text-xs text-fg-muted">
            {sources.length > 0 &&
              `${sources.length} source${sources.length === 1 ? '' : 's'}`}
            {sources.length > 0 && clipCount > 0 && ' · '}
            {clipCount > 0 && `${clipCount} clip${clipCount === 1 ? '' : 's'}`}
            {(sources.length > 0 || clipCount > 0) && plan.createdAt && ' · '}
            {plan.createdAt && `planned ${formatAgo(plan.createdAt)}`}
          </p>
        </div>
      </div>

      {(plan.tags ?? []).length > 0 && (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {(plan.tags ?? []).map((t) => (
            <span
              key={t}
              className="rounded-full border border-edge bg-bg/80 px-2 py-0.5 text-xs font-medium text-fg-muted"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

/**
 * One short, however many places it was posted: a single vertical card, with a
 * tag per service carrying that service's own view count.
 *
 * The per-service tags are the point of the card. A merged total tells you the
 * short did well; the tags tell you *where* — which is the only thing you can
 * act on.
 */
function ShortCard({
  group,
  onOpen,
  onOpenPlan,
}: {
  group: ShortGroup
  onOpen: (video: main.Video) => void
  /** Open the tracked video plan this short came from, when one claims it. */
  onOpenPlan?: () => void
}) {
  const {lead, postings, totalViews} = group
  const open = onOpenPlan ?? (() => onOpen(lead))

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface">
      <button
        type="button"
        onClick={open}
        aria-label={
          onOpenPlan
            ? `Open the tracked video for ${lead.title || 'untitled short'}`
            : `Open details for ${lead.title || 'untitled short'}`
        }
        title={onOpenPlan ? 'Open the tracked video this short came from' : undefined}
        className="text-left transition-opacity hover:opacity-90"
      >
        <div className="relative">
          {lead.thumbnailUrl ? (
            <img
              src={lead.thumbnailUrl}
              alt={`${lead.title || 'Untitled short'} thumbnail`}
              className="aspect-[9/16] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[9/16] w-full items-center justify-center bg-surface-hover text-fg-muted">
              <Clapperboard size={28} aria-hidden />
            </div>
          )}
          {lead.duration && (
            <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {lead.duration}
            </span>
          )}
          {/* Posted to more than one place: say so on the thumbnail, so the
              merge is visible rather than looking like missing videos. */}
          {postings.length > 1 && (
            <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white">
              {postings.length} platforms
            </span>
          )}
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <button type="button" onClick={open} className="text-left">
          <p className="line-clamp-2 text-sm font-semibold text-fg">
            {lead.title || 'Untitled short'}
          </p>
        </button>
        <p className="text-xs text-fg-muted">
          {[
            formatDate(lead.publishedAt),
            totalViews > 0
              ? `${formatCompact(totalViews)} views total`
              : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {/* A tag per service, each with its own views. Clicking one opens that
            platform's posting, not the lead's. */}
        <ul className="mt-auto flex flex-wrap gap-1.5">
          {postings.map((p) => (
            <li key={`${p.platform}-${p.id}`}>
              <button
                type="button"
                onClick={() => onOpen(p)}
                title={
                  p.viewCount > 0
                    ? `${formatCompact(p.viewCount)} views on ${p.platform}`
                    : `Views aren’t available for this ${p.platform} posting — “—” means unknown, not zero.`
                }
                className="transition-opacity hover:opacity-80"
              >
                <PlatformPill
                  platform={p.platform}
                  label={p.viewCount > 0 ? formatCompact(p.viewCount) : '—'}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function VideoCard({
  video,
  onOpen,
}: {
  video: main.Video
  onOpen: () => void
}) {
  const meta = [
    formatDate(video.publishedAt),
    video.kind,
    video.viewCount > 0 ? `${formatCompact(video.viewCount)} views` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open details for ${video.title || 'untitled video'}`}
      className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface text-left transition-colors hover:bg-surface-hover"
    >
      <div className="relative">
        {/* Short-form is vertical; a 16:9 crop would cut the composition in
            half and misrepresent the video. */}
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={`${video.title || 'Untitled video'} thumbnail`}
            className={clsx(
              'w-full object-cover',
              video.isShort ? 'aspect-[9/16]' : 'aspect-video',
            )}
          />
        ) : (
          <div
            className={clsx(
              'flex w-full items-center justify-center bg-surface-hover text-fg-muted',
              video.isShort ? 'aspect-[9/16]' : 'aspect-video',
            )}
          >
            <Clapperboard size={28} aria-hidden />
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {video.duration}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="line-clamp-2 text-sm font-semibold text-fg">
          {video.title || 'Untitled video'}
        </p>
        {meta && <p className="mt-1 text-xs text-fg-muted">{meta}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Host channel tag. */}
          <PlatformPill
            platform={video.platform}
            label={video.channelName || undefined}
          />
          {/* Visibility badge; public is the norm, so only flag the rest. */}
          {statusOf(video) !== 'public' && (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium capitalize text-amber-600 dark:text-amber-400">
              {statusOf(video)}
            </span>
          )}
          {video.viewCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <Eye size={12} aria-hidden />
              {formatCompact(video.viewCount)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

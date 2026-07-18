import {
  ExternalLink,
  Heart,
  Film,
  RadioTower,
  RefreshCw,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState} from 'react'
import {
  GetMetricsHistory,
  GetMetricsSnapshot,
  RefreshChannelInfo,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {openExternal} from '../lib/browser'
import {formatCompact} from '../lib/format'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {SERVICES, platformName} from '../services/services'

interface DashboardProps {
  /** Open a channel's detail page. */
  onOpenChannel: (platform: string) => void
}

/** The windows the hero can measure growth over. */
const RANGES = [
  {days: 7, label: '7d'},
  {days: 30, label: '30d'},
  {days: 90, label: '90d'},
] as const

/** The metrics the hero merges, and what each one actually counts. */
type MetricKey = 'audience' | 'supporters' | 'likes' | 'content' | 'views'

const TILES: {
  key: MetricKey
  label: string
  icon: typeof Users
  /** What the number means, and — crucially — what it does not. */
  hint: string
}[] = [
  {
    key: 'audience',
    label: 'Audience',
    icon: Users,
    hint: 'Everyone who chose to follow you, across every connected channel — followers on Twitch, Kick, Facebook, Instagram, TikTok and X, and subscribers on YouTube (the same act, under YouTube’s name for it).',
  },
  {
    key: 'supporters',
    label: 'Supporters',
    icon: Star,
    hint: 'Paying subscribers. Only Twitch exposes these, so this is a real number rather than a padded one.',
  },
  {
    key: 'likes',
    label: 'Likes',
    icon: Heart,
    hint: 'Facebook page likes and TikTok’s lifetime like count. Platforms that don’t report likes contribute nothing rather than a guess.',
  },
  {
    key: 'content',
    label: 'Content',
    icon: Film,
    hint: 'Everything published: YouTube videos, Instagram posts, TikTok videos and X posts.',
  },
  {
    key: 'views',
    label: 'Views',
    icon: TrendingUp,
    hint: 'YouTube’s lifetime channel views, plus TikTok’s views summed across its videos (TikTok publishes no lifetime total, so it is added up from the video list).',
  },
]

/**
 * The Dashboard: the brand as one number, then each channel on its own terms.
 *
 * The hero merges the audience across every connected platform — the figure
 * nobody can read off seven separate cards — and shows how far it has moved
 * over the chosen window. Beneath it, each connected channel gets its own
 * card with its live state and key numbers; clicking one opens the channel's
 * full details page.
 *
 * Growth can only be shown for days that were actually recorded (see
 * metrics.go); the app never back-fills a past it didn't observe, so a fresh
 * install says so rather than drawing a flat line from nothing.
 */
export function Dashboard({onOpenChannel}: DashboardProps) {
  const [range, setRange] = useState<number>(30)
  const [snap, setSnap] = useState<main.MetricsSnapshot | null>(null)
  const [history, setHistory] = useState<main.MetricsDay[]>([])
  const [metric, setMetric] = useState<MetricKey>('audience')
  const [refreshing, setRefreshing] = useState(false)

  const {platforms, obs, refreshPlatforms} = useLiveData()
  const {anyLive} = aggregateLive(platforms, obs)

  const load = useCallback((days: number) => {
    GetMetricsSnapshot(days)
      .then(setSnap)
      .catch(() => {})
    GetMetricsHistory(days)
      .then((h) => setHistory(h ?? []))
      .catch(() => {})
  }, [])

  // The hero reads its numbers out of the channel caches that the platform
  // poll fills. On a cold start those caches are empty, so a read on mount
  // alone comes back with nothing — and the producer would have to press
  // Refresh to see their own figures. Re-reading when the poll lands (and
  // whenever a channel is added, removed, or starts reporting) keeps the hero
  // filling itself in.
  //
  // The signature deliberately ignores the volatile fields (viewer counts,
  // live flags): those change on every poll, and re-querying the metrics every
  // few seconds would be pure churn for numbers that move once an hour.
  const channelSignature = (platforms ?? [])
    .map((p) => `${p.platform}:${p.channelName}:${p.error}`)
    .join('|')

  useEffect(() => {
    load(range)
  }, [load, range, channelSignature])

  // Channel numbers come from the 1-hour cache; this drops it, re-polls, and
  // re-reads the metrics that are derived from it.
  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await RefreshChannelInfo()
      refreshPlatforms()
      load(range)
    } finally {
      window.setTimeout(() => setRefreshing(false), 1_000)
    }
  }

  const totals = snap?.totals
  const growth = snap?.growth
  const hasHistory = Boolean(snap?.hasHistory)
  // A tile with nothing behind it is noise; drop it rather than parade a zero.
  const tiles = TILES.filter((t) => (totals?.[t.key] ?? 0) > 0)

  return (
    <div className="flex flex-col gap-8">
      {/* ---------------------------------------------------------------
          The hero: the whole brand, merged.
          --------------------------------------------------------------- */}
      <section
        aria-label="Brand at a glance"
        className="relative overflow-hidden rounded-2xl bg-hero p-8 text-hero-fg"
      >
        <RadioTower
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-6 opacity-10"
          size={180}
          strokeWidth={1.5}
        />
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
                Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                {anyLive ? 'You are on the air' : 'Your brand at a glance'}
              </h1>
              <p className="mt-2 text-sm opacity-90">
                Every connected channel, merged into one set of numbers — and
                how they have moved.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* The growth window. */}
              <div className="flex items-center gap-0.5 rounded-full bg-hero-fg/10 p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    type="button"
                    onClick={() => setRange(r.days)}
                    aria-pressed={range === r.days}
                    className={clsx(
                      'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
                      range === r.days
                        ? 'bg-hero-fg text-hero'
                        : 'hover:bg-hero-fg/20',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void onRefresh()}
                disabled={refreshing}
                title="Fetch the latest stats from the platforms"
                className="inline-flex items-center gap-1.5 rounded-full bg-hero-fg/10 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-hero-fg/20 disabled:opacity-50"
              >
                <RefreshCw
                  size={12}
                  aria-hidden
                  className={clsx(refreshing && 'animate-spin')}
                />
                Refresh
              </button>
            </div>
          </div>

          {/* The merged totals. Until the first read lands, say nothing rather
              than "no channels" — the numbers are on their way, and announcing
              their absence is a conclusion the app hasn't earned yet. */}
          {snap === null ? (
            <p className="text-sm opacity-80">Reading your channels…</p>
          ) : tiles.length === 0 ? (
            <p className="text-sm opacity-90">
              No channel numbers yet — connect a platform in Settings →
              Services, and its audience appears here.
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {tiles.map((t) => {
                  const value = totals?.[t.key] ?? 0
                  const delta = growth?.[t.key] ?? 0
                  const selected = metric === t.key
                  return (
                    <li key={t.key}>
                      <button
                        type="button"
                        onClick={() => setMetric(t.key)}
                        aria-pressed={selected}
                        title={t.hint}
                        className={clsx(
                          'flex w-full flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                          selected
                            ? 'border-hero-fg/40 bg-hero-fg/15'
                            : 'border-hero-fg/10 bg-hero-fg/5 hover:bg-hero-fg/10',
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium opacity-80">
                          <t.icon size={12} aria-hidden />
                          {t.label}
                        </span>
                        <span className="text-2xl font-semibold tracking-tight">
                          {formatCompact(value)}
                        </span>
                        {/* Growth is only claimed when there is history to
                            claim it from — a fresh install must not show a
                            confident "0", which reads as "no growth" rather
                            than "no data yet". */}
                        {hasHistory ? (
                          <span
                            className={clsx(
                              'text-xs font-medium',
                              delta > 0
                                ? 'opacity-100'
                                : delta < 0
                                  ? 'opacity-90'
                                  : 'opacity-60',
                            )}
                          >
                            {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                            {formatCompact(Math.abs(delta))} in {range}d
                          </span>
                        ) : (
                          <span className="text-xs opacity-60">
                            tracking from today
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>

              <GrowthChart
                history={history}
                metric={metric}
                label={TILES.find((t) => t.key === metric)?.label ?? ''}
              />
            </>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------
          The channels, one card each.
          --------------------------------------------------------------- */}
      <ChannelCards
        platforms={platforms}
        breakdown={snap?.platforms ?? []}
        growth={snap?.platformGrowth ?? []}
        onOpenChannel={onOpenChannel}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Growth chart
//
// Hand-rolled SVG: the project carries no chart library, and one line does not
// justify adding one. Only recorded days are plotted — the line joins what was
// actually observed rather than interpolating a past that was never seen.
// ---------------------------------------------------------------------------

function GrowthChart({
  history,
  metric,
  label,
}: {
  history: main.MetricsDay[]
  metric: MetricKey
  label: string
}) {
  const points = history
    .map((d) => ({day: d.day, value: d[metric] ?? 0}))
    .filter((p) => p.value > 0)

  if (points.length < 2) {
    return (
      <div className="rounded-xl border border-hero-fg/10 bg-hero-fg/5 p-4">
        <p className="text-xs opacity-80">
          {points.length === 0
            ? `No ${label.toLowerCase()} recorded yet.`
            : `${label} is being recorded daily — the growth line appears once there are two days to draw between.`}
        </p>
      </div>
    )
  }

  const W = 1000
  const H = 160
  const PAD = 8

  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat line would divide by zero; give it a band so it draws mid-height.
  const span = max - min || Math.max(1, max * 0.02)

  const x = (i: number) =>
    points.length === 1 ? W / 2 : (i / (points.length - 1)) * W
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)

  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  const area = `${x(0)},${H} ${line} ${x(points.length - 1)},${H}`

  const first = points[0]
  const last = points[points.length - 1]
  const delta = last.value - first.value

  return (
    <figure className="rounded-xl border border-hero-fg/10 bg-hero-fg/5 p-4">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold">{label} over time</span>
        <span className="opacity-80">
          {formatCompact(first.value)} → {formatCompact(last.value)}
          {delta !== 0 && (
            <>
              {' '}
              ({delta > 0 ? '+' : '−'}
              {formatCompact(Math.abs(delta))})
            </>
          )}
          {' · '}
          {points.length} day{points.length === 1 ? '' : 's'} recorded
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} from ${formatCompact(first.value)} on ${first.day} to ${formatCompact(last.value)} on ${last.day}`}
        className="h-32 w-full overflow-visible"
      >
        <polygon points={area} fill="currentColor" opacity={0.12} />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* The latest reading, marked. */}
        <circle
          cx={x(points.length - 1)}
          cy={y(last.value)}
          r={4}
          fill="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] opacity-70">
        <span>{first.day}</span>
        <span>{last.day}</span>
      </div>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Channel cards
//
// One compact card per connected channel, led by the service's logo, with the
// channel's key numbers and how far each has moved over the chosen window.
// The whole card is the click target; it opens the channel's full details
// page, where the platform's self-reported details live.
// ---------------------------------------------------------------------------

function ChannelCards({
  platforms,
  breakdown,
  growth,
  onOpenChannel,
}: {
  platforms: main.LiveStream[]
  breakdown: main.ChannelMetrics[]
  growth: main.ChannelMetrics[]
  onOpenChannel: (platform: string) => void
}) {
  const channels = platforms ?? []

  if (channels.length === 0) {
    return (
      <section aria-label="Channels">
        <p className="rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center text-sm text-fg-muted">
          No channels connected — add one in Settings → Services.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Channels">
      {/* Scale with the viewport: 3 across on medium layouts, 5 across on
          wide/full-size ones. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {channels.map((c) => {
          const def = SERVICES.find((s) => s.id === c.platform)
          const Icon = def?.Icon
          const metrics = breakdown.find((m) => m.platform === c.platform)
          const delta = growth.find((m) => m.platform === c.platform)
          const stats = metrics
            ? TILES.filter((t) => (metrics[t.key] ?? 0) > 0)
            : []
          return (
            <li key={c.platform}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpenChannel(c.platform)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenChannel(c.platform)
                  }
                }}
                aria-label={`Open ${c.channelName || platformName(c.platform)} details`}
                className="flex h-full cursor-pointer flex-col gap-2.5 rounded-xl border border-edge bg-surface p-3 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
              >
                <header className="flex items-center gap-2.5">
                  {Icon && (
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{backgroundColor: def?.brand}}
                    >
                      <Icon size={18} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      {c.channelName || platformName(c.platform)}
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                      {platformName(c.platform)}
                      {c.live &&
                        c.viewerCount > 0 &&
                        ` · ${formatCompact(c.viewerCount)} watching`}
                    </p>
                  </div>
                  {c.live && (
                    <span
                      aria-label="live"
                      title="Live now"
                      className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500"
                    />
                  )}
                  {c.channelUrl && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openExternal(c.channelUrl)
                      }}
                      title={`Visit ${platformName(c.platform)}`}
                      aria-label={`Visit ${platformName(c.platform)} in the browser`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <ExternalLink size={13} aria-hidden />
                    </button>
                  )}
                </header>

                {c.error ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {c.error}
                  </p>
                ) : (
                  stats.length > 0 && (
                    <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1">
                      {stats.map((t) => (
                        <li
                          key={t.key}
                          title={t.label}
                          className="flex items-baseline gap-1 text-sm"
                        >
                          <t.icon
                            size={12}
                            aria-hidden
                            className="self-center text-fg-muted"
                          />
                          <span className="font-semibold text-fg">
                            {formatCompact(metrics?.[t.key] ?? 0)}
                          </span>
                          <GrowthDelta value={delta?.[t.key] ?? 0} />
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A stat's movement over the window: green up, red down, silent at zero. */
function GrowthDelta({value}: {value: number}) {
  if (!value) return null
  return (
    <span
      className={clsx(
        'text-xs font-medium',
        value > 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400',
      )}
    >
      {value > 0 ? '+' : '−'}
      {formatCompact(Math.abs(value))}
    </span>
  )
}

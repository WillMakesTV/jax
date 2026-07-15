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
import {PlatformPill} from '../components/PlatformPill'
import {openExternal} from '../lib/browser'
import {formatCompact} from '../lib/format'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {LiveBadge, StatusPill} from '../live/LiveOverview'
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
 * over the chosen window. Beneath it, the connected channels become tabs: one
 * platform at a time, with its live state and its own numbers.
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
          The channels, one tab at a time.
          --------------------------------------------------------------- */}
      <ChannelTabs
        platforms={platforms}
        breakdown={snap?.platforms ?? []}
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
// Channel tabs
// ---------------------------------------------------------------------------

function ChannelTabs({
  platforms,
  breakdown,
  onOpenChannel,
}: {
  platforms: main.LiveStream[]
  breakdown: main.ChannelMetrics[]
  onOpenChannel: (platform: string) => void
}) {
  const [active, setActive] = useState('')
  const channels = platforms ?? []

  // Land on the live channel if there is one, else the first.
  const current =
    channels.find((c) => c.platform === active) ??
    channels.find((c) => c.live) ??
    channels[0]

  if (channels.length === 0) {
    return (
      <section aria-label="Channels">
        <p className="rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center text-sm text-fg-muted">
          No channels connected — add one in Settings → Services.
        </p>
      </section>
    )
  }

  const metrics = breakdown.find((m) => m.platform === current?.platform)

  return (
    <section aria-label="Channels" className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Connected channels"
        className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg border border-edge bg-surface p-1"
      >
        {channels.map((c) => {
          const selected = c.platform === current?.platform
          const def = SERVICES.find((s) => s.id === c.platform)
          const Icon = def?.Icon
          return (
            <button
              key={c.platform}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(c.platform)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md py-1.5 pl-1.5 pr-3 text-sm font-medium transition-colors',
                selected
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {Icon && (
                // The logo keeps its brand colour on both states — a Twitch
                // purple that turns accent-coloured when selected stops being
                // a logo and starts being decoration.
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
                  style={{backgroundColor: def?.brand}}
                >
                  <Icon size={12} />
                </span>
              )}
              {platformName(c.platform)}
              {c.live && (
                <span
                  aria-label="live"
                  className="h-1.5 w-1.5 rounded-full bg-red-500"
                />
              )}
            </button>
          )
        })}
      </div>

      {current && (
        <article className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {current.avatarUrl && (
                <img
                  src={current.avatarUrl}
                  alt=""
                  aria-hidden
                  className="h-11 w-11 shrink-0 rounded-full border border-edge object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">
                  {current.channelName || platformName(current.platform)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <PlatformPill platform={current.platform} />
                  <StatusPill live={current.live} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {current.channelUrl && (
                <button
                  type="button"
                  onClick={() => openExternal(current.channelUrl)}
                  className="inline-flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
                >
                  <ExternalLink size={12} aria-hidden />
                  Visit
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenChannel(current.platform)}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                Open channel
              </button>
            </div>
          </header>

          {current.error ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              {current.error}
            </p>
          ) : (
            <>
              {/* Live now: what is on the air. */}
              {current.live && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-edge bg-bg p-3">
                  <div className="flex items-center gap-2">
                    <LiveBadge isLive />
                    {current.viewerCount > 0 && (
                      <span className="text-xs text-fg-muted">
                        {formatCompact(current.viewerCount)} watching
                      </span>
                    )}
                  </div>
                  {current.title && (
                    <p className="text-sm font-medium text-fg">
                      {current.title}
                    </p>
                  )}
                  {current.category && (
                    <p className="text-xs text-fg-muted">{current.category}</p>
                  )}
                </div>
              )}

              {/* This channel's contribution to the totals above. */}
              {metrics && (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {TILES.filter(
                    (t) => (metrics[t.key] ?? 0) > 0,
                  ).map((t) => (
                    <li
                      key={t.key}
                      className="rounded-lg border border-edge bg-bg p-3"
                    >
                      <p className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                        <t.icon size={12} aria-hidden />
                        {t.label}
                      </p>
                      <p className="mt-0.5 text-lg font-semibold text-fg">
                        {formatCompact(metrics[t.key] ?? 0)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {/* Whatever else the platform reports about itself. */}
              {(current.details ?? []).length > 0 && (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {(current.details ?? []).map((d) => (
                    <div
                      key={d.label}
                      className="flex items-baseline justify-between gap-3 border-b border-edge py-1.5 last:border-0"
                    >
                      <dt className="text-xs text-fg-muted">{d.label}</dt>
                      <dd className="truncate text-xs font-medium text-fg">
                        {d.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </article>
      )}
    </section>
  )
}

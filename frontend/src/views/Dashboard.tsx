import {RadioTower, RefreshCw} from 'lucide-react'
import clsx from 'clsx'
import {useState} from 'react'
import {RefreshChannelInfo} from '../../wailsjs/go/main/App'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {LiveOverview} from '../live/LiveOverview'

interface DashboardProps {
  /** Open a channel's detail page (from a hero channel card). */
  onOpenChannel: (platform: string) => void
}

/**
 * The Dashboard: live broadcast metrics and channel analytics (the hero).
 * Past streams and streaming tooling live in the Broadcast section.
 */
export function Dashboard({onOpenChannel}: DashboardProps) {
  return (
    <div className="flex flex-col gap-8">
      <Hero onOpenChannel={onOpenChannel} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero: the live-broadcast panel (summary tiles + channel/encoder cards).
// ---------------------------------------------------------------------------

function Hero({onOpenChannel}: {onOpenChannel: (platform: string) => void}) {
  const {platforms, obs, refreshPlatforms} = useLiveData()
  const {anyLive} = aggregateLive(platforms, obs)
  const [refreshing, setRefreshing] = useState(false)

  // Channel numbers come from the 1-hour cache; this drops it and re-polls.
  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await RefreshChannelInfo()
      refreshPlatforms()
    } finally {
      window.setTimeout(() => setRefreshing(false), 1_000)
    }
  }

  return (
    <section
      aria-label="Live stream"
      className="relative overflow-hidden rounded-2xl bg-accent p-8 text-accent-fg"
    >
      {/* Decorative watermark. */}
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
              {anyLive ? 'You are on the air' : 'Your channels at a glance'}
            </h1>
            <p className="mt-2 text-sm opacity-90">
              Live metrics, channel analytics, and your streaming history —
              updated in real time while you broadcast.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={refreshing}
            title="Fetch the latest stats from the platforms"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-fg/10 px-3 py-1 text-xs font-semibold transition-colors hover:bg-accent-fg/20 disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              aria-hidden
              className={clsx(refreshing && 'animate-spin')}
            />
            Refresh
          </button>
        </div>

        <LiveOverview onOpenChannel={onOpenChannel} />
      </div>
    </section>
  )
}

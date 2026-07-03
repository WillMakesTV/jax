import {RadioTower} from 'lucide-react'
import clsx from 'clsx'
import {ChatPanel} from '../chat/ChatPanel'
import {useChat} from '../chat/ChatProvider'
import {EventsPanel} from '../events/EventsPanel'
import {useEvents} from '../events/EventsProvider'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {LiveBadge, LiveOverview} from '../live/LiveOverview'
import {ObsPanel} from '../obs/ObsPanel'
import {TranscriptPanel} from '../transcript/TranscriptPanel'

/** The Live Dashboard's tabs. App owns the state so the status bar can deep-link. */
export type DashboardTab = 'overview' | 'chat' | 'events' | 'transcript' | 'obs'

interface DashboardProps {
  tab: DashboardTab
  onTabChange: (tab: DashboardTab) => void
}

/**
 * The Live Dashboard: everything about the current broadcast, split into tabs
 * — the hero-wrapped live overview, the aggregated live chat, live channel
 * events, and OBS Studio (connection info + program preview).
 */
export function Dashboard({tab, onTabChange}: DashboardProps) {
  const {unreadCount: unreadChat} = useChat()
  const {unreadCount: unreadEvents} = useEvents()

  // Chat, events, and the transcript are feeds that fill the viewport;
  // overview and OBS flow and scroll naturally.
  const fills = tab === 'chat' || tab === 'events' || tab === 'transcript'

  const tabs: {id: DashboardTab; label: string; badge?: number}[] = [
    {id: 'overview', label: 'Overview'},
    {id: 'chat', label: 'Chat', badge: unreadChat},
    {id: 'events', label: 'Events', badge: unreadEvents},
    {id: 'transcript', label: 'Transcript'},
    {id: 'obs', label: 'OBS Studio'},
  ]

  return (
    <div className={clsx('flex flex-col gap-6', fills && 'h-full')}>
      <div
        role="tablist"
        aria-label="Live Dashboard sections"
        className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTabChange(t.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-accent text-accent-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            {t.label}
            {Boolean(t.badge) && (
              <span
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  tab === t.id
                    ? 'bg-accent-fg/20 text-accent-fg'
                    : 'bg-accent text-accent-fg',
                )}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Hero />}
      {tab === 'chat' && <ChatPanel />}
      {tab === 'events' && <EventsPanel />}
      {tab === 'transcript' && <TranscriptPanel />}
      {tab === 'obs' && <ObsPanel />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview: hero wrapping the live-broadcast panel so the whole thing reads
// as one "what's happening right now" surface.
// ---------------------------------------------------------------------------

function Hero() {
  const {platforms, obs} = useLiveData()
  const {anyLive} = aggregateLive(platforms, obs)

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
              {anyLive ? 'Live Dashboard' : 'Dashboard'}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {anyLive ? 'You are on the air' : 'Your broadcast at a glance'}
            </h1>
            <p className="mt-2 text-sm opacity-90">
              Everything about the current live stream — viewers, channels, and
              encoder health — updated in real time.
            </p>
          </div>
          <LiveBadge isLive={anyLive} />
        </div>

        <LiveOverview />
      </div>
    </section>
  )
}

import clsx from 'clsx'
import {ChatPanel} from '../chat/ChatPanel'
import {useChat} from '../chat/ChatProvider'
import {EventsPanel} from '../events/EventsPanel'
import {useEvents} from '../events/EventsProvider'
import {GoLiveButton} from '../components/GoLiveButton'
import {PlannedGoLive} from '../live/PlannedGoLive'
import {TranscriptPanel} from '../transcript/TranscriptPanel'
import {main} from '../../wailsjs/go/models'
import {LiveDashboard} from './LiveDashboard'

/** The Broadcast section's tabs. App owns the state so the status bar can deep-link. */
export type LiveStreamTab = 'dashboard' | 'chat' | 'events' | 'transcript'

interface LiveStreamProps {
  tab: LiveStreamTab
  onTabChange: (tab: LiveStreamTab) => void
  /** Open the OBS Studio section. */
  onOpenObs: () => void
  /** Open a stream plan's broadcast page. */
  onOpenPlan: (plan: main.PlannedStream) => void
}

/**
 * The Broadcast section: a live Dashboard (OBS preview, primary sources, and
 * notifications), the aggregated chat, live channel events, and the
 * transcript. Planning and OBS Studio are their own top-level sections.
 */
export function LiveStream({tab, onTabChange, onOpenObs, onOpenPlan}: LiveStreamProps) {
  const {unreadCount: unreadChat} = useChat()
  const {unreadCount: unreadEvents} = useEvents()

  // Chat, events, and the transcript fill the viewport and scroll internally;
  // the dashboard flows and scrolls with the page.
  const fills = tab === 'chat' || tab === 'events' || tab === 'transcript'

  const tabs: {id: LiveStreamTab; label: string; badge?: number}[] = [
    {id: 'dashboard', label: 'Dashboard'},
    {id: 'chat', label: 'Chat', badge: unreadChat},
    {id: 'events', label: 'Events', badge: unreadEvents},
    {id: 'transcript', label: 'Transcript'},
  ]

  return (
    <div className={clsx('flex flex-col gap-6', fills && 'h-full')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Live Stream sections"
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
        <GoLiveButton />
      </div>

      {tab === 'dashboard' && (
        <>
          <PlannedGoLive onOpenPlan={onOpenPlan} />
          <LiveDashboard
            onOpenObs={onOpenObs}
            onOpenChat={() => onTabChange('chat')}
            onOpenEvents={() => onTabChange('events')}
          />
        </>
      )}
      {tab === 'chat' && <ChatPanel />}
      {tab === 'events' && <EventsPanel />}
      {tab === 'transcript' && <TranscriptPanel />}
    </div>
  )
}

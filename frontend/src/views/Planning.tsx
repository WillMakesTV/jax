import clsx from 'clsx'
import {main} from '../../wailsjs/go/models'
import {ChatPanel} from '../chat/ChatPanel'
import {useChat} from '../chat/ChatProvider'
import {EventsPanel} from '../events/EventsPanel'
import {useEvents} from '../events/EventsProvider'
import {GoLiveButton} from '../components/GoLiveButton'
import {TranscriptPanel} from '../transcript/TranscriptPanel'
import {BroadcastNotifications} from './BroadcastNotifications'
import {ContentSeriesPanel} from './ContentSeries'
import {PastStreamsSection, PlanningSection} from './Streams'

/** The Broadcasting section's tabs. App owns the state so the status bar can
 *  deep-link (chat/events chips) and history restores the tab. */
export type PlanningTab =
  'dashboard' | 'chat' | 'events' | 'transcript' | 'series'

interface PlanningProps {
  tab: PlanningTab
  onTabChange: (tab: PlanningTab) => void
  /** Open the details view for an aggregated past stream. */
  onOpenStream: (stream: main.PastStream) => void
  /** Open the details view for the current live stream. */
  onOpenLive: () => void
  /** Open the "Plan a stream" form. */
  onPlanStream: () => void
  /** Open a plan's broadcast page (Go Live / Update Stream Info / Conclude /
   *  Edit). Stream-planning cards open here — the dashboard's one plan list. */
  onOpenBroadcast: (plan: main.PlannedStream) => void
  /** Open the series editor page (null = create a new series). */
  onEditSeries: (series: main.ContentSeries | null) => void
  /** Open the "Plan a video" form (short- or long-form video plan). */
  onPlanVideo: () => void
}

/**
 * The Broadcasting section — planning and the live broadcast in one place.
 * The header carries the tabs with the unread-notification chips inline
 * beside them. Dashboard: one stream-planning list (whose cards open a
 * plan's broadcast page to go live / update info / conclude / edit), then
 * past streams. Chat, Events, and Transcript follow the broadcast; Content
 * Series holds the reusable context for recurring shows. Going live also
 * lives in the header; OBS Studio has the top bar's CTA.
 */
export function Planning({
  tab,
  onTabChange,
  onOpenStream,
  onOpenLive,
  onPlanStream,
  onOpenBroadcast,
  onEditSeries,
  onPlanVideo,
}: PlanningProps) {
  const {unreadCount: unreadChat} = useChat()
  const {unreadCount: unreadEvents} = useEvents()

  // Chat, events, and the transcript fill the viewport and scroll internally;
  // the dashboard and series tabs flow and scroll with the page.
  const fills = tab === 'chat' || tab === 'events' || tab === 'transcript'

  const tabs: {id: PlanningTab; label: string; badge?: number}[] = [
    {id: 'dashboard', label: 'Dashboard'},
    {id: 'chat', label: 'Chat', badge: unreadChat},
    {id: 'events', label: 'Events', badge: unreadEvents},
    {id: 'transcript', label: 'Transcript'},
    {id: 'series', label: 'Content Series'},
  ]

  return (
    <div className={clsx('flex flex-col gap-6', fills && 'h-full')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Broadcasting sections"
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
          <BroadcastNotifications
            onOpenChat={() => onTabChange('chat')}
            onOpenEvents={() => onTabChange('events')}
          />
        </div>
        <GoLiveButton />
      </div>

      {tab === 'dashboard' && (
        <div className="flex flex-col gap-8">
          <PlanningSection
            onPlanStream={onPlanStream}
            onOpenPlan={onOpenBroadcast}
          />
          <PastStreamsSection
            onOpenStream={onOpenStream}
            onOpenLive={onOpenLive}
            onPlanVideo={onPlanVideo}
            showSummary
          />
        </div>
      )}
      {tab === 'chat' && <ChatPanel />}
      {tab === 'events' && <EventsPanel />}
      {tab === 'transcript' && <TranscriptPanel />}
      {tab === 'series' && <ContentSeriesPanel onEditSeries={onEditSeries} />}
    </div>
  )
}

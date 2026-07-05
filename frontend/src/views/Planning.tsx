import clsx from 'clsx'
import {main} from '../../wailsjs/go/models'
import {ContentSeriesPanel} from './ContentSeries'
import {PastStreamsSection, PlanningSection} from './Streams'

export type PlanningTab = 'dashboard' | 'series'

interface PlanningProps {
  /** The active tab; lives in the app's navigation history so returning from
   *  a sub-page (e.g. the series editor) restores the tab. */
  tab: PlanningTab
  onTabChange: (tab: PlanningTab) => void
  /** Open the details view for an aggregated past stream. */
  onOpenStream: (stream: main.PastStream) => void
  /** Open the details view for the current live stream. */
  onOpenLive: () => void
  /** Open the "Plan a stream" form. */
  onPlanStream: () => void
  /** Open the series editor page (null = create a new series). */
  onEditSeries: (series: main.ContentSeries | null) => void
}

/**
 * The Planning section: a Dashboard tab (stream planning + past streams) and a
 * Content Series tab (reusable context for recurring shows).
 */
export function Planning({
  tab,
  onTabChange,
  onOpenStream,
  onOpenLive,
  onPlanStream,
  onEditSeries,
}: PlanningProps) {
  const tabs: {id: PlanningTab; label: string}[] = [
    {id: 'dashboard', label: 'Dashboard'},
    {id: 'series', label: 'Content Series'},
  ]

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="Planning sections"
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
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-accent text-accent-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div className="flex flex-col gap-8">
          <PlanningSection onPlanStream={onPlanStream} />
          <PastStreamsSection
            onOpenStream={onOpenStream}
            onOpenLive={onOpenLive}
            showSummary
          />
        </div>
      )}
      {tab === 'series' && <ContentSeriesPanel onEditSeries={onEditSeries} />}
    </div>
  )
}

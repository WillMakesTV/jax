import clsx from 'clsx'
import {useState} from 'react'
import {main} from '../../wailsjs/go/models'
import {ContentSeriesPanel} from './ContentSeries'
import {PastStreamsSection, PlanningSection} from './Streams'

type PlanningTab = 'dashboard' | 'series'

interface PlanningProps {
  /** Open the details view for an aggregated past stream. */
  onOpenStream: (stream: main.PastStream) => void
  /** Open the details view for the current live stream. */
  onOpenLive: () => void
  /** Open the "Plan a stream" form. */
  onPlanStream: () => void
}

/**
 * The Planning section: a Dashboard tab (stream planning + past streams) and a
 * Content Series tab (reusable context for recurring shows).
 */
export function Planning({
  onOpenStream,
  onOpenLive,
  onPlanStream,
}: PlanningProps) {
  const [tab, setTab] = useState<PlanningTab>('dashboard')

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
            onClick={() => setTab(t.id)}
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
      {tab === 'series' && <ContentSeriesPanel />}
    </div>
  )
}

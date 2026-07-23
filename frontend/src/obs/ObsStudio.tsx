import clsx from 'clsx'
import {main} from '../../wailsjs/go/models'
import {ObsPanel} from './ObsPanel'
import {RoutinesPanel} from './RoutinesPanel'
import {StreamWidgetsPanel} from './StreamWidgetsPanel'
import {SystemWidgetsPanel} from './SystemWidgetsPanel'

export type ObsTab =
  'dashboard' | 'routines' | 'system-widgets' | 'custom-widgets'

/**
 * The OBS Studio section: its main dashboard (preview, scenes, sources,
 * controls) plus Routines and Smart Sources sections. The active tab lives in
 * the app's navigation state so detail routes (e.g. the routine form) can
 * return to the tab they came from.
 */
export function ObsStudio({
  tab,
  onTabChange,
  onEditRoutine,
  onOpenWidget,
  onOpenSystemWidget,
}: {
  tab: ObsTab
  onTabChange: (tab: ObsTab) => void
  /** Open the routine add/edit page; null creates a new routine. */
  onEditRoutine: (routine: main.Routine | null) => void
  /** Open a stream widget's configuration page. */
  onOpenWidget: (widget: main.StreamWidget) => void
  /** Open a system widget's display page. */
  onOpenSystemWidget: (widget: main.SystemWidget) => void
}) {
  const tabs: {id: ObsTab; label: string}[] = [
    {id: 'dashboard', label: 'Dashboard'},
    {id: 'routines', label: 'Routines'},
    {id: 'system-widgets', label: 'System Widgets'},
    {id: 'custom-widgets', label: 'Custom Widgets'},
  ]

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label="OBS Studio sections"
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

      {tab === 'dashboard' && <ObsPanel />}
      {tab === 'routines' && <RoutinesPanel onEditRoutine={onEditRoutine} />}
      {tab === 'system-widgets' && (
        <SystemWidgetsPanel onOpenSystemWidget={onOpenSystemWidget} />
      )}
      {tab === 'custom-widgets' && (
        <StreamWidgetsPanel onOpenWidget={onOpenWidget} />
      )}
    </div>
  )
}

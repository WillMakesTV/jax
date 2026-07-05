import {Workflow, type LucideIcon} from 'lucide-react'
import clsx from 'clsx'
import {useState} from 'react'
import {ObsPanel} from './ObsPanel'
import {SmartSourcesPanel} from './SmartSourcesPanel'

type ObsTab = 'dashboard' | 'routines' | 'smart-sources'

/**
 * The OBS Studio section: its main dashboard (preview, scenes, sources,
 * controls) plus Routines and Smart Sources sections.
 */
export function ObsStudio() {
  const [tab, setTab] = useState<ObsTab>('dashboard')

  const tabs: {id: ObsTab; label: string}[] = [
    {id: 'dashboard', label: 'Dashboard'},
    {id: 'routines', label: 'Routines'},
    {id: 'smart-sources', label: 'Smart Sources'},
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

      {tab === 'dashboard' && <ObsPanel />}
      {tab === 'routines' && (
        <ComingSoon
          icon={Workflow}
          title="Routines"
          description="Automate your broadcast: trigger scene switches, source toggles, and other actions on a schedule or in response to events."
        />
      )}
      {tab === 'smart-sources' && <SmartSourcesPanel />}
    </div>
  )
}

function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-surface px-6 py-16 text-center">
      <span
        aria-hidden
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-hover text-fg-muted"
      >
        <Icon size={24} />
      </span>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
          Soon
        </span>
      </div>
      <p className="mt-2 max-w-md text-sm text-fg-muted">{description}</p>
    </div>
  )
}

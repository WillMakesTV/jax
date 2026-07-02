import clsx from 'clsx'
import {useState} from 'react'
import {PageHeader} from '../components/PageHeader'
import {PreferencesTab} from './settings/PreferencesTab'
import {ServicesTab} from './settings/ServicesTab'

type TabId = 'preferences' | 'services'

const TABS: {id: TabId; label: string}[] = [
  {id: 'preferences', label: 'Preferences'},
  {id: 'services', label: 'Services'},
]

export function Settings() {
  const [tab, setTab] = useState<TabId>('preferences')

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Settings"
        description="Configure how Jax looks and connects."
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="mb-6 flex gap-1 border-b border-edge"
      >
        {TABS.map((t) => {
          const selected = tab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={clsx(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                selected
                  ? 'border-accent text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="flex-1"
      >
        {tab === 'preferences' && <PreferencesTab />}
        {tab === 'services' && <ServicesTab />}
      </div>
    </div>
  )
}

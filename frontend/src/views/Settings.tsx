import clsx from 'clsx'
import {useState} from 'react'
import {PageHeader} from '../components/PageHeader'
import {AboutTab} from './settings/AboutTab'
import {AiTab} from './settings/AiTab'
import {DevelopmentTab} from './settings/DevelopmentTab'
import {PreferencesTab} from './settings/PreferencesTab'
import {ServicesTab} from './settings/ServicesTab'
import {SkillsTab} from './settings/SkillsTab'
import {StreamsTab} from './settings/StreamsTab'
import {VideosTab} from './settings/VideosTab'

export type SettingsTab =
  | 'preferences'
  | 'services'
  | 'ai'
  | 'skills'
  | 'streams'
  | 'videos'
  | 'development'
  | 'about'

type TabId = SettingsTab

const TABS: {id: TabId; label: string}[] = [
  {id: 'preferences', label: 'Preferences'},
  {id: 'services', label: 'Services'},
  {id: 'ai', label: 'AI'},
  {id: 'skills', label: 'Skills'},
  {id: 'streams', label: 'Streams'},
  {id: 'videos', label: 'Videos'},
  {id: 'development', label: 'Development'},
  {id: 'about', label: 'About'},
]

export function Settings({initialTab}: {initialTab?: SettingsTab}) {
  const [tab, setTab] = useState<TabId>(initialTab ?? 'preferences')

  return (
    <div className="flex h-full flex-col">
      <PageHeader description="Configure how Jax looks and connects." />

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
        {tab === 'ai' && <AiTab />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'streams' && <StreamsTab />}
        {tab === 'videos' && <VideosTab />}
        {tab === 'development' && <DevelopmentTab />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  )
}

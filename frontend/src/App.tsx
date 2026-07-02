import {useEffect, useState} from 'react'
import {Sidebar} from './components/Sidebar'
import {StatusBar} from './components/StatusBar'
import {TopBar} from './components/TopBar'
import {SETTING_KEYS, loadSetting, saveSetting} from './lib/settings'
import type {ViewId} from './navigation'
import {Dashboard} from './views/Dashboard'
import {Streams} from './views/Streams'
import {Videos} from './views/Videos'
import {Settings} from './views/Settings'
import {Profile} from './views/Profile'

// localStorage mirror of the nav-collapsed flag. SQLite is the source of truth,
// but the cached value gives the sidebar its correct width on first paint before
// the async backend read resolves.
const COLLAPSE_KEY = 'jax:nav-collapsed'

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'true'
  } catch {
    return false
  }
}

function App() {
  const [view, setView] = useState<ViewId>('dashboard')
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)

  // Reconcile with the backend store on mount (and seed it on first run).
  useEffect(() => {
    let cancelled = false
    loadSetting(SETTING_KEYS.navCollapsed).then((stored) => {
      if (cancelled) return
      if (stored === 'true' || stored === 'false') {
        setCollapsed(stored === 'true')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed))
    } catch {
      // Ignore persistence failures.
    }
    saveSetting(SETTING_KEYS.navCollapsed, String(collapsed))
  }, [collapsed])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeView={view}
          onNavigate={setView}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          <TopBar onNavigate={setView} />
          <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' && <Dashboard onNavigate={setView} />}
            {view === 'streams' && <Streams />}
            {view === 'videos' && <Videos />}
            {view === 'settings' && <Settings />}
            {view === 'profile' && <Profile />}
          </div>
        </main>
      </div>
      {/* App-wide live status strip, spanning the full window width. */}
      <StatusBar />
    </div>
  )
}

export default App

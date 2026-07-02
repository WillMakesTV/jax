import {useEffect, useState} from 'react'
import {Sidebar} from './components/Sidebar'
import {TopBar} from './components/TopBar'
import type {ViewId} from './navigation'
import {Dashboard} from './views/Dashboard'
import {StreamPlanning} from './views/StreamPlanning'
import {Videos} from './views/Videos'
import {Settings} from './views/Settings'
import {Profile} from './views/Profile'

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

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed))
    } catch {
      // Ignore persistence failures.
    }
  }, [collapsed])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-fg">
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
          {view === 'stream-planning' && <StreamPlanning />}
          {view === 'videos' && <Videos />}
          {view === 'settings' && <Settings />}
          {view === 'profile' && <Profile />}
        </div>
      </main>
    </div>
  )
}

export default App

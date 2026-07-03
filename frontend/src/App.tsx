import {useCallback, useEffect, useState} from 'react'
import {main} from '../wailsjs/go/models'
import {WindowSetTitle} from '../wailsjs/runtime/runtime'
import {Sidebar} from './components/Sidebar'
import {StatusBar} from './components/StatusBar'
import {TopBar} from './components/TopBar'
import {SETTING_KEYS, loadSetting, saveSetting} from './lib/settings'
import type {ViewId} from './navigation'
import {useProfile} from './profile/ProfileProvider'
import {Chat} from './views/Chat'
import {Dashboard, type DashboardTab} from './views/Dashboard'
import {LiveStreamDetails} from './views/LiveStreamDetails'
import {StreamDetails} from './views/StreamDetails'
import {Streams} from './views/Streams'
import {Videos} from './views/Videos'
import {VideoDetails} from './views/VideoDetails'
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
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview')
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  const {profile} = useProfile()

  // The window/application title follows the profile name, falling back to
  // the default app name until one is set.
  useEffect(() => {
    const title = profile.name.trim() || 'Jax'
    document.title = title
    try {
      WindowSetTitle(title)
    } catch {
      // Wails runtime unavailable (e.g. plain Vite dev); document.title still applies.
    }
  }, [profile.name])

  // The stream selected on the Streams page, shown in the details view.
  const [detailStream, setDetailStream] = useState<main.PastStream | null>(null)
  const openStreamDetails = useCallback((stream: main.PastStream) => {
    setDetailStream(stream)
    setView('stream-details')
  }, [])

  // The video selected on the Videos page, shown in the details view.
  const [detailVideo, setDetailVideo] = useState<main.Video | null>(null)
  const openVideoDetails = useCallback((video: main.Video) => {
    setDetailVideo(video)
    setView('video-details')
  }, [])

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
          // Keep the parent item highlighted while a details view is open.
          activeView={
            view === 'stream-details' || view === 'live-details'
              ? 'streams'
              : view === 'video-details'
                ? 'videos'
                : view
          }
          onNavigate={setView}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          <TopBar onNavigate={setView} />
          <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' && (
              <Dashboard tab={dashboardTab} onTabChange={setDashboardTab} />
            )}
            {view === 'streams' && (
              <Streams
                onOpenStream={openStreamDetails}
                onOpenLive={() => setView('live-details')}
              />
            )}
            {view === 'stream-details' && detailStream && (
              <StreamDetails
                stream={detailStream}
                onBack={() => setView('streams')}
              />
            )}
            {view === 'live-details' && (
              <LiveStreamDetails onBack={() => setView('streams')} />
            )}
            {view === 'chat' && <Chat />}
            {view === 'videos' && <Videos onOpenVideo={openVideoDetails} />}
            {view === 'video-details' && detailVideo && (
              <VideoDetails
                video={detailVideo}
                onBack={() => setView('videos')}
              />
            )}
            {view === 'settings' && <Settings />}
            {view === 'profile' && <Profile />}
          </div>
        </main>
      </div>
      {/* App-wide live status strip, spanning the full window width. */}
      <StatusBar
        onOpenChat={() => setView('chat')}
        onOpenEvents={() => {
          setDashboardTab('events')
          setView('dashboard')
        }}
      />
    </div>
  )
}

export default App

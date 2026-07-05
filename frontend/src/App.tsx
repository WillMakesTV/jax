import {useCallback, useEffect, useMemo, useState} from 'react'
import {main} from '../wailsjs/go/models'
import {WindowSetTitle} from '../wailsjs/runtime/runtime'
import {Sidebar} from './components/Sidebar'
import {StatusBar} from './components/StatusBar'
import {TopBar} from './components/TopBar'
import {SETTING_KEYS, loadSetting, saveSetting} from './lib/settings'
import type {ViewId} from './navigation'
import {useProfile} from './profile/ProfileProvider'
import {platformName} from './services/services'
import {ObsStudio} from './obs/ObsStudio'
import {SmartSourcesUpdater} from './obs/SmartSourcesUpdater'
import {ChannelDetails} from './views/ChannelDetails'
import {Dashboard} from './views/Dashboard'
import {DownloadVideo} from './views/DownloadVideo'
import {LiveStream, type LiveStreamTab} from './views/LiveStream'
import {LiveStreamDetails} from './views/LiveStreamDetails'
import {Planning} from './views/Planning'
import {PlanStream} from './views/PlanStream'
import {StreamDetails} from './views/StreamDetails'
import {StreamTranscript} from './views/StreamTranscript'
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

/** One entry in the navigation history. */
interface NavState {
  view: ViewId
  liveTab: LiveStreamTab
  stream: main.PastStream | null
  video: main.Video | null
  channel: string
  download: main.DownloadedVideo | null
}

const INITIAL_NAV: NavState = {
  view: 'dashboard',
  liveTab: 'dashboard',
  stream: null,
  video: null,
  channel: '',
  download: null,
}

const sameNav = (a: NavState, b: NavState) =>
  a.view === b.view &&
  a.liveTab === b.liveTab &&
  a.stream === b.stream &&
  a.video === b.video &&
  a.channel === b.channel &&
  a.download === b.download

function App() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  const {profile} = useProfile()

  // Navigation history: back/forward step through these entries.
  const [nav, setNav] = useState<{stack: NavState[]; i: number}>({
    stack: [INITIAL_NAV],
    i: 0,
  })
  const cur = nav.stack[nav.i]
  const {view, liveTab} = cur
  const detailStream = cur.stream
  const detailVideo = cur.video
  const detailChannel = cur.channel
  const detailDownload = cur.download

  const navigate = useCallback((partial: Partial<NavState>) => {
    setNav(({stack, i}) => {
      const next = {...stack[i], ...partial}
      if (sameNav(next, stack[i])) return {stack, i}
      const truncated = stack.slice(0, i + 1)
      return {stack: [...truncated, next], i: i + 1}
    })
  }, [])

  const back = useCallback(
    () => setNav((n) => (n.i > 0 ? {...n, i: n.i - 1} : n)),
    [],
  )
  const forward = useCallback(
    () => setNav((n) => (n.i < n.stack.length - 1 ? {...n, i: n.i + 1} : n)),
    [],
  )
  const canBack = nav.i > 0
  const canForward = nav.i < nav.stack.length - 1

  // Navigation actions (each pushes a history entry).
  const setView = useCallback((v: ViewId) => navigate({view: v}), [navigate])
  const setLiveTab = useCallback(
    (t: LiveStreamTab) => navigate({view: 'live', liveTab: t}),
    [navigate],
  )
  const openStreamDetails = useCallback(
    (stream: main.PastStream) => navigate({view: 'stream-details', stream}),
    [navigate],
  )
  const openVideoDetails = useCallback(
    (video: main.Video) => navigate({view: 'video-details', video}),
    [navigate],
  )
  const openChannelDetails = useCallback(
    (channel: string) => navigate({view: 'channel-details', channel}),
    [navigate],
  )
  const openDownloadVideo = useCallback(
    (download: main.DownloadedVideo) =>
      navigate({view: 'download-video', download}),
    [navigate],
  )
  // Past streams now live in the Planning section; details views return there.
  const backToPastStreams = useCallback(
    () => navigate({view: 'planning'}),
    [navigate],
  )
  const openPlanStream = useCallback(
    () => navigate({view: 'plan-stream'}),
    [navigate],
  )

  // Mouse buttons 4/5 (back/forward) navigate history.
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        back()
      } else if (e.button === 4) {
        e.preventDefault()
        forward()
      }
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [back, forward])

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

  // The route title shown in the top bar.
  const routeTitle = useMemo(() => {
    switch (view) {
      case 'dashboard':
        return 'Dashboard'
      case 'live':
        return 'Broadcast'
      case 'planning':
        return 'Planning'
      case 'obs':
        return 'OBS Studio'
      case 'videos':
        return 'Videos'
      case 'settings':
        return 'Settings'
      case 'profile':
        return 'Profile'
      case 'stream-details':
        return detailStream?.title || 'Stream details'
      case 'stream-transcript':
        return 'Transcript'
      case 'live-details':
        return 'Live stream'
      case 'channel-details':
        return platformName(detailChannel) || 'Channel'
      case 'video-details':
        return detailVideo?.title || 'Video'
      case 'download-video':
        return detailDownload?.title || 'Video'
      case 'plan-stream':
        return 'Plan a stream'
      default:
        return 'Jax'
    }
  }, [view, detailStream, detailVideo, detailChannel, detailDownload])

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
      {/* Renders nothing; keeps OBS smart-source text updated while connected. */}
      <SmartSourcesUpdater />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          // Keep the parent item highlighted while a details view is open.
          activeView={
            view === 'stream-details' ||
            view === 'stream-transcript' ||
            view === 'live-details' ||
            view === 'download-video' ||
            view === 'plan-stream'
              ? 'planning'
              : view === 'video-details'
                ? 'videos'
                : view === 'channel-details'
                  ? 'dashboard'
                  : view
          }
          onNavigate={setView}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          <TopBar
            title={routeTitle}
            canBack={canBack}
            canForward={canForward}
            onBack={back}
            onForward={forward}
            onNavigate={setView}
          />
          <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' && (
              <Dashboard onOpenChannel={openChannelDetails} />
            )}
            {view === 'channel-details' && detailChannel && (
              <ChannelDetails
                platform={detailChannel}
                onBack={() => setView('dashboard')}
                onOpenVideo={openVideoDetails}
              />
            )}
            {view === 'live' && (
              <LiveStream
                tab={liveTab}
                onTabChange={setLiveTab}
                onOpenObs={() => setView('obs')}
              />
            )}
            {view === 'planning' && (
              <Planning
                onOpenStream={openStreamDetails}
                onOpenLive={() => setView('live-details')}
                onPlanStream={openPlanStream}
              />
            )}
            {view === 'plan-stream' && (
              <PlanStream
                onBack={() => back()}
                onSaved={backToPastStreams}
              />
            )}
            {view === 'obs' && <ObsStudio />}
            {view === 'stream-details' && detailStream && (
              <StreamDetails
                stream={detailStream}
                onBack={backToPastStreams}
                onOpenTranscript={() => setView('stream-transcript')}
                onOpenDownload={openDownloadVideo}
              />
            )}
            {view === 'download-video' && detailDownload && (
              <DownloadVideo
                download={detailDownload}
                onBack={() => back()}
              />
            )}
            {view === 'stream-transcript' && detailStream && (
              <StreamTranscript
                stream={detailStream}
                onBack={() => setView('stream-details')}
              />
            )}
            {view === 'live-details' && (
              <LiveStreamDetails onBack={backToPastStreams} />
            )}
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
        onOpenChat={() => setLiveTab('chat')}
        onOpenEvents={() => setLiveTab('events')}
      />
    </div>
  )
}

export default App

import {useCallback, useEffect, useMemo, useState} from 'react'
import {GetDownloads, GetPastStreams} from '../wailsjs/go/main/App'
import {main} from '../wailsjs/go/models'
import {WindowSetTitle} from '../wailsjs/runtime/runtime'
import {Sidebar} from './components/Sidebar'
import {StatusBar} from './components/StatusBar'
import {TopBar} from './components/TopBar'
import {SETTING_KEYS, loadSetting, saveSetting} from './lib/settings'
import type {ViewId} from './navigation'
import {useProfile} from './profile/ProfileProvider'
import {platformName} from './services/services'
import {ObsStudio, type ObsTab} from './obs/ObsStudio'
import {SmartSourcesUpdater} from './obs/SmartSourcesUpdater'
import {ChannelDetails} from './views/ChannelDetails'
import {Dashboard} from './views/Dashboard'
import {DownloadVideo} from './views/DownloadVideo'
import {EditRoutine} from './views/EditRoutine'
import {EditSeries} from './views/EditSeries'
import {LiveStream, type LiveStreamTab} from './views/LiveStream'
import {LiveStreamDetails} from './views/LiveStreamDetails'
import {Planning, type PlanningTab} from './views/Planning'
import {PlanStream} from './views/PlanStream'
import {Projects} from './views/Projects'
import {StreamDetails} from './views/StreamDetails'
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
  planningTab: PlanningTab
  obsTab: ObsTab
  stream: main.PastStream | null
  video: main.Video | null
  channel: string
  download: main.DownloadedVideo | null
  /** The content series being edited; null = creating a new one. */
  series: main.ContentSeries | null
  /** The routine being edited; null = creating a new one. */
  routine: main.Routine | null
}

const INITIAL_NAV: NavState = {
  view: 'dashboard',
  liveTab: 'dashboard',
  planningTab: 'dashboard',
  obsTab: 'dashboard',
  stream: null,
  video: null,
  channel: '',
  download: null,
  series: null,
  routine: null,
}

const sameNav = (a: NavState, b: NavState) =>
  a.view === b.view &&
  a.liveTab === b.liveTab &&
  a.planningTab === b.planningTab &&
  a.obsTab === b.obsTab &&
  a.stream === b.stream &&
  a.video === b.video &&
  a.channel === b.channel &&
  a.download === b.download &&
  a.series === b.series &&
  a.routine === b.routine

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
  const setPlanningTab = useCallback(
    (t: PlanningTab) => navigate({view: 'planning', planningTab: t}),
    [navigate],
  )
  const setObsTab = useCallback(
    (t: ObsTab) => navigate({view: 'obs', obsTab: t}),
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
  const openEditSeries = useCallback(
    (series: main.ContentSeries | null) =>
      navigate({view: 'edit-series', series}),
    [navigate],
  )
  const backToContentSeries = useCallback(
    () => navigate({view: 'planning', planningTab: 'series', series: null}),
    [navigate],
  )
  const openEditRoutine = useCallback(
    (routine: main.Routine | null) =>
      navigate({view: 'edit-routine', routine}),
    [navigate],
  )
  const backToRoutines = useCallback(
    () => navigate({view: 'obs', obsTab: 'routines', routine: null}),
    [navigate],
  )
  // Status-bar transcription chip: jump to the stream whose downloaded video
  // is being transcribed — its details page when the past stream is found,
  // otherwise the download's own video page.
  const openTranscribingStream = useCallback(
    async (subfolder: string) => {
      try {
        const downloads = await GetDownloads()
        const download = (downloads ?? []).find(
          (d) => d.subfolder === subfolder,
        )
        if (!download) return
        const streams = await GetPastStreams(false)
        const stream = (streams ?? []).find((s) =>
          (s.broadcasts ?? []).some((b) => (download.urls ?? []).includes(b.url)),
        )
        if (stream) {
          navigate({view: 'stream-details', stream})
        } else {
          navigate({view: 'download-video', download})
        }
      } catch {
        // Lookup failed (e.g. platforms unreachable); stay where we are.
      }
    },
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
      case 'projects':
        return 'Projects'
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
      case 'edit-series':
        return cur.series ? 'Edit series' : 'New content series'
      case 'edit-routine':
        return cur.routine ? 'Edit routine' : 'New routine'
      default:
        return 'Jax'
    }
  }, [view, detailStream, detailVideo, detailChannel, detailDownload, cur.series, cur.routine])

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
            view === 'live-details' ||
            view === 'download-video' ||
            view === 'plan-stream' ||
            view === 'edit-series'
              ? 'planning'
              : view === 'edit-routine'
                ? 'obs'
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
                tab={cur.planningTab}
                onTabChange={setPlanningTab}
                onOpenStream={openStreamDetails}
                onOpenLive={() => setView('live-details')}
                onPlanStream={openPlanStream}
                onEditSeries={openEditSeries}
              />
            )}
            {view === 'plan-stream' && (
              <PlanStream
                onBack={() => back()}
                onSaved={backToPastStreams}
              />
            )}
            {view === 'edit-series' && (
              <EditSeries
                series={cur.series}
                onBack={() => back()}
                onSaved={backToContentSeries}
              />
            )}
            {view === 'projects' && <Projects />}
            {view === 'obs' && (
              <ObsStudio
                tab={cur.obsTab}
                onTabChange={setObsTab}
                onEditRoutine={openEditRoutine}
              />
            )}
            {view === 'edit-routine' && (
              <EditRoutine
                routine={cur.routine}
                onBack={() => back()}
                onSaved={backToRoutines}
              />
            )}
            {view === 'stream-details' && detailStream && (
              <StreamDetails
                stream={detailStream}
                onBack={backToPastStreams}
                onOpenDownload={openDownloadVideo}
              />
            )}
            {view === 'download-video' && detailDownload && (
              <DownloadVideo
                download={detailDownload}
                onBack={() => back()}
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
        onOpenTranscribing={(subfolder) =>
          void openTranscribingStream(subfolder)
        }
      />
    </div>
  )
}

export default App

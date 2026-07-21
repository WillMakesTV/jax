import {useCallback, useEffect, useMemo, useState} from 'react'
import {
  GetDownloads,
  GetInspirationVideo,
  GetPastStreams,
  GetProjects,
  GetSponsors,
  GetStreamWidgets,
  GetVideoPlans,
} from '../wailsjs/go/main/App'
import {main} from '../wailsjs/go/models'
import {WindowSetTitle} from '../wailsjs/runtime/runtime'
import type {AiJobKind} from './ai/AiQueueProvider'
import {Sidebar} from './components/Sidebar'
import {StatusBar} from './components/StatusBar'
import {TopBar} from './components/TopBar'
import {SETTING_KEYS, loadSetting, saveSetting} from './lib/settings'
import type {ViewId} from './navigation'
import {useProfile} from './profile/ProfileProvider'
import {platformName} from './services/services'
import {ObsStudio, type ObsTab} from './obs/ObsStudio'
import {SmartSourcesUpdater} from './obs/SmartSourcesUpdater'
import {BroadcastPlan} from './views/BroadcastPlan'
import {ChannelDetails} from './views/ChannelDetails'
import {Dashboard} from './views/Dashboard'
import {DownloadVideo} from './views/DownloadVideo'
import {EditRoutine} from './views/EditRoutine'
import {EditSeries} from './views/EditSeries'
import {Inspiration} from './views/Inspiration'
import {InspirationChannelDetails} from './views/InspirationChannelDetails'
import {InspirationVideoDetails} from './views/InspirationVideoDetails'
import {LiveStreamDetails} from './views/LiveStreamDetails'
import {Planning, type PlanningTab} from './views/Planning'
import {PlanStream} from './views/PlanStream'
import {PlanVideo} from './views/PlanVideo'
import {ProjectDetails} from './views/ProjectDetails'
import {Projects} from './views/Projects'
import {CampaignDetails} from './views/CampaignDetails'
import {SponsorDetails} from './views/SponsorDetails'
import {Sponsors} from './views/Sponsors'
import {StreamDetails, type StreamTab} from './views/StreamDetails'
import {StreamWidgetDetails, type WidgetTab} from './views/StreamWidgetDetails'
import {Videos} from './views/Videos'
import {VideoDetails} from './views/VideoDetails'
import {VideoPlanDetails, type VideoPlanTab} from './views/VideoPlanDetails'
import {Settings, type SettingsTab} from './views/Settings'
import {Profile, type ProfileTab} from './views/Profile'

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
  planningTab: PlanningTab
  obsTab: ObsTab
  stream: main.PastStream | null
  /** Tab to land on when opening stream-details; null = default. */
  streamTab: StreamTab | null
  video: main.Video | null
  channel: string
  download: main.DownloadedVideo | null
  /** The content series being edited; null = creating a new one. */
  series: main.ContentSeries | null
  /** The routine being edited; null = creating a new one. */
  routine: main.Routine | null
  /** The stream widget being configured; null = none. */
  widget: main.StreamWidget | null
  /** Tab to land on when opening widget-details; null = default. */
  widgetTab: WidgetTab | null
  /** The stream plan being viewed/edited; null = creating a new one. */
  plan: main.PlannedStream | null
  /** The video plan being viewed/edited; null = creating a new one. */
  videoPlan: main.VideoPlan | null
  /** Tab to land on when opening the video-plan view; null = default. */
  videoPlanTab: VideoPlanTab | null
  /** Tab to land on when opening the profile view; null = default. */
  profileTab: ProfileTab | null
  /** The project being viewed; null = creating a new one. */
  project: main.Project | null
  /** The sponsor being viewed; null = creating a new one. */
  sponsor: main.Sponsor | null
  /** The campaign being viewed; null = creating a new one. */
  campaign: main.SponsorCampaign | null
  /** The inspiration channel being browsed; null = none. */
  inspirationChannel: main.InspirationChannel | null
  /** The inspiration video being read; null = none. */
  inspirationVideo: main.InspirationVideo | null
  /** Tab to land on when opening Settings; null = default. */
  settingsTab: SettingsTab | null
}

const INITIAL_NAV: NavState = {
  view: 'dashboard',
  planningTab: 'dashboard',
  obsTab: 'dashboard',
  stream: null,
  streamTab: null,
  video: null,
  channel: '',
  download: null,
  series: null,
  routine: null,
  widget: null,
  widgetTab: null,
  plan: null,
  videoPlan: null,
  videoPlanTab: null,
  profileTab: null,
  project: null,
  sponsor: null,
  campaign: null,
  inspirationChannel: null,
  inspirationVideo: null,
  settingsTab: null,
}

const sameNav = (a: NavState, b: NavState) =>
  a.view === b.view &&
  a.planningTab === b.planningTab &&
  a.obsTab === b.obsTab &&
  a.stream === b.stream &&
  a.streamTab === b.streamTab &&
  a.video === b.video &&
  a.channel === b.channel &&
  a.download === b.download &&
  a.series === b.series &&
  a.routine === b.routine &&
  a.widget === b.widget &&
  a.widgetTab === b.widgetTab &&
  a.plan === b.plan &&
  a.videoPlan === b.videoPlan &&
  a.videoPlanTab === b.videoPlanTab &&
  a.profileTab === b.profileTab &&
  a.project === b.project &&
  a.sponsor === b.sponsor &&
  a.campaign === b.campaign &&
  a.inspirationChannel === b.inspirationChannel &&
  a.inspirationVideo === b.inspirationVideo &&
  a.settingsTab === b.settingsTab

function App() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  const {profile} = useProfile()

  // Navigation history: back/forward step through these entries.
  const [nav, setNav] = useState<{stack: NavState[]; i: number}>({
    stack: [INITIAL_NAV],
    i: 0,
  })
  const cur = nav.stack[nav.i]
  const {view} = cur
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
  // Selecting a section from the main navigation always lands on its
  // default/dashboard tab rather than whichever tab was open last; history
  // entries keep their own tab state, so back/forward still restore it.
  const setView = useCallback(
    (v: ViewId) =>
      navigate({
        view: v,
        planningTab: 'dashboard',
        obsTab: 'dashboard',
      }),
    [navigate],
  )
  const setPlanningTab = useCallback(
    (t: PlanningTab) => navigate({view: 'broadcasting', planningTab: t}),
    [navigate],
  )
  const setObsTab = useCallback(
    (t: ObsTab) => navigate({view: 'obs', obsTab: t}),
    [navigate],
  )
  const openStreamDetails = useCallback(
    (stream: main.PastStream) =>
      navigate({view: 'stream-details', stream, streamTab: null}),
    [navigate],
  )
  // A rename on the stream-details page updates the current nav entry in
  // place (no new history entry), so the top-bar title follows immediately.
  const renameDetailStream = useCallback(
    (title: string, customTitle: string) =>
      setNav(({stack, i}) => {
        const cur = stack[i]
        if (!cur.stream) return {stack, i}
        const next = [...stack]
        next[i] = {
          ...cur,
          stream: main.PastStream.createFrom({
            ...cur.stream,
            title,
            customTitle,
          }),
        }
        return {stack: next, i}
      }),
    [],
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
    () => navigate({view: 'broadcasting'}),
    [navigate],
  )
  const openPlanStream = useCallback(
    () => navigate({view: 'plan-stream', plan: null}),
    [navigate],
  )
  const openPlanDetails = useCallback(
    (plan: main.PlannedStream) => navigate({view: 'plan-stream', plan}),
    [navigate],
  )
  // A plan card on the Broadcast dashboard opens its broadcast page (details
  // plus the Go Live / Update Stream Info / Conclude actions).
  const openBroadcastPlan = useCallback(
    (plan: main.PlannedStream) => navigate({view: 'broadcast-plan', plan}),
    [navigate],
  )
  const openPlanVideo = useCallback(
    (videoPlan: main.VideoPlan | null) =>
      navigate({view: 'plan-video', videoPlan}),
    [navigate],
  )
  // A planned-video card opens the plan's view page; Edit leads to the form.
  const openVideoPlanDetails = useCallback(
    (videoPlan: main.VideoPlan) =>
      navigate({view: 'video-plan', videoPlan, videoPlanTab: null}),
    [navigate],
  )
  // The Clips tab opens a plan on a specific tab (the Editor, right after a
  // script is chosen).
  const openVideoPlanOnTab = useCallback(
    (videoPlan: main.VideoPlan, videoPlanTab?: VideoPlanTab) =>
      navigate({
        view: 'video-plan',
        videoPlan,
        videoPlanTab: videoPlanTab ?? null,
      }),
    [navigate],
  )
  // The user menu links straight to a profile section.
  const openProfile = useCallback(
    (profileTab: ProfileTab) => navigate({view: 'profile', profileTab}),
    [navigate],
  )
  const backToVideos = useCallback(
    () => navigate({view: 'videos', videoPlan: null}),
    [navigate],
  )
  const openEditSeries = useCallback(
    (series: main.ContentSeries | null) =>
      navigate({view: 'edit-series', series}),
    [navigate],
  )
  const backToContentSeries = useCallback(
    () => navigate({view: 'broadcasting', planningTab: 'series', series: null}),
    [navigate],
  )
  const openProject = useCallback(
    (project: main.Project | null) =>
      navigate({view: 'project-details', project}),
    [navigate],
  )
  const backToProjects = useCallback(
    () => navigate({view: 'projects', project: null}),
    [navigate],
  )
  const openSponsor = useCallback(
    (sponsor: main.Sponsor | null) =>
      navigate({view: 'sponsor-details', sponsor, campaign: null}),
    [navigate],
  )
  const openInspirationChannel = useCallback(
    (channel: main.InspirationChannel) =>
      navigate({
        view: 'inspiration-channel',
        inspirationChannel: channel,
        inspirationVideo: null,
      }),
    [navigate],
  )
  const openInspirationVideo = useCallback(
    (video: main.InspirationVideo) =>
      navigate({view: 'inspiration-video', inspirationVideo: video}),
    [navigate],
  )
  // Status-bar chip for the inspiration pipeline: resolve the video by id,
  // then open its page.
  const openInspirationVideoById = useCallback(
    async (videoId: string) => {
      try {
        const video = await GetInspirationVideo(videoId)
        if (!video) return
        navigate({view: 'inspiration-video', inspirationVideo: video})
      } catch {
        // Lookup failed; stay where we are.
      }
    },
    [navigate],
  )
  const backToSponsors = useCallback(
    () => navigate({view: 'sponsors', sponsor: null, campaign: null}),
    [navigate],
  )
  const openCampaign = useCallback(
    (sponsor: main.Sponsor, campaign: main.SponsorCampaign | null) =>
      navigate({view: 'campaign-details', sponsor, campaign}),
    [navigate],
  )
  const openEditRoutine = useCallback(
    (routine: main.Routine | null) => navigate({view: 'edit-routine', routine}),
    [navigate],
  )
  const backToRoutines = useCallback(
    () => navigate({view: 'obs', obsTab: 'routines', routine: null}),
    [navigate],
  )
  const openWidgetDetails = useCallback(
    (widget: main.StreamWidget) =>
      navigate({view: 'widget-details', widget, widgetTab: null}),
    [navigate],
  )
  const backToWidgets = useCallback(
    () => navigate({view: 'obs', obsTab: 'widgets', widget: null}),
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
          (s.broadcasts ?? []).some((b) =>
            (download.urls ?? []).includes(b.url),
          ),
        )
        if (stream) {
          navigate({view: 'stream-details', stream, streamTab: null})
        } else {
          navigate({view: 'download-video', download})
        }
      } catch {
        // Lookup failed (e.g. platforms unreachable); stay where we are.
      }
    },
    [navigate],
  )
  // Status-bar chips that reference a past stream by its start timestamp
  // (outline generation, video download) resolve it and open its details
  // view, optionally on a specific tab.
  const openStreamByStart = useCallback(
    async (startedAt: string, streamTab: StreamTab | null) => {
      try {
        const streams = await GetPastStreams(false)
        const stream = (streams ?? []).find((s) => s.startedAt === startedAt)
        if (!stream) return
        navigate({view: 'stream-details', stream, streamTab})
      } catch {
        // Lookup failed (e.g. platforms unreachable); stay where we are.
      }
    },
    [navigate],
  )

  // A bug-fixed notice links back to the view its report was filed on.
  // Detail views need a subject the notice doesn't carry, so each falls back
  // to the section that leads to it.
  const openFixedRoute = useCallback(
    (route: string) => {
      const fallbacks: Record<string, ViewId> = {
        'stream-details': 'broadcasting',
        'live-details': 'broadcasting',
        'channel-details': 'dashboard',
        'video-details': 'videos',
        'download-video': 'videos',
        'video-plan': 'videos',
        'plan-video': 'videos',
        'plan-stream': 'broadcasting',
        'edit-series': 'broadcasting',
        'edit-routine': 'obs',
        'widget-details': 'obs',
        'edit-smart-source': 'obs',
        'custom-tokens': 'settings',
        'broadcast-plan': 'broadcasting',
        // Routes retired by the Broadcasting merge/rename: reports filed on
        // the old Broadcast section or the pre-rename planning route.
        live: 'broadcasting',
        planning: 'broadcasting',
        'project-details': 'projects',
        'sponsor-details': 'sponsors',
        'campaign-details': 'sponsors',
        'inspiration-channel': 'inspiration',
        'inspiration-video': 'inspiration',
      }
      const topLevel: ViewId[] = [
        'dashboard',
        'broadcasting',
        'projects',
        'sponsors',
        'inspiration',
        'obs',
        'videos',
        'settings',
        'profile',
      ]
      const target =
        fallbacks[route] ??
        (topLevel.includes(route as ViewId) ? (route as ViewId) : 'dashboard')
      setView(target)
    },
    [setView],
  )

  // A bug-fixed notice that carries its GitHub issue reference opens the
  // report history (Settings → Development), where the resolution details
  // live; older notices without one fall back to the view the report was
  // filed on.
  const openFixNotice = useCallback(
    (notice: main.FixNotice) => {
      if (notice.issueUrl || notice.issueNumber) {
        navigate({view: 'settings', settingsTab: 'development'})
        return
      }
      openFixedRoute(notice.route)
    },
    [navigate, openFixedRoute],
  )

  // Status-bar chips that reference a video plan by id (edit session on the
  // Editor tab, AI thumbnail/listing on the Publish tab) resolve it and open
  // its page on the right tab.
  const openVideoPlanById = useCallback(
    async (planId: string, tab: VideoPlanTab) => {
      try {
        const plans = await GetVideoPlans()
        const videoPlan = (plans ?? []).find((p) => p.id === planId)
        if (!videoPlan) return
        navigate({view: 'video-plan', videoPlan, videoPlanTab: tab})
      } catch {
        // Lookup failed; stay where we are.
      }
    },
    [navigate],
  )

  // Status-bar chip for a project's cover-image generation: resolve the
  // project by id and open its page.
  const openProjectById = useCallback(
    async (projectId: string) => {
      try {
        const projects = await GetProjects()
        const project = (projects ?? []).find((p) => p.id === projectId)
        if (!project) return
        navigate({view: 'project-details', project})
      } catch {
        // Lookup failed; stay where we are.
      }
    },
    [navigate],
  )

  // Status-bar chip for a sponsor's website research: resolve the sponsor by
  // id and open its page.
  const openSponsorById = useCallback(
    async (sponsorId: string) => {
      try {
        const sponsors = await GetSponsors()
        const sponsor = (sponsors ?? []).find((s) => s.id === sponsorId)
        if (!sponsor) return
        navigate({view: 'sponsor-details', sponsor, campaign: null})
      } catch {
        // Lookup failed; stay where we are.
      }
    },
    [navigate],
  )

  // Status-bar chips for a widget's generations: resolve the widget by id
  // and open its details page, landing on the tab the job concerns.
  const openWidgetById = useCallback(
    async (widgetId: string, tab?: WidgetTab) => {
      try {
        const widgets = await GetStreamWidgets()
        const widget = (widgets ?? []).find((w) => w.id === widgetId)
        if (widget)
          navigate({view: 'widget-details', widget, widgetTab: tab ?? null})
      } catch {
        // Lookup failed; stay where we are.
      }
    },
    [navigate],
  )

  // A job (or finished notice) in the status bar's AI queue opens the page
  // its result lands on.
  const openAiItem = useCallback(
    (kind: AiJobKind, targetId: string) => {
      switch (kind) {
        case 'clip-ideas':
          void openStreamByStart(targetId, 'clips')
          break
        case 'plan-thumbnail':
        case 'plan-listing':
          void openVideoPlanById(targetId, 'publish')
          break
        case 'project-image':
          void openProjectById(targetId)
          break
        case 'sponsor-research':
          void openSponsorById(targetId)
          break
        case 'widget-image':
        case 'widget-sound':
          void openWidgetById(targetId, 'fields')
          break
        case 'widget-skill':
          void openWidgetById(targetId, 'skill')
          break
        case 'widget-template':
        case 'widget-test':
          void openWidgetById(targetId, 'display')
          break
      }
    },
    [
      openStreamByStart,
      openVideoPlanById,
      openProjectById,
      openSponsorById,
      openWidgetById,
    ],
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
      case 'broadcasting':
        return 'Broadcasting'
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
        return cur.plan ? cur.plan.title || 'Edit plan' : 'Plan a stream'
      case 'broadcast-plan':
        return cur.plan?.title || 'Planned stream'
      case 'plan-video':
        return cur.videoPlan
          ? cur.videoPlan.title || 'Edit video plan'
          : 'Plan a video'
      case 'video-plan':
        return cur.videoPlan?.title || 'Video plan'
      case 'project-details':
        return cur.project ? cur.project.title || 'Project' : 'New project'
      case 'sponsors':
        return 'Sponsors'
      case 'inspiration':
        return 'Inspiration'
      case 'inspiration-channel':
        return cur.inspirationChannel?.name || 'Channel'
      case 'inspiration-video':
        return cur.inspirationVideo?.title || 'Inspiration video'
      case 'sponsor-details':
        return cur.sponsor ? cur.sponsor.name || 'Sponsor' : 'New sponsor'
      case 'campaign-details':
        return cur.campaign ? cur.campaign.name || 'Campaign' : 'New campaign'
      case 'edit-series':
        return cur.series ? 'Edit series' : 'New content series'
      case 'edit-routine':
        return cur.routine ? 'Edit routine' : 'New routine'
      case 'widget-details':
        return cur.widget?.name || 'Stream widget'
      default:
        return 'Jax'
    }
  }, [
    view,
    detailStream,
    detailVideo,
    detailChannel,
    detailDownload,
    cur.series,
    cur.routine,
    cur.widget,
    cur.plan,
    cur.videoPlan,
    cur.project,
    cur.sponsor,
    cur.campaign,
  ])

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
              ? 'broadcasting'
              : view === 'project-details'
                ? 'projects'
                : view === 'sponsor-details' || view === 'campaign-details'
                  ? 'sponsors'
                  : view === 'edit-routine' || view === 'widget-details'
                    ? 'obs'
                    : view === 'video-details' ||
                        view === 'plan-video' ||
                        view === 'video-plan'
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
            view={view}
            canBack={canBack}
            canForward={canForward}
            onBack={back}
            onForward={forward}
            onOpenObs={() => setView('obs')}
            onOpenProfile={openProfile}
          />
          <div className="flex-1 overflow-y-auto p-8">
            {view === 'dashboard' && (
              <Dashboard onOpenChannel={openChannelDetails} />
            )}
            {view === 'channel-details' && detailChannel && (
              <ChannelDetails
                platform={detailChannel}
                onOpenVideo={openVideoDetails}
              />
            )}
            {view === 'broadcast-plan' && cur.plan && (
              <BroadcastPlan
                plan={cur.plan}
                onBack={() => setView('broadcasting')}
                onEdit={openPlanDetails}
              />
            )}
            {view === 'broadcasting' && (
              <Planning
                tab={cur.planningTab}
                onTabChange={setPlanningTab}
                onOpenStream={openStreamDetails}
                onOpenLive={() => setView('live-details')}
                onPlanStream={openPlanStream}
                onOpenBroadcast={openBroadcastPlan}
                onEditSeries={openEditSeries}
                onPlanVideo={() => openPlanVideo(null)}
              />
            )}
            {view === 'plan-stream' && (
              <PlanStream
                plan={cur.plan}
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
            {view === 'projects' && <Projects onOpenProject={openProject} />}
            {view === 'project-details' && (
              <ProjectDetails project={cur.project} onBack={backToProjects} />
            )}
            {view === 'sponsors' && <Sponsors onOpenSponsor={openSponsor} />}
            {view === 'inspiration' && (
              <Inspiration onOpenChannel={openInspirationChannel} />
            )}
            {view === 'inspiration-channel' && cur.inspirationChannel && (
              <InspirationChannelDetails
                channel={cur.inspirationChannel}
                onOpenVideo={openInspirationVideo}
              />
            )}
            {view === 'inspiration-video' && cur.inspirationVideo && (
              <InspirationVideoDetails video={cur.inspirationVideo} />
            )}
            {view === 'sponsor-details' && (
              <SponsorDetails
                sponsor={cur.sponsor}
                onBack={backToSponsors}
                onOpenCampaign={openCampaign}
              />
            )}
            {view === 'campaign-details' && cur.sponsor && (
              <CampaignDetails
                sponsor={cur.sponsor}
                campaign={cur.campaign}
                onBack={() => back()}
              />
            )}
            {view === 'obs' && (
              <ObsStudio
                tab={cur.obsTab}
                onTabChange={setObsTab}
                onEditRoutine={openEditRoutine}
                onOpenWidget={openWidgetDetails}
              />
            )}
            {view === 'edit-routine' && (
              <EditRoutine
                routine={cur.routine}
                onBack={() => back()}
                onSaved={backToRoutines}
              />
            )}
            {view === 'widget-details' && cur.widget && (
              <StreamWidgetDetails
                widget={cur.widget}
                initialTab={cur.widgetTab ?? undefined}
                onBack={backToWidgets}
              />
            )}
            {view === 'stream-details' && detailStream && (
              <StreamDetails
                stream={detailStream}
                initialTab={cur.streamTab ?? undefined}
                onBack={backToPastStreams}
                onOpenDownload={openDownloadVideo}
                onOpenVideoPlan={openVideoPlanOnTab}
                onRenamed={renameDetailStream}
              />
            )}
            {view === 'download-video' && detailDownload && (
              <DownloadVideo download={detailDownload} onBack={() => back()} />
            )}
            {view === 'live-details' && (
              <LiveStreamDetails onBack={backToPastStreams} />
            )}
            {view === 'videos' && (
              <Videos
                onOpenVideo={openVideoDetails}
                onOpenVideoPlan={openVideoPlanDetails}
                onPlanVideo={() => openPlanVideo(null)}
              />
            )}
            {view === 'video-plan' && cur.videoPlan && (
              <VideoPlanDetails
                plan={cur.videoPlan}
                initialTab={cur.videoPlanTab ?? undefined}
                onEdit={openPlanVideo}
                onOpenStream={openStreamDetails}
                onDeleted={backToVideos}
              />
            )}
            {view === 'plan-video' && (
              <PlanVideo
                plan={cur.videoPlan}
                onBack={() => back()}
                onSaved={openVideoPlanDetails}
                onDeleted={backToVideos}
              />
            )}
            {view === 'video-details' && detailVideo && (
              <VideoDetails video={detailVideo} />
            )}
            {view === 'settings' && (
              <Settings
                key={cur.settingsTab ?? 'default'}
                initialTab={cur.settingsTab ?? undefined}
              />
            )}
            {view === 'profile' && (
              <Profile initialTab={cur.profileTab ?? undefined} />
            )}
          </div>
        </main>
      </div>
      {/* App-wide live status strip, spanning the full window width. */}
      <StatusBar
        onOpenChat={() => setPlanningTab('chat')}
        onOpenEvents={() => setPlanningTab('events')}
        onOpenDownloading={(startedAt) =>
          void openStreamByStart(startedAt, null)
        }
        onOpenTranscribing={(subfolder) =>
          void openTranscribingStream(subfolder)
        }
        onOpenOutline={(startedAt) =>
          void openStreamByStart(startedAt, 'outline')
        }
        onOpenAiItem={openAiItem}
        onOpenEditSession={(planId) => void openVideoPlanById(planId, 'editor')}
        onOpenPostStream={(startedAt, streamTab) =>
          void openStreamByStart(startedAt, streamTab)
        }
        onOpenInspiration={(videoId) => void openInspirationVideoById(videoId)}
        onOpenFixNotice={openFixNotice}
      />
    </div>
  )
}

export default App

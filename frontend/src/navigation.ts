import {
  LayoutDashboard,
  CalendarClock,
  FolderKanban,
  Clapperboard,
  Handshake,
  Settings,
  type LucideIcon,
} from 'lucide-react'

/**
 * Identifiers for every routable view in the app. `profile` (user menu),
 * `stream-details`, and `video-details` are reachable outside the sidebar, so
 * they are intentionally absent from the nav lists below.
 */
export type ViewId =
  | 'dashboard'
  | 'broadcast-plan'
  | 'broadcasting'
  | 'projects'
  | 'project-details'
  | 'sponsors'
  | 'sponsor-details'
  | 'campaign-details'
  | 'obs'
  | 'stream-details'
  | 'live-details'
  | 'channel-details'
  | 'videos'
  | 'video-details'
  | 'download-video'
  | 'plan-stream'
  | 'plan-video'
  | 'video-plan'
  | 'edit-series'
  | 'edit-routine'
  | 'widget-details'
  | 'settings'
  | 'profile'

export interface NavItemConfig {
  id: ViewId
  label: string
  icon: LucideIcon
}

/**
 * Primary navigation items, rendered in order at the top of the sidebar.
 * Broadcasting holds the whole broadcast lifecycle — stream planning, going
 * live (dashboard, chat, events, transcript), and past streams. OBS Studio is
 * not listed here — it is reached via the CTA in the top bar (see TopBar).
 */
export const PRIMARY_NAV: NavItemConfig[] = [
  {id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard},
  // Broadcasting then Videos: the order the work actually runs in — a stream
  // is planned and broadcast, and the videos are cut from it afterwards.
  {id: 'broadcasting', label: 'Broadcasting', icon: CalendarClock},
  {id: 'videos', label: 'Videos', icon: Clapperboard},
  // Projects is the writing/reference space rather than part of the pipeline,
  // so it sits at the end, with the sponsor relationships it feeds alongside.
  {id: 'projects', label: 'Projects', icon: FolderKanban},
  {id: 'sponsors', label: 'Sponsors', icon: Handshake},
]

/** Navigation item pinned to the bottom of the sidebar. */
export const SETTINGS_NAV: NavItemConfig = {
  id: 'settings',
  label: 'Settings',
  icon: Settings,
}

import {
  LayoutDashboard,
  CalendarClock,
  FolderKanban,
  MonitorPlay,
  Clapperboard,
  Settings,
  type LucideIcon,
} from 'lucide-react'

/**
 * Identifiers for every routable view in the app. `profile` (user menu),
 * `stream-details`, and `video-details` are reachable outside the sidebar, so
 * they are intentionally absent from the nav lists below. Past streams live
 * inside the Go Live! section as a tab.
 */
export type ViewId =
  | 'dashboard'
  | 'live'
  | 'broadcast-plan'
  | 'planning'
  | 'projects'
  | 'project-details'
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
  | 'edit-directions'
  | 'edit-series'
  | 'edit-routine'
  | 'edit-smart-source'
  | 'custom-tokens'
  | 'settings'
  | 'profile'

export interface NavItemConfig {
  id: ViewId
  label: string
  icon: LucideIcon
}

/**
 * Primary navigation items, rendered in order at the top of the sidebar.
 * The Broadcast section (live Dashboard, chat, events, and transcript tabs)
 * is not listed here — it is reached via the CTA in the top bar (see TopBar).
 * Planning holds stream planning and past streams; OBS Studio is its own
 * section.
 */
export const PRIMARY_NAV: NavItemConfig[] = [
  {id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard},
  {id: 'planning', label: 'Planning', icon: CalendarClock},
  {id: 'projects', label: 'Projects', icon: FolderKanban},
  {id: 'obs', label: 'OBS Studio', icon: MonitorPlay},
  {id: 'videos', label: 'Videos', icon: Clapperboard},
]

/** Navigation item pinned to the bottom of the sidebar. */
export const SETTINGS_NAV: NavItemConfig = {
  id: 'settings',
  label: 'Settings',
  icon: Settings,
}

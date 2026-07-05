import {
  LayoutDashboard,
  RadioTower,
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
  | 'planning'
  | 'projects'
  | 'obs'
  | 'stream-details'
  | 'live-details'
  | 'channel-details'
  | 'videos'
  | 'video-details'
  | 'download-video'
  | 'plan-stream'
  | 'edit-series'
  | 'edit-routine'
  | 'settings'
  | 'profile'

export interface NavItemConfig {
  id: ViewId
  label: string
  icon: LucideIcon
}

/**
 * Primary navigation items, rendered in order at the top of the sidebar.
 * The Broadcast item's icon pulses/glows red while a broadcast is on the air
 * (see Sidebar). Broadcast holds the live Dashboard, chat, events, and
 * transcript tabs; Planning holds stream planning and past streams; OBS Studio
 * is its own section.
 */
export const PRIMARY_NAV: NavItemConfig[] = [
  {id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard},
  {id: 'live', label: 'Broadcast', icon: RadioTower},
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

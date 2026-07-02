import {
  LayoutDashboard,
  CalendarClock,
  Clapperboard,
  Settings,
  type LucideIcon,
} from 'lucide-react'

/**
 * Identifiers for every routable view in the app. `profile` (user menu) and
 * `stream-details` (selected from the Streams page) are reachable outside the
 * sidebar, so they are intentionally absent from the nav lists below.
 */
export type ViewId =
  | 'dashboard'
  | 'streams'
  | 'stream-details'
  | 'live-details'
  | 'videos'
  | 'settings'
  | 'profile'

export interface NavItemConfig {
  id: ViewId
  label: string
  icon: LucideIcon
}

/** Primary navigation items, rendered in order at the top of the sidebar. */
export const PRIMARY_NAV: NavItemConfig[] = [
  {id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard},
  {id: 'streams', label: 'Streams', icon: CalendarClock},
  {id: 'videos', label: 'Videos', icon: Clapperboard},
]

/** Navigation item pinned to the bottom of the sidebar. */
export const SETTINGS_NAV: NavItemConfig = {
  id: 'settings',
  label: 'Settings',
  icon: Settings,
}

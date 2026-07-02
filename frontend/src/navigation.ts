import {
  LayoutDashboard,
  CalendarClock,
  Clapperboard,
  Settings,
  type LucideIcon,
} from 'lucide-react'

/**
 * Identifiers for every routable view in the app. `profile` is reachable from
 * the user menu rather than the sidebar, so it is intentionally absent from the
 * nav lists below.
 */
export type ViewId =
  | 'dashboard'
  | 'stream-planning'
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
  {id: 'stream-planning', label: 'Stream Planning', icon: CalendarClock},
  {id: 'videos', label: 'Videos', icon: Clapperboard},
]

/** Navigation item pinned to the bottom of the sidebar. */
export const SETTINGS_NAV: NavItemConfig = {
  id: 'settings',
  label: 'Settings',
  icon: Settings,
}

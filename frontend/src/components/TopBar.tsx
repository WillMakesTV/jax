import type {ViewId} from '../navigation'
import {UserMenu} from './UserMenu'

interface TopBarProps {
  onNavigate: (view: ViewId) => void
}

/**
 * Application top bar. Spans the content area and holds the user menu at the
 * right. Sits above the scrolling content so the user menu dropdown overlays
 * it cleanly.
 */
export function TopBar({onNavigate}: TopBarProps) {
  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center justify-end border-b border-edge bg-bg px-6">
      <UserMenu onNavigate={onNavigate} />
    </header>
  )
}

import {ChevronLeft, ChevronRight} from 'lucide-react'
import type {ViewId} from '../navigation'
import {UserMenu} from './UserMenu'

interface TopBarProps {
  /** Current route title, shown on the left. */
  title: string
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onNavigate: (view: ViewId) => void
}

/**
 * Application top bar. Left: history back/forward and the current route title.
 * Right: the user menu.
 */
export function TopBar({
  title,
  canBack,
  canForward,
  onBack,
  onForward,
  onNavigate,
}: TopBarProps) {
  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-edge bg-bg px-6">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          disabled={!canBack}
          aria-label="Back"
          title="Back"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canForward}
          aria-label="Forward"
          title="Forward"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
        <h1 className="ml-2 truncate text-lg font-semibold tracking-tight text-fg">
          {title}
        </h1>
      </div>

      <UserMenu onNavigate={onNavigate} />
    </header>
  )
}

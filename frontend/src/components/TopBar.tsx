import clsx from 'clsx'
import {ChevronLeft, ChevronRight, RadioTower} from 'lucide-react'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import type {ProfileTab} from '../views/Profile'
import {UserMenu} from './UserMenu'

interface TopBarProps {
  /** Current route title, shown on the left. */
  title: string
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  /** Open the Broadcast section (the CTA next to the user menu). */
  onOpenBroadcast: () => void
  /** Open the profile page on the given tab (from the user menu). */
  onOpenProfile: (tab: ProfileTab) => void
}

/**
 * Application top bar. Left: history back/forward and the current route title.
 * Right: the Broadcast CTA and the user menu.
 */
export function TopBar({
  title,
  canBack,
  canForward,
  onBack,
  onForward,
  onOpenBroadcast,
  onOpenProfile,
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

      <div className="flex shrink-0 items-center gap-3">
        <BroadcastCta onClick={onOpenBroadcast} />
        <UserMenu onOpenProfile={onOpenProfile} />
      </div>
    </header>
  )
}

/**
 * The Broadcast section entry point: an emerald CTA (distinct from the indigo
 * accent used across the app) that turns red and pulses while a broadcast is
 * on the air (the indicator formerly on the sidebar's Broadcast item).
 */
function BroadcastCta({onClick}: {onClick: () => void}) {
  const {platforms, obs} = useLiveData()
  const {anyLive} = aggregateLive(platforms, obs)

  return (
    <button
      type="button"
      onClick={onClick}
      title={anyLive ? 'On the air — open Broadcast' : 'Open Broadcast'}
      className={clsx(
        'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
        anyLive
          ? 'bg-red-600 text-white hover:bg-red-500'
          : 'bg-emerald-700 text-white hover:bg-emerald-600 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300',
      )}
    >
      <RadioTower
        size={16}
        aria-hidden
        className={clsx(anyLive && 'animate-pulse')}
      />
      {anyLive ? 'On air' : 'Broadcast'}
    </button>
  )
}

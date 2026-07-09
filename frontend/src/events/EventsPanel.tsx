import {
  Bell,
  ChevronDown,
  Gem,
  Gift,
  Heart,
  Repeat,
  Rocket,
  Star,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {BrandTile} from '../components/BrandTile'
import {platformName} from '../services/services'
import {useEvents, type LiveEventItem} from './EventsProvider'

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})
const dateFmt = new Intl.DateTimeFormat('en', {month: 'short', day: 'numeric'})
const dateYearFmt = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** "Jul 5 · 11:03 PM", with the year added once it isn't the current one. */
function formatWhen(at: number): string {
  const d = new Date(at)
  const fmt = d.getFullYear() === new Date().getFullYear() ? dateFmt : dateYearFmt
  return `${fmt.format(d)} · ${timeFmt.format(d)}`
}

/** Events older than this fold behind the "Show more" control. */
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/** How many folded/older events each "Show more" click reveals. */
const OLDER_STEP = 100

/** Icon per event type; the fallback bell covers future types. Shared with
 *  the past-stream events panel (see components/StreamMedia.tsx). */
export const EVENT_ICONS: Record<string, LucideIcon> = {
  follow: UserPlus,
  sub: Star,
  gift: Gift,
  resub: Repeat,
  cheer: Gem,
  raid: Rocket,
  member: Heart,
  milestone: Repeat,
  superchat: Gem,
  supersticker: Gem,
}

/**
 * The Live Events feed: follows, subs, gifts, cheers, raids, members, Super
 * Chats, and new YouTube subscribers across every channel — one unified,
 * persisted list, newest first. The last two weeks show by default; older
 * history sits behind "Show more", which reveals (and lazy-loads from the
 * database) 100 events at a time. Events count as read once displayed here
 * while the window has focus (same semantics as chat).
 */
export function EventsPanel() {
  const {events, markAllRead, warnings, hasMore, loadOlder} = useEvents()
  const [olderShown, setOlderShown] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)

  // Displayed + focused = read; regaining focus with the panel open counts.
  const maybeMarkRead = useCallback(() => {
    if (document.hasFocus()) markAllRead()
  }, [markAllRead])
  useEffect(() => {
    maybeMarkRead()
  }, [events, maybeMarkRead])
  useEffect(() => {
    window.addEventListener('focus', maybeMarkRead)
    return () => window.removeEventListener('focus', maybeMarkRead)
  }, [maybeMarkRead])

  const cutoff = Date.now() - RECENT_WINDOW_MS
  const newestFirst = [...events].reverse()
  const recent = newestFirst.filter((e) => e.at >= cutoff)
  const older = newestFirst.filter((e) => e.at < cutoff)
  const visible = [...recent, ...older.slice(0, olderShown)]
  const moreAvailable = older.length > olderShown || hasMore

  const showMore = async () => {
    if (loadingOlder) return
    const target = olderShown + OLDER_STEP
    // Not enough older events loaded to fill the next step: pull the next
    // page from the database first, then reveal.
    if (older.length < target && hasMore) {
      setLoadingOlder(true)
      try {
        await loadOlder()
      } finally {
        setLoadingOlder(false)
      }
    }
    setOlderShown(target)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-edge bg-surface">
      {warnings.length > 0 && (
        <p className="border-b border-edge p-3 text-xs text-amber-600 dark:text-amber-400">
          {warnings.join(' ')}
        </p>
      )}
      {events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Bell size={24} />
          </span>
          <p className="max-w-sm text-sm text-fg-muted">
            Follows, subscriptions, cheers, raids, members, and Super Chats
            from all your channels appear here — collected live and synced
            periodically, and kept across restarts.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {visible.length === 0 && (
            <p className="pb-3 text-center text-sm text-fg-muted">
              No events in the last two weeks.
            </p>
          )}
          <ul className="space-y-2">
            {visible.map((e) => (
              <EventRow key={`${e.platform}-${e.id}`} event={e} />
            ))}
          </ul>
          {moreAvailable && (
            <button
              type="button"
              onClick={() => void showMore()}
              disabled={loadingOlder}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            >
              <ChevronDown size={14} aria-hidden />
              {loadingOlder ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function EventRow({event: e}: {event: LiveEventItem}) {
  const Icon = EVENT_ICONS[e.type] ?? Bell
  return (
    <li
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        e.read ? 'border-edge bg-bg' : 'border-accent/40 bg-accent/5'
      }`}
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
      >
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm leading-snug">
          <span className="font-semibold text-fg">{e.author}</span>{' '}
          <span className="text-fg">{e.detail}</span>
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
          <BrandTile platform={e.platform} size={12} />
          {platformName(e.platform)} · {formatWhen(e.at)}
        </p>
      </div>
      {!e.read && (
        <span
          aria-label="Unread"
          className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent"
        />
      )}
    </li>
  )
}

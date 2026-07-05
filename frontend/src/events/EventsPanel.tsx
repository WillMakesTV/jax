import {
  Bell,
  Gem,
  Gift,
  Heart,
  Repeat,
  Rocket,
  Star,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import {useCallback, useEffect} from 'react'
import {BrandTile} from '../components/BrandTile'
import {platformName} from '../services/services'
import {useEvents} from './EventsProvider'

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})

/** Icon per event type; the fallback bell covers future types. */
const EVENT_ICONS: Record<string, LucideIcon> = {
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
 * Chats, and new YouTube subscribers across every live channel, newest last.
 * Events count as read once displayed here while the window has focus (same
 * semantics as chat).
 */
export function EventsPanel() {
  const {events, markAllRead, warnings} = useEvents()

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
            from all your channels appear here while you are live.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-2">
            {[...events].reverse().map((e) => {
              const Icon = EVENT_ICONS[e.type] ?? Bell
              return (
                <li
                  key={`${e.platform}-${e.id}`}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    e.read
                      ? 'border-edge bg-bg'
                      : 'border-accent/40 bg-accent/5'
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
                      {platformName(e.platform)} · {timeFmt.format(e.at)}
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
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

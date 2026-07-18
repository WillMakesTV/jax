import {ArrowRight, Bell, MessageSquare, type LucideIcon} from 'lucide-react'
import clsx from 'clsx'
import {useChat} from '../chat/ChatProvider'
import {useEvents} from '../events/EventsProvider'

interface BroadcastNotificationsProps {
  /** Open the Chat tab. */
  onOpenChat: () => void
  /** Open the Events tab. */
  onOpenEvents: () => void
}

/**
 * The Broadcasting dashboard's notification cards: unread chat and unread
 * events, each deep-linking to its tab. (The OBS preview that used to sit
 * beside them moved out entirely — OBS Studio has the top bar's CTA.)
 */
export function BroadcastNotifications({
  onOpenChat,
  onOpenEvents,
}: BroadcastNotificationsProps) {
  const {unreadCount: unreadChat} = useChat()
  const {unreadCount: unreadEvents} = useEvents()

  return (
    <section aria-label="Notifications">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Notifications
      </h2>
      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <UnreadCard
          icon={MessageSquare}
          label="Unread messages"
          hint="from the unified chat"
          count={unreadChat}
          onClick={onOpenChat}
        />
        <UnreadCard
          icon={Bell}
          label="Unread events"
          hint="follows, subs & more"
          count={unreadEvents}
          onClick={onOpenEvents}
        />
      </div>
    </section>
  )
}

function UnreadCard({
  icon: Icon,
  label,
  hint,
  count,
  onClick,
}: {
  icon: LucideIcon
  label: string
  hint: string
  count: number
  onClick: () => void
}) {
  const active = count > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-xl border bg-surface p-4 text-left transition-colors hover:bg-surface-hover',
        active ? 'border-accent/50' : 'border-edge',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          active
            ? 'bg-accent text-accent-fg'
            : 'bg-surface-hover text-fg-muted',
        )}
      >
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold text-fg">{count}</span>
          <span className="truncate text-sm font-medium text-fg">{label}</span>
        </div>
        <p className="truncate text-xs text-fg-muted">{hint}</p>
      </div>
      <ArrowRight size={16} aria-hidden className="shrink-0 text-fg-muted" />
    </button>
  )
}

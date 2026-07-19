import {Bell, MessageSquare, type LucideIcon} from 'lucide-react'
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
 * The Broadcasting header's notification chips: unread chat and unread
 * events, each deep-linking to its tab. They sit inline with the section's
 * tablist — visible from every tab, not just the dashboard (where they used
 * to be a full card section).
 */
export function BroadcastNotifications({
  onOpenChat,
  onOpenEvents,
}: BroadcastNotificationsProps) {
  const {unreadCount: unreadChat} = useChat()
  const {unreadCount: unreadEvents} = useEvents()

  return (
    <div aria-label="Notifications" className="flex items-center gap-2">
      <UnreadChip
        icon={MessageSquare}
        label="Unread messages"
        count={unreadChat}
        onClick={onOpenChat}
      />
      <UnreadChip
        icon={Bell}
        label="Unread events"
        count={unreadEvents}
        onClick={onOpenEvents}
      />
    </div>
  )
}

function UnreadChip({
  icon: Icon,
  label,
  count,
  onClick,
}: {
  icon: LucideIcon
  label: string
  count: number
  onClick: () => void
}) {
  const active = count > 0
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={`${label}: ${count}`}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border bg-surface px-2.5 py-2 transition-colors hover:bg-surface-hover',
        active ? 'border-accent/50 text-fg' : 'border-edge text-fg-muted',
      )}
    >
      <Icon size={14} aria-hidden className={clsx(active && 'text-accent')} />
      <span className="text-xs font-semibold">{count}</span>
    </button>
  )
}

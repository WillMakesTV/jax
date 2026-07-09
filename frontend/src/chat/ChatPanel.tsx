import {ArrowDown, Bot, MessageSquare, Radio, Send} from 'lucide-react'
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {BrandTile} from '../components/BrandTile'
import {Modal} from '../components/Modal'
import {anyChannelConnected, platformName} from '../services/services'
import {useServices} from '../services/ServicesProvider'
import {useChat, type ChatItem} from './ChatProvider'
import {ChatUserModal} from './ChatUserModal'

const chatTimeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})

/** How close to the bottom (px) still counts as "at the bottom". */
const BOTTOM_SLACK = 40

/**
 * The aggregated live chat surface: message list (sticks to the newest
 * messages), broadcast composer, and the chatter profile popup. Fills its
 * parent's height; used by the Chat page and the Live Dashboard's chat tab.
 *
 * Messages count as read once displayed here while the window has focus;
 * otherwise they stay unread and feed the status-bar notification.
 */
export function ChatPanel() {
  const {messages, active, unreadCount, markAllRead, sendBroadcast} = useChat()
  const {statuses} = useServices()
  const listRef = useRef<HTMLDivElement>(null)
  // Follow new messages only while the user is already at the bottom.
  const stickToBottom = useRef(true)
  const [selectedUser, setSelectedUser] = useState<ChatItem | null>(null)
  const [botsOpen, setBotsOpen] = useState(false)

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickToBottom.current = true
  }, [])

  // Land on the newest messages before first paint.
  useLayoutEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  // A message is "displayed" while the list is following the bottom; combined
  // with window focus that makes it read.
  const maybeMarkRead = useCallback(() => {
    if (document.hasFocus() && stickToBottom.current) markAllRead()
  }, [markAllRead])

  // New messages: keep following the bottom, then mark what is on screen.
  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    maybeMarkRead()
  }, [messages, maybeMarkRead])

  // Unread messages accumulated while the window was unfocused become read
  // the moment focus returns with the chat on screen.
  useEffect(() => {
    window.addEventListener('focus', maybeMarkRead)
    return () => window.removeEventListener('focus', maybeMarkRead)
  }, [maybeMarkRead])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK
    if (stickToBottom.current) maybeMarkRead()
  }

  // Broadcast composer state.
  const canSend = anyChannelConnected(statuses)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendInfo, setSendInfo] = useState('')

  const onSend = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setSendError('')
    setSendInfo('')
    try {
      const results = await sendBroadcast(text)
      const sent = results.filter((r) => r.sent)
      const failures = results.filter((r) => !r.sent)
      // Report both sides explicitly so a one-platform failure stands out.
      if (sent.length > 0) {
        setSendInfo(
          `Sent to ${sent.map((r) => platformName(r.platform)).join(' and ')}.`,
        )
      }
      if (failures.length > 0) {
        setSendError(
          failures
            .map((r) => `${platformName(r.platform)}: ${r.error}`)
            .join(' · '),
        )
      }
      if (results.length === 0) {
        setSendError('No connected channels to send to.')
      }
      if (sent.length > 0) {
        setDraft('')
        scrollToBottom()
      }
    } catch {
      setSendError('Could not send the broadcast message.')
    } finally {
      setSending(false)
    }
  }

  // The success note fades on its own; errors stay until the next send.
  useEffect(() => {
    if (!sendInfo) return
    const id = window.setTimeout(() => setSendInfo(''), 5_000)
    return () => window.clearTimeout(id)
  }, [sendInfo])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-edge bg-surface">
      {/* Bots CTA, pinned to the chat's top-right. Placeholder for now. */}
      <button
        type="button"
        onClick={() => setBotsOpen(true)}
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg/90 px-3 py-1.5 text-xs font-semibold text-fg shadow-sm backdrop-blur-sm transition-colors hover:bg-surface-hover"
      >
        <Bot size={14} aria-hidden />
        Bots
        <span className="rounded-full border border-edge bg-surface px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-fg-muted">
          Soon
        </span>
      </button>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <MessageSquare size={24} />
          </span>
          <p className="max-w-sm text-sm text-fg-muted">
            {active
              ? 'Connected — chat messages will appear here.'
              : 'Chat from all your channels appears here while you are live.'}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto p-4"
        >
          <ul className="space-y-1.5">
            {messages.map((m) =>
              m.platform === 'broadcast' ? (
                <li
                  key={`${m.platform}-${m.id}`}
                  className="flex items-start gap-2 rounded-lg bg-accent/10 px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg"
                  >
                    <Radio size={10} />
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm leading-snug">
                    <span className="font-semibold text-accent">Broadcast</span>{' '}
                    <span className="text-fg">{m.text}</span>
                  </p>
                  <span className="shrink-0 pt-0.5 text-[10px] text-fg-muted">
                    {chatTimeFmt.format(m.at)}
                  </span>
                </li>
              ) : (
                <li
                  key={`${m.platform}-${m.id}`}
                  className="flex items-start gap-2"
                >
                  {/* Unread marker: filled until the message has been seen. */}
                  <span
                    aria-hidden
                    title={m.read ? undefined : 'Unread'}
                    className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                      m.read ? 'bg-transparent' : 'bg-accent'
                    }`}
                  />
                  {/* Channel source of the chatter. */}
                  <span className="mt-0.5" title={platformName(m.platform)}>
                    <BrandTile platform={m.platform} size={16} />
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm leading-snug">
                    {/* The author opens their profile popup. */}
                    <button
                      type="button"
                      onClick={() => setSelectedUser(m)}
                      className="font-semibold text-fg hover:underline"
                      style={m.color ? {color: m.color} : undefined}
                    >
                      {m.author}
                    </button>{' '}
                    <span className="text-fg">{m.text}</span>
                  </p>
                  <span className="shrink-0 pt-0.5 text-[10px] text-fg-muted">
                    {chatTimeFmt.format(m.at)}
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {/* Jump back to the newest messages when scrolled up with unread. */}
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-16 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg shadow-lg transition-opacity hover:opacity-90"
        >
          <ArrowDown size={14} aria-hidden />
          {unreadCount} new {unreadCount === 1 ? 'message' : 'messages'}
        </button>
      )}

      {/* Broadcast composer: one message to every connected channel's chat. */}
      <div className="border-t border-edge p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSend()
            }}
            placeholder={
              canSend
                ? 'Broadcast a message to all connected channels…'
                : 'Connect Twitch or YouTube to broadcast messages.'
            }
            disabled={!canSend || sending}
            aria-label="Broadcast message"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={!canSend || sending || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send size={14} aria-hidden />
            {sending ? 'Sending…' : 'Broadcast'}
          </button>
        </div>
        {sendInfo && <p className="mt-2 text-xs text-fg-muted">{sendInfo}</p>}
        {sendError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            {sendError}
          </p>
        )}
      </div>

      <ChatUserModal
        user={selectedUser}
        messages={messages}
        onClose={() => setSelectedUser(null)}
      />

      {/* Bots placeholder; management lands later. */}
      <Modal
        open={botsOpen}
        onClose={() => setBotsOpen(false)}
        title="Bots"
        icon={
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Bot size={16} />
          </span>
        }
      >
        <p className="text-sm text-fg-muted">
          Chat-bot management is on the way: automated responses, commands, and
          moderation across your connected channels, controlled from right
          here.
        </p>
      </Modal>
    </div>
  )
}

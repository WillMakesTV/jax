import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {SubscribeTwitchEvents} from '../../wailsjs/go/main/App'
import {connectTwitchEventSub} from '../lib/twitchEventSub'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'

/** One channel event in the Live Events feed. */
export interface LiveEventItem {
  id: string
  platform: string // 'twitch' | 'youtube'
  type: string // 'follow' | 'sub' | 'gift' | 'resub' | 'cheer' | 'raid' | 'member' | 'milestone' | 'superchat' | 'supersticker'
  author: string
  detail: string
  /** Unix millis. */
  at: number
  /** Same semantics as chat: seen on the Live Events tab while focused. */
  read: boolean
}

/** Keep a bounded history so a busy stream cannot grow without limit. */
const MAX_EVENTS = 200

interface EventsContextValue {
  events: LiveEventItem[]
  /** Number of events not yet seen on the Live Events tab. */
  unreadCount: number
  /** Mark every current event as read (the events tab displayed them). */
  markAllRead: () => void
  /** Feed events from another source (YouTube events ride the chat poll). */
  pushEvents: (items: Omit<LiveEventItem, 'read'>[]) => void
  /** Non-fatal setup problems (e.g. missing scopes), for the events tab. */
  warnings: string[]
}

const EventsContext = createContext<EventsContextValue | undefined>(undefined)

/**
 * Aggregates channel events while live: Twitch over an EventSub WebSocket
 * (follows, subs, gifts, resubs, cheers, raids), YouTube via the events the
 * chat poll extracts (members, milestones, Super Chats/Stickers). Mounted
 * app-wide so the feed and unread counts survive navigation.
 */
export function EventsProvider({children}: {children: ReactNode}) {
  const {statuses} = useServices()
  const {platforms} = useLiveData()
  const [events, setEvents] = useState<LiveEventItem[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  const pushEvents = useCallback((items: Omit<LiveEventItem, 'read'>[]) => {
    if (items.length === 0) return
    setEvents((prev) => {
      // The YouTube poll can replay a page; drop ids we already have.
      const seen = new Set(prev.map((e) => `${e.platform}-${e.id}`))
      const fresh = items
        .filter((e) => !seen.has(`${e.platform}-${e.id}`))
        .map((e) => ({...e, read: false}))
      if (fresh.length === 0) return prev
      const next = [...prev, ...fresh]
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
    })
  }, [])

  const markAllRead = useCallback(() => {
    setEvents((prev) =>
      prev.some((e) => !e.read)
        ? prev.map((e) => (e.read ? e : {...e, read: true}))
        : prev,
    )
  }, [])

  // Twitch EventSub while the Twitch channel is live ("live events" cover the
  // running broadcast; the socket also drops naturally when the stream ends).
  const twitchLive =
    statuses.twitch.connected &&
    platforms.some((p) => p.platform === 'twitch' && p.live)
  useEffect(() => {
    if (!twitchLive) return
    setWarnings([])
    return connectTwitchEventSub(
      (e) => pushEvents([{...e, platform: 'twitch'}]),
      async (sessionId) => {
        const warns = await SubscribeTwitchEvents(sessionId)
        setWarnings(warns ?? [])
      },
      (message) => setWarnings([message]),
    )
  }, [twitchLive, pushEvents])

  const unreadCount = useMemo(
    () => events.reduce((n, e) => n + (e.read ? 0 : 1), 0),
    [events],
  )
  const value = useMemo<EventsContextValue>(
    () => ({events, unreadCount, markAllRead, pushEvents, warnings}),
    [events, unreadCount, markAllRead, pushEvents, warnings],
  )

  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
  )
}

export function useEvents(): EventsContextValue {
  const context = useContext(EventsContext)
  if (!context) {
    throw new Error('useEvents must be used within an EventsProvider')
  }
  return context
}

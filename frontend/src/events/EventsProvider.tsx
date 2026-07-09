import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  GetLiveEventHistory,
  GetLiveEventsBefore,
  MarkAllLiveEventsRead,
  SaveLiveEvents,
  SubscribeTwitchEvents,
  SyncPlatformEvents,
} from '../../wailsjs/go/main/App'
import {connectTwitchEventSub} from '../lib/twitchEventSub'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'
import {anyChannelConnected} from '../services/services'

/** One channel event in the Live Events feed. */
export interface LiveEventItem {
  id: string
  platform: string // 'twitch' | 'youtube' | 'kick'
  type: string // 'follow' | 'sub' | 'gift' | 'resub' | 'cheer' | 'raid' | 'member' | 'milestone' | 'superchat' | 'supersticker'
  author: string
  detail: string
  /** Unix millis. */
  at: number
  /** Same semantics as chat: seen on the Live Events tab while focused. */
  read: boolean
}

/** How many events seed the feed on launch; older pages load on demand. */
const SEED_EVENTS = 200

/** Page size for lazy-loading older history ("Show more"). */
const OLDER_PAGE = 100

/** Platform-sync cadence: quicker while live, relaxed otherwise. */
const SYNC_LIVE_MS = 20_000
const SYNC_IDLE_MS = 60_000

interface EventsContextValue {
  events: LiveEventItem[]
  /** Number of events not yet seen on the Live Events tab. */
  unreadCount: number
  /** Mark every current event as read (the events tab displayed them). */
  markAllRead: () => void
  /** Feed events from another source (YouTube events ride the chat poll). */
  pushEvents: (items: (Omit<LiveEventItem, 'read'> & {read?: boolean})[]) => void
  /** Whether the database may hold events older than the oldest loaded. */
  hasMore: boolean
  /** Lazy-load the next page of older events from the database. */
  loadOlder: () => Promise<void>
  /** Non-fatal setup problems (e.g. missing scopes), for the events tab. */
  warnings: string[]
}

const EventsContext = createContext<EventsContextValue | undefined>(undefined)

const keyOf = (e: {platform: string; id: string}) => `${e.platform}-${e.id}`

/**
 * The unified channel-events feed across every streaming destination.
 *
 * Live events arrive by push: Twitch over an EventSub WebSocket (follows,
 * subs, gifts, resubs, cheers, raids), YouTube via the events the chat poll
 * extracts (members, milestones, Super Chats/Stickers). On top of that, a
 * periodic backend sync (SyncPlatformEvents) pulls each platform's pollable
 * history — Twitch followers, YouTube subscribers — catching anything the
 * push channels missed, e.g. while the app was closed.
 *
 * Every event is persisted to the local database (best-effort, like chat) and
 * the feed seeds itself from it on launch, so history and read state survive
 * restarts. Mounted app-wide so the feed and unread counts survive navigation.
 */
export function EventsProvider({children}: {children: ReactNode}) {
  const {statuses} = useServices()
  const {platforms} = useLiveData()
  const [events, setEvents] = useState<LiveEventItem[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)

  // The oldest loaded event's timestamp — the cursor for paging history.
  const oldestAtRef = useRef<number | null>(null)
  useEffect(() => {
    oldestAtRef.current = events.length > 0 ? events[0].at : null
  }, [events])

  const pushEvents = useCallback(
    (items: (Omit<LiveEventItem, 'read'> & {read?: boolean})[]) => {
      if (items.length === 0) return
      setEvents((prev) => {
        // Pushes can replay (YouTube poll pages, sync overlap with EventSub);
        // drop ids we already have.
        const seen = new Set(prev.map(keyOf))
        const fresh = items
          .filter((e) => !seen.has(keyOf(e)))
          .map((e) => ({...e, read: e.read ?? false}))
        if (fresh.length === 0) return prev
        // Persist to the local log (fire-and-forget; the app still works
        // without storage). Existing rows keep their read state.
        SaveLiveEvents(
          fresh.map((e) => ({
            platform: e.platform,
            id: e.id,
            type: e.type,
            author: e.author,
            detail: e.detail,
            at: e.at,
            read: e.read,
          })),
        ).catch(() => {})
        // Synced events can be older than the tail; keep the feed in order.
        // No in-memory cap: lazily loaded history must not be evicted, and
        // the seed/page sizes keep the working set small anyway.
        return [...prev, ...fresh].sort((a, b) => a.at - b.at)
      })
    },
    [],
  )

  // Seed from the local log on launch: history renders instantly, unread
  // state carries over, and no platform API is touched to show it.
  useEffect(() => {
    let cancelled = false
    GetLiveEventHistory(SEED_EVENTS)
      .then((stored) => {
        if (cancelled || !stored || stored.length === 0) return
        // A full seed page suggests the database holds older events too.
        setHasMore(stored.length === SEED_EVENTS)
        setEvents((prev) => {
          // Live events may have landed before the log loaded; keep both,
          // oldest first, deduped by identity.
          const seen = new Set(prev.map(keyOf))
          const restored: LiveEventItem[] = stored
            .filter((e) => !seen.has(keyOf(e)))
            .map((e) => ({
              id: e.id,
              platform: e.platform,
              type: e.type,
              author: e.author,
              detail: e.detail,
              at: e.at,
              read: e.read,
            }))
          return [...restored, ...prev].sort((a, b) => a.at - b.at)
        })
      })
      .catch(() => {
        // Backend unavailable (e.g. plain Vite dev); start empty.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Lazy-load the next page of history: the newest OLDER_PAGE events older
  // than the oldest one already loaded.
  const loadOlder = useCallback(async () => {
    const before = oldestAtRef.current ?? Date.now()
    let stored: Awaited<ReturnType<typeof GetLiveEventsBefore>>
    try {
      stored = await GetLiveEventsBefore(before, OLDER_PAGE)
    } catch {
      return // Backend unavailable; leave hasMore as is for a retry.
    }
    const page = stored ?? []
    // A short page means history is exhausted.
    setHasMore(page.length === OLDER_PAGE)
    if (page.length === 0) return
    setEvents((prev) => {
      const seen = new Set(prev.map(keyOf))
      const restored: LiveEventItem[] = page
        .filter((e) => !seen.has(keyOf(e)))
        .map((e) => ({
          id: e.id,
          platform: e.platform,
          type: e.type,
          author: e.author,
          detail: e.detail,
          at: e.at,
          read: e.read,
        }))
      if (restored.length === 0) return prev
      return [...restored, ...prev].sort((a, b) => a.at - b.at)
    })
  }, [])

  const markAllRead = useCallback(() => {
    setEvents((prev) => {
      if (!prev.some((e) => !e.read)) return prev
      // Persist the read state so it survives restarts.
      MarkAllLiveEventsRead().catch(() => {})
      return prev.map((e) => (e.read ? e : {...e, read: true}))
    })
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

  // Periodic platform sync while any service is connected: the backend pulls
  // recent Twitch followers and YouTube subscribers, stores what's new, and
  // returns it — deduped against the database, so app restarts don't replay
  // history and events missed while closed are backfilled (already read).
  const anyConnected = anyChannelConnected(statuses)
  const anyLive = platforms.some((p) => p.live)
  useEffect(() => {
    if (!anyConnected) return
    let cancelled = false
    let timer: number | undefined
    const tick = async () => {
      try {
        const fresh = await SyncPlatformEvents()
        if (cancelled) return
        pushEvents(
          (fresh ?? []).map((e) => ({
            id: e.id,
            platform: e.platform,
            type: e.type,
            author: e.author,
            detail: e.detail,
            at: e.at,
            read: e.read,
          })),
        )
      } catch {
        // Transient API/auth trouble; try again next tick.
      }
      if (!cancelled) {
        timer = window.setTimeout(
          () => void tick(),
          anyLive ? SYNC_LIVE_MS : SYNC_IDLE_MS,
        )
      }
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [anyConnected, anyLive, pushEvents])

  const unreadCount = useMemo(
    () => events.reduce((n, e) => n + (e.read ? 0 : 1), 0),
    [events],
  )
  const value = useMemo<EventsContextValue>(
    () => ({events, unreadCount, markAllRead, pushEvents, hasMore, loadOlder, warnings}),
    [events, unreadCount, markAllRead, pushEvents, hasMore, loadOlder, warnings],
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

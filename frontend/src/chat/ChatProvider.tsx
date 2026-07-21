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
  GetFacebookLiveChat,
  GetInstagramLiveChat,
  GetKickChatIDs,
  GetSessionChatHistory,
  GetYouTubeLiveChat,
  MarkAllChatRead,
  SaveChatMessages,
  SendBroadcastChat,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useEvents} from '../events/EventsProvider'
import {useLiveData} from '../live/LiveDataProvider'
import {connectKickChat} from '../lib/kickChat'
import {connectTwitchChat} from '../lib/twitchChat'

/** One chat message, normalised across platforms. */
export interface ChatItem {
  id: string
  platform: string // 'twitch' | 'youtube' | 'kick' | 'broadcast' (sent from the app)
  author: string
  /** Platform user/channel id of the author; '' when unknown. */
  authorId: string
  /** Twitch login slug for API lookups; '' elsewhere. */
  authorLogin: string
  /** Author avatar (YouTube provides one per message); empty otherwise. */
  avatarUrl: string
  /** Normalised author badges ("Subscriber", "Moderator", "Member", ...). */
  badges: string[]
  text: string
  /**
   * The message with its platform emote markup intact (Kick's
   * "[emote:12345:catJAM]"), for displays that draw the emotes. Empty when
   * the line carries none — `text` is always the plain version, and the only
   * one persisted to the chat log.
   */
  richText?: string
  /** Author name colour (Twitch provides one); empty otherwise. */
  color: string
  /** Unix millis. */
  at: number
  /**
   * Whether the message has been seen: displayed on the Chat page while the
   * window was focused. Messages arriving while the app is unfocused or the
   * Chat page is closed stay unread until then.
   */
  read: boolean
}

/** Keep a bounded history so an active chat cannot grow without limit. */
const MAX_MESSAGES = 300
/**
 * New YouTube messages are polled every 15 seconds while live (history is
 * always served from the local log, never the API). Twitch needs no polling —
 * its IRC socket pushes messages instantly.
 */
const YT_POLL_MS = 15_000
/** Back-off when a YouTube chat poll fails. */
const YT_RETRY_MS = 15_000

interface ChatContextValue {
  messages: ChatItem[]
  /** True while at least one platform's chat is being read. */
  active: boolean
  /** Number of messages not yet seen on the Chat page. */
  unreadCount: number
  /** Mark every current message as read (the Chat page displayed them). */
  markAllRead: () => void
  /**
   * Send one message to every connected channel's chat as the broadcaster.
   * Resolves with each platform's outcome; a "broadcast" entry is appended to
   * the local feed when at least one platform accepted it.
   */
  sendBroadcast: (text: string) => Promise<main.BroadcastSendResult[]>
}

/** How long an outgoing broadcast suppresses its own platform echoes. */
const BROADCAST_ECHO_MS = 60_000

const ChatContext = createContext<ChatContextValue | undefined>(undefined)

/**
 * Aggregates live chat across every channel currently broadcasting: Twitch via
 * anonymous IRC, YouTube via Data-API polling through the Go backend. Mounted
 * app-wide so history survives navigation between views.
 */
export function ChatProvider({children}: {children: ReactNode}) {
  const {platforms} = useLiveData()
  // YouTube delivers channel events (members, Super Chats) through the chat
  // stream, so this provider forwards them to the Live Events feed.
  const {pushEvents} = useEvents()
  const [messages, setMessages] = useState<ChatItem[]>([])

  // Texts of recently sent broadcasts. The platforms echo our own message
  // back (IRC line, chat poll); those echoes are dropped so a broadcast shows
  // once, as a broadcast, rather than once per channel.
  const recentBroadcasts = useRef<{text: string; until: number}[]>([])

  // Identities of every message seen this session (and seeded from the local
  // log), so YouTube poll replays and restored history never duplicate.
  const seenKeys = useRef(new Set<string>())
  const keyOf = (m: {platform: string; id: string}) => `${m.platform}|${m.id}`

  const append = useCallback((items: ChatItem[]) => {
    if (items.length === 0) return
    const now = Date.now()
    recentBroadcasts.current = recentBroadcasts.current.filter(
      (b) => b.until > now,
    )
    const kept = items.filter(
      (m) =>
        !seenKeys.current.has(keyOf(m)) &&
        (m.platform === 'broadcast' ||
          !recentBroadcasts.current.some((b) => b.text === m.text.trim())),
    )
    if (kept.length === 0) return
    kept.forEach((m) => seenKeys.current.add(keyOf(m)))

    // Persist to the local chat log (fire-and-forget; the app still works
    // without storage). Existing rows keep their read state.
    SaveChatMessages(
      kept.map((m) => ({
        platform: m.platform,
        id: m.id,
        author: m.author,
        authorId: m.authorId,
        authorLogin: m.authorLogin,
        avatarUrl: m.avatarUrl,
        badges: m.badges,
        color: m.color,
        text: m.text,
        at: m.at,
        read: m.read,
      })),
    ).catch(() => {})

    setMessages((prev) => {
      const next = [...prev, ...kept]
      return next.length > MAX_MESSAGES
        ? next.slice(next.length - MAX_MESSAGES)
        : next
    })
  }, [])

  // Seed from the local log on launch — scoped to the active stream session,
  // so relaunching mid-broadcast restores that broadcast's chat (unread state
  // included) and nothing older. With no session open the feed starts empty:
  // a finished stream's chat belongs to its past-stream page, not here.
  useEffect(() => {
    let cancelled = false
    GetSessionChatHistory(MAX_MESSAGES)
      .then((stored) => {
        if (cancelled || !stored || stored.length === 0) return
        const restored: ChatItem[] = stored.map((m) => ({
          id: m.id,
          platform: m.platform,
          author: m.author,
          authorId: m.authorId,
          authorLogin: m.authorLogin,
          avatarUrl: m.avatarUrl,
          badges: m.badges ?? [],
          color: m.color,
          text: m.text,
          at: m.at,
          read: m.read,
        }))
        setMessages((prev) => {
          // Live messages may have landed before the log loaded; keep both,
          // oldest first, deduped by identity.
          const fresh = restored.filter((m) => !seenKeys.current.has(keyOf(m)))
          fresh.forEach((m) => seenKeys.current.add(keyOf(m)))
          const merged = [...fresh, ...prev].sort((a, b) => a.at - b.at)
          return merged.length > MAX_MESSAGES
            ? merged.slice(merged.length - MAX_MESSAGES)
            : merged
        })
      })
      .catch(() => {
        // Backend unavailable (e.g. plain Vite dev); start empty.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const markAllRead = useCallback(() => {
    setMessages((prev) => {
      if (!prev.some((m) => !m.read)) return prev
      // Persist the read state so it survives restarts.
      MarkAllChatRead().catch(() => {})
      return prev.map((m) => (m.read ? m : {...m, read: true}))
    })
  }, [])

  // Twitch: anonymous IRC while the channel is live.
  const twitchLogin =
    platforms.find((p) => p.platform === 'twitch' && p.live)?.channelLogin ?? ''
  useEffect(() => {
    if (!twitchLogin) return
    return connectTwitchChat(twitchLogin, (m) =>
      append([{...m, platform: 'twitch', avatarUrl: '', read: false}]),
    )
  }, [twitchLogin, append])

  // Kick: the public Pusher socket while the channel is live — chat messages
  // plus live events (follows, subs, gifted subs, hosts). The subscription
  // ids come from the backend (only kick.com's site API has them).
  const kickLive = platforms.some((p) => p.platform === 'kick' && p.live)
  useEffect(() => {
    if (!kickLive) return
    let cancelled = false
    let cleanup: (() => void) | undefined
    GetKickChatIDs()
      .then((ids) => {
        if (cancelled || !ids?.chatroomId) return
        cleanup = connectKickChat(
          ids,
          (m) => append([{...m, platform: 'kick', avatarUrl: '', read: false}]),
          (e) => pushEvents([{...e, platform: 'kick'}]),
        )
      })
      .catch(() => {
        // Chatroom unresolvable (Cloudflare block, offline); chat stays quiet.
      })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [kickLive, append, pushEvents])

  // YouTube: poll the live chat through the backend while broadcasting. The
  // first (token-less) page includes recent history.
  const youtubeLive = platforms.some((p) => p.platform === 'youtube' && p.live)
  useEffect(() => {
    if (!youtubeLive) return
    let cancelled = false
    let timer: number | undefined
    let pageToken = ''

    const tick = async () => {
      try {
        // The token-less first page replays recent history; count that as
        // already read so connecting does not produce a burst of "unread".
        const isHistoryPage = pageToken === ''
        const page = await GetYouTubeLiveChat(pageToken)
        if (cancelled) return
        if (page.live) {
          pageToken = page.nextPageToken
          append(
            (page.messages ?? []).map((m) => ({
              id: m.id,
              platform: m.platform,
              author: m.author,
              authorId: m.authorId,
              authorLogin: '',
              avatarUrl: m.avatarUrl,
              badges: m.badges ?? [],
              text: m.text,
              color: '',
              at: Date.parse(m.publishedAt) || Date.now(),
              read: isHistoryPage,
            })),
          )
          if (!isHistoryPage) {
            pushEvents(
              (page.events ?? []).map((e) => ({
                id: e.id,
                platform: e.platform,
                type: e.type,
                author: e.author,
                detail: e.detail,
                at: Date.parse(e.publishedAt) || Date.now(),
              })),
            )
          }
        } else if (pageToken !== '') {
          // The chat was flowing and is now gone: the broadcast ended. Stop
          // polling immediately instead of waiting for the platform poll to
          // notice; this effect restarts fresh if YouTube goes live again.
          return
        }
        timer = window.setTimeout(
          () => void tick(),
          Math.max(page.pollIntervalMs || 5_000, YT_POLL_MS),
        )
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(() => void tick(), YT_RETRY_MS)
        }
      }
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [youtubeLive, append, pushEvents])

  // Meta platforms: comments are polled through the backend while live. The
  // polls return the latest page each time; the provider's dedupe (seenKeys)
  // absorbs the overlap, and the first page counts as read history.
  const facebookLive = platforms.some(
    (p) => p.platform === 'facebook' && p.live,
  )
  useEffect(
    () =>
      facebookLive ? pollMetaChat(GetFacebookLiveChat, append) : undefined,
    [facebookLive, append],
  )
  const instagramLive = platforms.some(
    (p) => p.platform === 'instagram' && p.live,
  )
  useEffect(
    () =>
      instagramLive ? pollMetaChat(GetInstagramLiveChat, append) : undefined,
    [instagramLive, append],
  )

  const sendBroadcast = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return []
      // Arm the echo suppression BEFORE sending: Twitch's IRC echo of our own
      // message can arrive over the chat socket before the HTTP send call
      // resolves, and it must already be filtered by then.
      const entry = {text: trimmed, until: Date.now() + BROADCAST_ECHO_MS}
      recentBroadcasts.current.push(entry)
      let results: main.BroadcastSendResult[]
      try {
        results = await SendBroadcastChat(trimmed)
      } catch (err) {
        recentBroadcasts.current = recentBroadcasts.current.filter(
          (b) => b !== entry,
        )
        throw err
      }
      if (!results.some((r) => r.sent)) {
        // Nothing went out, so no echoes are coming; stop suppressing.
        recentBroadcasts.current = recentBroadcasts.current.filter(
          (b) => b !== entry,
        )
      } else {
        // Show it once in the feed as a broadcast; read by definition.
        append([
          {
            id: `broadcast-${Date.now()}`,
            platform: 'broadcast',
            author: 'Broadcast',
            authorId: '',
            authorLogin: '',
            avatarUrl: '',
            badges: [],
            text: trimmed,
            color: '',
            at: Date.now(),
            read: true,
          },
        ])
      }
      return results
    },
    [append],
  )

  const active =
    Boolean(twitchLogin) ||
    youtubeLive ||
    kickLive ||
    facebookLive ||
    instagramLive

  // The feed follows the broadcast: when the last live channel goes offline
  // the stream is over, and its chat now belongs to the past stream's page
  // (GetChatForStream) — clear the live feed instead of carrying it into the
  // next broadcast. seenKeys stays intact so nothing re-appends.
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && !active) setMessages([])
    wasActive.current = active
  }, [active])

  const unreadCount = useMemo(
    () => messages.reduce((n, m) => n + (m.read ? 0 : 1), 0),
    [messages],
  )
  const value = useMemo<ChatContextValue>(
    () => ({messages, active, unreadCount, markAllRead, sendBroadcast}),
    [messages, active, unreadCount, markAllRead, sendBroadcast],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

/**
 * Poll one Meta platform's live comments until cleaned up. Each poll returns
 * the newest page; the provider's identity dedupe absorbs the overlap. The
 * first page is treated as history (read), later pages as fresh messages.
 */
function pollMetaChat(
  fetchPage: () => Promise<main.LiveChatPage>,
  append: (items: ChatItem[]) => void,
): () => void {
  let cancelled = false
  let timer: number | undefined
  let first = true

  const tick = async () => {
    try {
      const page = await fetchPage()
      if (cancelled) return
      if (page.live) {
        const isHistoryPage = first
        first = false
        append(
          (page.messages ?? []).map((m) => ({
            id: m.id,
            platform: m.platform,
            author: m.author,
            authorId: m.authorId,
            // Instagram identifies chatters by username; the user popup
            // looks profiles up by it.
            authorLogin:
              m.platform === 'instagram' ? m.author.replace(/^@/, '') : '',
            avatarUrl: m.avatarUrl,
            badges: m.badges ?? [],
            text: m.text,
            color: '',
            at: Date.parse(m.publishedAt) || Date.now(),
            read: isHistoryPage,
          })),
        )
      }
      timer = window.setTimeout(
        () => void tick(),
        Math.max(page.pollIntervalMs || 10_000, 10_000),
      )
    } catch {
      if (!cancelled) {
        timer = window.setTimeout(() => void tick(), 15_000)
      }
    }
  }
  void tick()
  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}

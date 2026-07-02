import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {GetYouTubeLiveChat} from '../../wailsjs/go/main/App'
import {useLiveData} from '../live/LiveDataProvider'
import {connectTwitchChat} from '../lib/twitchChat'

/** One chat message, normalised across platforms. */
export interface ChatItem {
  id: string
  platform: string // 'twitch' | 'youtube'
  author: string
  text: string
  /** Author name colour (Twitch provides one); empty otherwise. */
  color: string
  /** Unix millis. */
  at: number
}

/** Keep a bounded history so an active chat cannot grow without limit. */
const MAX_MESSAGES = 300
/** Floor for the YouTube poll cadence, whatever the API suggests. */
const MIN_YT_POLL_MS = 3_000
/** Back-off when a YouTube chat poll fails. */
const YT_RETRY_MS = 15_000

interface ChatContextValue {
  messages: ChatItem[]
  /** True while at least one platform's chat is being read. */
  active: boolean
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined)

/**
 * Aggregates live chat across every channel currently broadcasting: Twitch via
 * anonymous IRC, YouTube via Data-API polling through the Go backend. Mounted
 * app-wide so history survives navigation between views.
 */
export function ChatProvider({children}: {children: ReactNode}) {
  const {platforms} = useLiveData()
  const [messages, setMessages] = useState<ChatItem[]>([])

  const append = useCallback((items: ChatItem[]) => {
    if (items.length === 0) return
    setMessages((prev) => {
      const next = [...prev, ...items]
      return next.length > MAX_MESSAGES
        ? next.slice(next.length - MAX_MESSAGES)
        : next
    })
  }, [])

  // Twitch: anonymous IRC while the channel is live.
  const twitchLogin =
    platforms.find((p) => p.platform === 'twitch' && p.live)?.channelLogin ?? ''
  useEffect(() => {
    if (!twitchLogin) return
    return connectTwitchChat(twitchLogin, (m) =>
      append([{...m, platform: 'twitch'}]),
    )
  }, [twitchLogin, append])

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
        const page = await GetYouTubeLiveChat(pageToken)
        if (cancelled) return
        if (page.live) {
          pageToken = page.nextPageToken
          append(
            (page.messages ?? []).map((m) => ({
              id: m.id,
              platform: m.platform,
              author: m.author,
              text: m.text,
              color: '',
              at: Date.parse(m.publishedAt) || Date.now(),
            })),
          )
        }
        timer = window.setTimeout(
          () => void tick(),
          Math.max(page.pollIntervalMs || 5_000, MIN_YT_POLL_MS),
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
  }, [youtubeLive, append])

  const active = Boolean(twitchLogin) || youtubeLive
  const value = useMemo<ChatContextValue>(
    () => ({messages, active}),
    [messages, active],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}

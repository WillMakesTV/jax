// Kick chat reader over Kick's public Pusher WebSocket. Chat rooms are
// broadcast on a public Pusher app (no authentication needed to read), keyed
// by the channel's chatroom id — resolved through the backend
// (GetKickChatroomID), since only kick.com's site API exposes it.

export interface KickChatMessage {
  id: string
  author: string
  /** Kick user id of the chatter; '' when absent. */
  authorId: string
  /** Channel slug of the chatter, for profile links. */
  authorLogin: string
  /** Normalised badge labels ("Broadcaster", "Moderator", "Subscriber", ...). */
  badges: string[]
  text: string
  /**
   * The message as Kick sent it, emote markup and all ("[emote:12345:catJAM]"),
   * so the display can draw the emotes. Empty when the line has none; `text`
   * stays the plain-language version everything else (the log, the AI, the
   * overlays) reads.
   */
  richText: string
  /** The chatter's Kick name colour ("#RRGGBB"), possibly empty. */
  color: string
  /** Unix millis the message was sent. */
  at: number
}

/**
 * A live event surfaced from the Kick sockets (follow, sub, gifted subs,
 * host), normalised to the app's event-feed vocabulary.
 */
export interface KickLiveEvent {
  id: string
  type: 'follow' | 'sub' | 'gift' | 'raid'
  author: string
  detail: string
  at: number
}

// Kick's production Pusher app key + cluster (public; embedded in kick.com).
const KICK_PUSHER_URL =
  'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false'
const RECONNECT_DELAY_MS = 5_000

/** Kick badge types worth surfacing, mapped to display labels. */
const BADGE_LABELS: Record<string, string> = {
  broadcaster: 'Broadcaster',
  moderator: 'Moderator',
  subscriber: 'Subscriber',
  founder: 'Founder',
  og: 'OG',
  vip: 'VIP',
  verified: 'Verified',
  staff: 'Kick Staff',
  sub_gifter: 'Sub Gifter',
}

/** Kick inlines emotes as "[emote:12345:catJAM]"; the name is the fallback. */
const emoteRe = /\[emote:\d+:([^\]]*)\]/g
/** The same marker, unanchored and non-global, for a stateless test. */
const hasEmoteRe = /\[emote:\d+:/

interface kickSender {
  id?: number
  username?: string
  slug?: string
  identity?: {
    color?: string
    badges?: {type?: string}[]
  }
}

/**
 * Join a channel's chatroom (chat + chatroom events) and channel feed
 * (follows), invoking onMessage per chat line and onEvent per live event.
 * Reconnects automatically until the returned cleanup function is called.
 */
export function connectKickChat(
  ids: {chatroomId: number; channelId: number},
  onMessage: (message: KickChatMessage) => void,
  onEvent?: (event: KickLiveEvent) => void,
): () => void {
  let ws: WebSocket | null = null
  let retry: number | undefined
  let closed = false

  const start = () => {
    if (closed) return
    ws = new WebSocket(KICK_PUSHER_URL)

    ws.onopen = () => {
      // Pusher accepts the subscribes immediately; public channels need no
      // auth. The chatroom carries chat/subs/gifts/hosts, the channel feed
      // carries follower updates.
      const subscribe = (channel: string) =>
        ws?.send(
          JSON.stringify({
            event: 'pusher:subscribe',
            data: {auth: '', channel},
          }),
        )
      subscribe(`chatrooms.${ids.chatroomId}.v2`)
      if (ids.channelId > 0 && onEvent) {
        subscribe(`channel.${ids.channelId}`)
      }
    }

    ws.onmessage = (event) => {
      let frame: {event?: string; data?: string}
      try {
        frame = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (frame.event === 'pusher:ping') {
        ws?.send(JSON.stringify({event: 'pusher:pong', data: {}}))
        return
      }
      if (!frame.data) return
      // Frame payloads are JSON-encoded strings.
      let data: Record<string, unknown>
      try {
        data = JSON.parse(frame.data)
      } catch {
        return
      }
      // Pusher event names carry the Laravel class path; keep the leaf.
      const name = (frame.event ?? '').split('\\').pop() ?? ''
      if (name === 'ChatMessageEvent') {
        handleChatMessage(data, onMessage)
      } else if (onEvent) {
        const live = toKickLiveEvent(name, data)
        if (live) onEvent(live)
      }
    }

    ws.onclose = () => {
      ws = null
      if (!closed) {
        retry = window.setTimeout(start, RECONNECT_DELAY_MS)
      }
    }
    ws.onerror = () => {
      ws?.close()
    }
  }

  start()
  return () => {
    closed = true
    window.clearTimeout(retry)
    ws?.close()
  }
}

/** Normalise one ChatMessageEvent payload into a chat message. */
function handleChatMessage(
  m: {
    id?: unknown
    content?: unknown
    created_at?: unknown
    sender?: kickSender
  },
  onMessage: (message: KickChatMessage) => void,
) {
  const sender = m.sender ?? {}
  const content = String(m.content ?? '')
  const badges: string[] = []
  for (const b of sender.identity?.badges ?? []) {
    const label = BADGE_LABELS[b.type ?? '']
    if (label && !badges.includes(label)) badges.push(label)
  }
  onMessage({
    id: typeof m.id === 'string' ? m.id : `kick-${Date.now()}-${Math.random()}`,
    author: sender.username || 'Unknown',
    authorId: sender.id ? String(sender.id) : '',
    authorLogin: sender.slug || '',
    badges,
    text: content.replace(emoteRe, '$1'),
    richText: hasEmoteRe.test(content) ? content : '',
    color: sender.identity?.color || '',
    at:
      typeof m.created_at === 'string'
        ? Date.parse(m.created_at) || Date.now()
        : Date.now(),
  })
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/**
 * Convert a Kick socket event into a feed event, or null to ignore. Mirrors
 * the vocabulary of twitchEventSub's toLiveEvent (follow/sub/gift/raid).
 */
function toKickLiveEvent(
  name: string,
  data: Record<string, unknown>,
): KickLiveEvent | null {
  const at = Date.now()
  switch (name) {
    case 'FollowersUpdated': {
      // Fires on both follow and unfollow; only announce follows, and only
      // when the follower is named.
      const username = str(data.username)
      if (!username || data.followed === false) return null
      return {
        // Deterministic identity so a re-broadcast of the same follow dedupes.
        id: `kickfollow:${username.toLowerCase()}`,
        type: 'follow',
        author: username,
        detail: 'followed the channel',
        at,
      }
    }
    case 'SubscriptionEvent': {
      const months = num(data.months)
      return {
        id: `kick-sub-${at}-${str(data.username)}`,
        type: 'sub',
        author: str(data.username) || 'Someone',
        detail: months > 1 ? `subscribed · ${months} months` : 'subscribed',
        at,
      }
    }
    case 'GiftedSubscriptionsEvent': {
      const gifted = Array.isArray(data.gifted_usernames)
        ? (data.gifted_usernames as unknown[]).map(str).filter(Boolean)
        : []
      return {
        id: `kick-gift-${at}`,
        type: 'gift',
        author: str(data.gifter_username) || 'Anonymous',
        detail: `gifted ${gifted.length || 'a'} sub${gifted.length === 1 ? '' : 's'}`,
        at,
      }
    }
    case 'StreamHostEvent': {
      const viewers = num(data.number_viewers)
      return {
        id: `kick-host-${at}`,
        type: 'raid',
        author: str(data.host_username) || 'A channel',
        detail: `hosted the channel${viewers > 0 ? ` with ${viewers} viewers` : ''}`,
        at,
      }
    }
  }
  return null
}

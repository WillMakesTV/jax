// Twitch EventSub over WebSocket. The socket lives here in the frontend
// (like Twitch chat's IRC and the OBS WebSocket); the Go backend creates the
// per-session subscriptions because they require the broadcaster's token.

/** One channel event, normalised for the Live Events feed. */
export interface TwitchLiveEvent {
  id: string
  type: string
  author: string
  detail: string
  at: number
}

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws'
const RECONNECT_DELAY_MS = 5_000

interface EventSubMessage {
  metadata?: {
    message_id?: string
    message_type?: string
    subscription_type?: string
  }
  payload?: {
    session?: {id?: string; reconnect_url?: string}
    event?: Record<string, unknown>
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** Convert an EventSub notification into a feed event, or null to ignore. */
function toLiveEvent(
  subscriptionType: string,
  id: string,
  event: Record<string, unknown>,
): TwitchLiveEvent | null {
  const base = {
    id,
    at: Date.now(),
    author: str(event.user_name) || str(event.user_login) || 'Anonymous',
  }
  const tier = () => {
    switch (str(event.tier)) {
      case '1000':
        return 'Tier 1'
      case '2000':
        return 'Tier 2'
      case '3000':
        return 'Tier 3'
      default:
        return ''
    }
  }
  switch (subscriptionType) {
    case 'channel.follow':
      return {
        ...base,
        // Deterministic identity shared with the backend's follower sync, so
        // a follow seen live and later re-listed by the poll stays one event.
        id: str(event.user_id) ? `follow:${str(event.user_id)}` : id,
        type: 'follow',
        detail: 'followed the channel',
      }
    case 'channel.subscribe': {
      const t = tier()
      return {
        ...base,
        type: 'sub',
        detail: event.is_gift
          ? `received a gifted sub${t ? ` (${t})` : ''}`
          : `subscribed${t ? ` (${t})` : ''}`,
      }
    }
    case 'channel.subscription.gift': {
      const total = num(event.total)
      const t = tier()
      return {
        ...base,
        author: event.is_anonymous ? 'Anonymous' : base.author,
        type: 'gift',
        detail: `gifted ${total || 'a'} sub${total === 1 ? '' : 's'}${t ? ` (${t})` : ''}`,
      }
    }
    case 'channel.subscription.message': {
      const months = num(event.cumulative_months)
      const message = event.message as {text?: string} | undefined
      let detail = `resubscribed${months ? ` · ${months} months` : ''}`
      if (message?.text) detail += ` — ${message.text}`
      return {...base, type: 'resub', detail}
    }
    case 'channel.cheer': {
      let detail = `cheered ${num(event.bits)} bits`
      if (str(event.message)) detail += ` — ${str(event.message)}`
      return {
        ...base,
        author: event.is_anonymous ? 'Anonymous' : base.author,
        type: 'cheer',
        detail,
      }
    }
    case 'channel.raid':
      return {
        id,
        at: Date.now(),
        author: str(event.from_broadcaster_user_name) || 'A channel',
        type: 'raid',
        detail: `raided with ${num(event.viewers)} viewers`,
      }
    default:
      return null
  }
}

/**
 * Open an EventSub session and keep it alive. `subscribe` is called with each
 * new session id and must create the subscriptions (via the backend); its
 * rejection is surfaced through onError. Returns a cleanup function.
 */
export function connectTwitchEventSub(
  onEvent: (event: TwitchLiveEvent) => void,
  subscribe: (sessionId: string) => Promise<void>,
  onError: (message: string) => void,
): () => void {
  let ws: WebSocket | null = null
  let retry: number | undefined
  let closed = false

  const start = (url: string) => {
    if (closed) return
    ws = new WebSocket(url)

    ws.onmessage = (raw) => {
      let msg: EventSubMessage
      try {
        msg = JSON.parse(String(raw.data)) as EventSubMessage
      } catch {
        return
      }
      const type = msg.metadata?.message_type
      if (type === 'session_welcome') {
        const sessionId = msg.payload?.session?.id
        if (sessionId) {
          subscribe(sessionId).catch((err) => {
            onError(
              err instanceof Error && err.message
                ? err.message
                : 'Could not subscribe to Twitch events.',
            )
          })
        }
      } else if (type === 'session_reconnect') {
        // Twitch asks us to migrate; the old socket closes on its own.
        const next = msg.payload?.session?.reconnect_url
        if (next) {
          const old = ws
          start(next)
          try {
            old?.close()
          } catch {
            // ignore
          }
        }
      } else if (type === 'notification') {
        const event = toLiveEvent(
          msg.metadata?.subscription_type ?? '',
          msg.metadata?.message_id || `${Date.now()}-${Math.random()}`,
          msg.payload?.event ?? {},
        )
        if (event) onEvent(event)
      }
      // session_keepalive needs no handling; arrival resets nothing here.
    }

    ws.onclose = (e) => {
      if (ws !== null && e.target !== ws) return // superseded by reconnect
      ws = null
      if (!closed) {
        retry = window.setTimeout(() => start(EVENTSUB_URL), RECONNECT_DELAY_MS)
      }
    }
    ws.onerror = () => {
      // onclose follows and handles the retry.
    }
  }

  start(EVENTSUB_URL)
  return () => {
    closed = true
    window.clearTimeout(retry)
    try {
      ws?.close()
    } catch {
      // ignore
    }
  }
}

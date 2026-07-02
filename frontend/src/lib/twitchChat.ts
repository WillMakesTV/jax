// Minimal anonymous Twitch chat reader over IRC-on-WebSocket. Twitch allows
// read-only access with a "justinfan" nick and no authentication, so no OAuth
// scope is needed to display chat.

export interface TwitchChatMessage {
  id: string
  author: string
  text: string
  /** The chatter's Twitch name colour ("#RRGGBB"), possibly empty. */
  color: string
  /** Unix millis the message was sent. */
  at: number
}

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'
const RECONNECT_DELAY_MS = 5_000

/** Parse an IRC v3 tag string ("a=1;b=2") into a map. */
function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) {
      // Unescape the characters IRCv3 tags encode.
      tags[part.slice(0, eq)] = part
        .slice(eq + 1)
        .replace(/\\s/g, ' ')
        .replace(/\\:/g, ';')
        .replace(/\\\\/g, '\\')
    }
  }
  return tags
}

// "@tags :nick!user@host PRIVMSG #channel :message"
const privmsgRe = /^@([^ ]+) :([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/

/**
 * Join a channel's chat anonymously and invoke onMessage for each chat line.
 * Reconnects automatically until the returned cleanup function is called.
 */
export function connectTwitchChat(
  login: string,
  onMessage: (message: TwitchChatMessage) => void,
): () => void {
  let ws: WebSocket | null = null
  let retry: number | undefined
  let closed = false

  const start = () => {
    if (closed) return
    ws = new WebSocket(TWITCH_IRC_URL)

    ws.onopen = () => {
      // Request tags (message ids, display names, colours) and identify with
      // an anonymous nick; no PASS is required for read-only access.
      ws?.send('CAP REQ :twitch.tv/tags')
      ws?.send(`NICK justinfan${Math.floor(Math.random() * 90000) + 10000}`)
      ws?.send(`JOIN #${login.toLowerCase()}`)
    }

    ws.onmessage = (event) => {
      for (const line of String(event.data).split('\r\n')) {
        if (!line) continue
        if (line.startsWith('PING')) {
          ws?.send('PONG :tmi.twitch.tv')
          continue
        }
        const match = privmsgRe.exec(line)
        if (!match) continue
        const tags = parseTags(match[1])
        onMessage({
          id: tags['id'] || `${Date.now()}-${Math.random()}`,
          author: tags['display-name'] || match[2],
          text: match[3],
          color: tags['color'] || '',
          at: Number(tags['tmi-sent-ts']) || Date.now(),
        })
      }
    }

    ws.onclose = () => {
      ws = null
      if (!closed) {
        retry = window.setTimeout(start, RECONNECT_DELAY_MS)
      }
    }
    ws.onerror = () => {
      // onclose follows and handles the retry.
    }
  }

  start()
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

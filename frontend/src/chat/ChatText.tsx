import {Fragment} from 'react'
import type {ChatItem} from './ChatProvider'

/**
 * Kick inlines its emotes in the message text as "[emote:12345:catJAM]".
 * The id addresses the image on Kick's file host; the name is the alt text
 * (and the fallback everywhere the picture cannot be drawn).
 */
const emoteRe = /\[emote:(\d+):([^\]]*)\]/g

const emoteURL = (id: string) => `https://files.kick.com/emotes/${id}/fullsize`

/**
 * One chat message's body: the text, with any platform emote markup drawn as
 * the emote itself. Messages without markup (every platform but Kick today,
 * and Kick lines that are only words) render as plain text.
 */
export function ChatText({message}: {message: ChatItem}) {
  const source = message.richText || ''
  if (!source) return <>{message.text}</>

  const parts: React.ReactNode[] = []
  let last = 0
  emoteRe.lastIndex = 0
  for (let m = emoteRe.exec(source); m; m = emoteRe.exec(source)) {
    if (m.index > last) parts.push(source.slice(last, m.index))
    parts.push(
      <img
        key={`${m.index}-${m[1]}`}
        src={emoteURL(m[1])}
        alt={m[2]}
        title={m[2]}
        className="inline-block h-6 w-auto align-text-bottom"
      />,
    )
    last = m.index + m[0].length
  }
  if (last < source.length) parts.push(source.slice(last))

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  )
}

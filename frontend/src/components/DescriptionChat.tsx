import clsx from 'clsx'
import {Send} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {main} from '../../wailsjs/go/models'

/** One prior turn of a description chat, kept only for the session. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'

/**
 * A description-building conversation, shown in a modal: each turn goes to
 * the connected AI service with the transcript, and the reply carries a full
 * rewrite of the description draft, which the caller drops into its editor.
 * The transcript lives in the parent so closing the dialog keeps it.
 */
export function DescriptionChat({
  messages,
  onMessages,
  onDescription,
  send,
  emptyHint,
}: {
  messages: ChatTurn[]
  onMessages: (update: (prev: ChatTurn[]) => ChatTurn[]) => void
  onDescription: (markdown: string) => void
  /** Run one turn against the backend with the prior history. */
  send: (
    history: main.ProjectChatMessage[],
    message: string,
  ) => Promise<main.ProjectChatReply>
  /** Shown before the first message. */
  emptyHint: string
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const sendMessage = async () => {
    const message = input.trim()
    if (!message || busy) return
    const history = messages
    onMessages((prev) => [...prev, {role: 'user', text: message}])
    setInput('')
    setBusy(true)
    setError('')
    try {
      const reply = await send(
        history.map((m) => main.ProjectChatMessage.createFrom(m)),
        message,
      )
      onMessages((prev) => [...prev, {role: 'assistant', text: reply.reply}])
      if (reply.description.trim()) onDescription(reply.description)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The chat could not respond.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div
        ref={scrollRef}
        className="flex max-h-[26rem] min-h-52 flex-col gap-2.5 overflow-y-auto pb-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-fg-muted">{emptyHint}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={clsx(
              'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
              m.role === 'user'
                ? 'self-end bg-accent text-accent-fg'
                : 'self-start border border-edge bg-bg text-fg',
            )}
          >
            {m.text}
          </div>
        ))}
        {busy && <p className="self-start text-sm text-fg-muted">Thinking…</p>}
      </div>

      {error && (
        <p className="pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void sendMessage()
        }}
        className="flex items-end gap-2 border-t border-edge pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendMessage()
            }
          }}
          rows={2}
          placeholder="Describe it…"
          className={`${field} resize-none`}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          title="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Send size={15} aria-hidden />
        </button>
      </form>
    </div>
  )
}

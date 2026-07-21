import {Ban, ExternalLink, Trash2, User} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  DeleteChatMessage,
  GetChatUserInfo,
  TimeoutChatUser,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {Modal} from '../components/Modal'
import {openExternal} from '../lib/browser'
import {formatDate} from '../lib/format'
import {platformName} from '../services/services'
import type {ChatItem} from './ChatProvider'
import {ChatText} from './ChatText'

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})

/** True when m was written by the same chatter as the popup's subject. */
export function sameChatAuthor(m: ChatItem, user: ChatItem): boolean {
  if (m.platform !== user.platform) return false
  if (user.authorId && m.authorId) return m.authorId === user.authorId
  return m.author === user.author
}

/**
 * Profile popup for one chatter: platform profile (cached lookup through the
 * backend), follower/subscriber status where the platform exposes it, badges
 * seen on their messages, and their recent messages in this chat.
 */
export function ChatUserModal({
  user,
  messages,
  onClose,
  onRemoved,
}: {
  /** The clicked message; identifies the chatter. Null = closed. */
  user: ChatItem | null
  /** Full chat history, for badge union + the user's recent messages. */
  messages: ChatItem[]
  onClose: () => void
  /** A message was removed from the platform's chat; drop it from the feed. */
  onRemoved?: (message: ChatItem) => void
}) {
  const [info, setInfo] = useState<main.ChatUserInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setInfo(null)
    setError('')
    setLoading(true)
    GetChatUserInfo(user.platform, user.authorId, user.authorLogin)
      .then((result) => {
        if (!cancelled) setInfo(result)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : 'Could not load this user.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // Timeouts, bans, and message removals run on the chatter's own platform
  // (see moderation.go); whatever it answers is shown beside the buttons
  // rather than swallowed.
  const [modBusy, setModBusy] = useState('')
  const [modNote, setModNote] = useState('')

  const moderate = async (seconds: number, label: string) => {
    if (!user) return
    setModBusy(label)
    setModNote(`${label}…`)
    try {
      await TimeoutChatUser(user.platform, user.authorId, seconds, '')
      setModNote(`${label} — done`)
    } catch (err) {
      setModNote(
        err instanceof Error && err.message ? err.message : `${label} failed.`,
      )
    } finally {
      setModBusy('')
    }
  }

  const removeMessage = async (m: ChatItem) => {
    setModNote('Removing…')
    try {
      await DeleteChatMessage(m.platform, m.id)
      setModNote('Message removed')
      onRemoved?.(m)
    } catch (err) {
      setModNote(
        err instanceof Error && err.message
          ? err.message
          : 'The message could not be removed.',
      )
    }
  }

  if (!user) return null

  const theirs = messages.filter((m) => sameChatAuthor(m, user))
  const badges = [...new Set(theirs.flatMap((m) => m.badges))]
  const recent = theirs.slice(-8)
  const avatar = info?.avatarUrl || user.avatarUrl

  // Subscriber/member status merges the API answer with what the chat badges
  // already prove (badges work even without the extra OAuth scopes).
  const badgeSaysSubscriber =
    badges.includes('Subscriber') || badges.includes('Founder')
  const subscriberValue =
    info?.subscriber === 'yes'
      ? `Yes${info.subTier ? ` · ${info.subTier}` : ''}`
      : badgeSaysSubscriber
        ? 'Yes'
        : info?.subscriber === 'no'
          ? 'No'
          : 'Not available'
  const followerValue =
    info?.follower === 'yes'
      ? `Yes${info.followedAt ? ` · since ${formatDate(info.followedAt)}` : ''}`
      : info?.follower === 'no'
        ? 'No'
        : 'Not available'

  return (
    <Modal
      open
      onClose={onClose}
      title={info?.displayName || user.author}
      icon={
        avatar ? (
          <img src={avatar} alt="" aria-hidden className="h-8 w-8 rounded-full" />
        ) : (
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-hover text-fg-muted"
          >
            <User size={16} />
          </span>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {/* Platform + badges seen on their chat messages. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted">
            <BrandTile platform={user.platform} size={14} />
            {platformName(user.platform)}
          </span>
          {badges.map((b) => (
            <span
              key={b}
              className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent"
            >
              {b}
            </span>
          ))}
        </div>

        {error && <p className="text-sm text-fg-muted">{error}</p>}
        {loading && !info && (
          <p className="text-sm text-fg-muted">Loading profile…</p>
        )}

        <dl className="divide-y divide-edge">
          {user.platform === 'twitch' && (
            <>
              <Row label="Follower" value={followerValue} />
              <Row label="Subscriber" value={subscriberValue} />
            </>
          )}
          {user.platform === 'youtube' && (
            <Row
              label="Channel member"
              value={badges.includes('Member') ? 'Yes' : 'Not visible in chat'}
            />
          )}
          {info?.createdAt && (
            <Row label="Account created" value={formatDate(info.createdAt)} />
          )}
          {(info?.details ?? []).map((d) => (
            <Row key={d.label} label={d.label} value={d.value} />
          ))}
        </dl>

        {info?.description && (
          <p className="line-clamp-3 text-sm text-fg-muted">{info.description}</p>
        )}

        {/* Their latest messages in this chat session. */}
        {recent.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Recent messages
            </p>
            <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-edge bg-bg p-3">
              {recent.map((m) => (
                <li
                  key={`${m.platform}-${m.id}`}
                  className="group flex items-start gap-2"
                >
                  <p className="min-w-0 flex-1 break-words text-sm leading-snug text-fg">
                    <ChatText message={m} />
                  </p>
                  <span className="shrink-0 pt-0.5 text-[10px] text-fg-muted">
                    {timeFmt.format(m.at)}
                  </span>
                  {/* Removing here removes it from the platform's chat too. */}
                  <button
                    type="button"
                    onClick={() => void removeMessage(m)}
                    title="Remove this message from chat"
                    aria-label="Remove this message from chat"
                    className="shrink-0 text-fg-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Moderation: applied on the chatter's own platform. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void moderate(600, 'Timeout 10m')}
            disabled={modBusy !== ''}
            className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Timeout 10m
          </button>
          <button
            type="button"
            onClick={() => void moderate(3600, 'Timeout 1h')}
            disabled={modBusy !== ''}
            className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Timeout 1h
          </button>
          <button
            type="button"
            onClick={() => void moderate(0, 'Ban')}
            disabled={modBusy !== ''}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/40 bg-red-600/10 px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-600/20 disabled:opacity-50 dark:text-red-400"
          >
            <Ban size={14} aria-hidden />
            Ban
          </button>
          {modNote && <span className="text-xs text-fg-muted">{modNote}</span>}
        </div>

        {info?.channelUrl && (
          <button
            type="button"
            onClick={() => openExternal(info.channelUrl)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-edge bg-bg px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
          >
            <ExternalLink size={16} aria-hidden />
            Open channel
          </button>
        )}
      </div>
    </Modal>
  )
}

function Row({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-right text-sm font-medium text-fg">
        {value}
      </dd>
    </div>
  )
}

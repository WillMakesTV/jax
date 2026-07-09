import {Bell, Captions, MessageSquare} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  GetChatForStream,
  GetLiveEventsForStream,
  GetTranscriptForStream,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EVENT_ICONS} from '../events/EventsPanel'
import {
  groupTranscriptLines,
  type TranscriptLine,
} from '../transcript/TranscriptProvider'
import {TranscribeVideoButton} from '../transcript/TranscribeVideoButton'
import {useVodTranscribe} from '../transcript/VodTranscribeProvider'
import {BrandTile} from './BrandTile'

// ---------------------------------------------------------------------------
// Shared chat + transcript panels for a stream's time window, used by both the
// aggregated past-stream page (StreamDetails) and the per-broadcast video page
// (DownloadVideo). The chat log is global, so a panel scopes it by window and,
// optionally, by platform.
// ---------------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

/** What the panel describes; only affects copy in empty states. */
type MediaNoun = 'broadcast' | 'stream'

export function MediaEmptyState({
  icon: Icon,
  text,
}: {
  icon: typeof Captions
  text: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-edge bg-surface p-8 text-center">
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
      >
        <Icon size={24} />
      </span>
      <p className="max-w-sm text-sm text-fg-muted">{text}</p>
    </div>
  )
}

/**
 * The chat captured during a stream's window. With `platform` set only that
 * channel's messages show (a single broadcast's chat); without it the log is
 * the unified chat across every connected channel.
 */
export function ChatLogPanel({
  startedAt,
  durationSecs,
  platform,
  noun = 'broadcast',
}: {
  startedAt: string
  durationSecs: number
  /** Restrict to one platform's chat; omit for the unified log. */
  platform?: string
  noun?: MediaNoun
}) {
  const [messages, setMessages] = useState<main.StoredChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    GetChatForStream(startedAt, durationSecs)
      .then((r) => {
        if (!cancelled) setMessages(r ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [startedAt, durationSecs])

  const visible = platform
    ? messages.filter((m) => m.platform === platform)
    : messages

  if (!loaded) return <p className="text-sm text-fg-muted">Loading chat…</p>
  if (visible.length === 0) {
    return (
      <MediaEmptyState
        icon={MessageSquare}
        text={`No chat was captured during this ${noun}'s window.`}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge bg-surface p-4">
      <ul className="space-y-2">
        {visible.map((m) => (
          <li
            key={`${m.platform}-${m.id}`}
            className="flex items-start gap-2 text-sm"
          >
            <BrandTile platform={m.platform} size={14} />
            <span className="min-w-0 flex-1 break-words leading-relaxed">
              <span
                className="font-semibold"
                style={m.color ? {color: m.color} : undefined}
              >
                {m.author}
              </span>
              <span className="text-fg-muted">: </span>
              <span className="text-fg">{m.text}</span>
            </span>
            <span
              className="shrink-0 font-mono text-[11px] text-fg-muted"
              title={new Date(m.at).toLocaleString()}
            >
              {timeFmt.format(m.at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The channel events (follows, subs, cheers, raids, members, Super Chats)
 * captured during a stream's window, across every destination channel.
 */
export function EventsLogPanel({
  startedAt,
  durationSecs,
  noun = 'broadcast',
}: {
  startedAt: string
  durationSecs: number
  noun?: MediaNoun
}) {
  const [events, setEvents] = useState<main.StoredLiveEvent[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    GetLiveEventsForStream(startedAt, durationSecs)
      .then((r) => {
        if (!cancelled) setEvents(r ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [startedAt, durationSecs])

  if (!loaded) return <p className="text-sm text-fg-muted">Loading events…</p>
  if (events.length === 0) {
    return (
      <MediaEmptyState
        icon={Bell}
        text={`No channel events were captured during this ${noun}'s window.`}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge bg-surface p-4">
      <ul className="space-y-2">
        {events.map((e) => {
          const Icon = EVENT_ICONS[e.type] ?? Bell
          return (
            <li
              key={`${e.platform}-${e.id}`}
              className="flex items-start gap-3 rounded-lg border border-edge bg-bg p-3"
            >
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
              >
                <Icon size={16} />
              </span>
              <p className="min-w-0 flex-1 break-words text-sm leading-snug">
                <span className="font-semibold text-fg">{e.author}</span>{' '}
                <span className="text-fg">{e.detail}</span>
              </p>
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-fg-muted">
                <BrandTile platform={e.platform} size={14} />
                <span title={new Date(e.at).toLocaleString()}>
                  {timeFmt.format(e.at)}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The stored transcript matched to a stream by start-time. When `subfolder`
 * names a downloaded copy, the transcribe button offers to (re)produce the
 * transcript from that video's audio.
 */
export function TranscriptPanel({
  startedAt,
  subfolder,
  noun = 'broadcast',
}: {
  startedAt: string
  /** The downloaded copy's subfolder; enables the transcribe action. */
  subfolder?: string
  noun?: MediaNoun
}) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [loaded, setLoaded] = useState(false)
  // Re-query when a transcription run replaces the stored transcript.
  const {version} = useVodTranscribe()

  useEffect(() => {
    let cancelled = false
    GetTranscriptForStream(startedAt)
      .then((r) => {
        if (!cancelled) setLines(groupTranscriptLines(r ?? []))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [startedAt, version])

  if (!loaded)
    return <p className="text-sm text-fg-muted">Loading transcript…</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {lines.length > 0
            ? `Transcript matched to this ${noun}.`
            : `No transcript is stored for this ${noun} yet.`}
        </p>
        {subfolder && (
          <TranscribeVideoButton
            subfolder={subfolder}
            hasTranscript={lines.length > 0}
          />
        )}
      </div>
      {lines.length === 0 ? (
        <MediaEmptyState
          icon={Captions}
          text={
            subfolder
              ? `No transcript was captured during this ${noun}. Generate one from the downloaded video's audio.`
              : `No transcript was captured during this ${noun}. Download the video to generate one from its audio.`
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge bg-surface p-4">
          <ul className="space-y-3">
            {lines.map((line) => (
              <li key={line.id} className="flex items-start gap-3">
                <span
                  className="shrink-0 pt-0.5 font-mono text-[11px] text-fg-muted"
                  title={new Date(line.at).toLocaleString()}
                >
                  {timeFmt.format(line.at)}
                </span>
                <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-fg">
                  {line.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

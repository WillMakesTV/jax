import {ArrowLeft, Captions, MessageSquare, PlaySquare} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  GetChatForStream,
  GetTranscriptForStream,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {formatCompact, formatDate} from '../lib/format'
import {
  groupTranscriptLines,
  type TranscriptLine,
} from '../transcript/TranscriptProvider'

type VideoTab = 'video' | 'chat' | 'transcript'

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * A downloaded broadcast's page: the embedded local video with tabs for the
 * chat and transcript captured during the stream.
 */
export function DownloadVideo({
  download,
  onBack,
}: {
  download: main.DownloadedVideo
  onBack: () => void
}) {
  const [tab, setTab] = useState<VideoTab>('video')

  const tabs: {id: VideoTab; label: string; icon: typeof PlaySquare}[] = [
    {id: 'video', label: 'Video', icon: PlaySquare},
    {id: 'chat', label: 'Chat', icon: MessageSquare},
    {id: 'transcript', label: 'Transcript', icon: Captions},
  ]

  const meta = [
    formatDate(download.startedAt),
    download.viewCount > 0 ? `${formatCompact(download.viewCount)} views` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back
      </button>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <BrandTile platform={download.platform} size={16} />
          {[download.channelName, meta].filter(Boolean).join(' · ')}
        </p>
        <div
          role="tablist"
          aria-label="Video sections"
          className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <t.icon size={14} aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'video' && (
        <div className="overflow-hidden rounded-2xl border border-edge bg-black">
          <video
            key={download.mediaUrl}
            controls
            autoPlay
            poster={download.thumbnailUrl || undefined}
            src={download.mediaUrl}
            className="aspect-video w-full bg-black"
          />
        </div>
      )}
      {tab === 'chat' && <ChatTab download={download} />}
      {tab === 'transcript' && <TranscriptTab download={download} />}
    </div>
  )
}

function ChatTab({download}: {download: main.DownloadedVideo}) {
  const [messages, setMessages] = useState<main.StoredChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    GetChatForStream(download.startedAt, download.durationSecs)
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
  }, [download.startedAt, download.durationSecs])

  if (!loaded) return <p className="text-sm text-fg-muted">Loading chat…</p>
  if (messages.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        text="No chat was captured during this broadcast's window."
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge bg-surface p-4">
      <ul className="space-y-2">
        {messages.map((m) => (
          <li key={`${m.platform}-${m.id}`} className="flex items-start gap-2 text-sm">
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

function TranscriptTab({download}: {download: main.DownloadedVideo}) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    GetTranscriptForStream(download.startedAt)
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
  }, [download.startedAt])

  if (!loaded)
    return <p className="text-sm text-fg-muted">Loading transcript…</p>
  if (lines.length === 0) {
    return (
      <EmptyState
        icon={Captions}
        text="No transcript was captured for this broadcast."
      />
    )
  }

  return (
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
  )
}

function EmptyState({
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

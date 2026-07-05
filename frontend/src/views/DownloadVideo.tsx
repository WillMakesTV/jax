import {ArrowLeft, Captions, MessageSquare, PlaySquare} from 'lucide-react'
import clsx from 'clsx'
import {useState} from 'react'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {
  ChatLogPanel,
  TranscriptPanel,
} from '../components/StreamMedia'
import {formatCompact, formatDate} from '../lib/format'

type VideoTab = 'video' | 'chat' | 'transcript'

/**
 * A downloaded broadcast's page: the embedded local video with tabs for the
 * chat and transcript captured during the stream. The chat here is only this
 * broadcast's channel — the unified cross-channel chat lives on the stream's
 * details page.
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
      {tab === 'chat' && (
        <ChatLogPanel
          startedAt={download.startedAt}
          durationSecs={download.durationSecs}
          platform={download.platform}
        />
      )}
      {tab === 'transcript' && (
        <TranscriptPanel
          startedAt={download.startedAt}
          subfolder={download.subfolder}
        />
      )}
    </div>
  )
}

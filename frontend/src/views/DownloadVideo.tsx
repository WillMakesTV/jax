import {
  ArrowLeft,
  Captions,
  MessageSquare,
  PlaySquare,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import {useState} from 'react'
import {DeleteLocalStream} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {Modal} from '../components/Modal'
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

  // Deleting removes the local files (and, for a stream the platforms no
  // longer list, the stream itself); chat and transcript stay stored.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const remove = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      await DeleteLocalStream(download.subfolder)
      onBack()
    } catch (err) {
      setDeleteError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not delete the download.',
      )
      setDeleting(false)
    }
  }

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
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          title="Delete the downloaded video files from this computer."
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/40 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
        >
          <Trash2 size={14} aria-hidden />
          Delete download
        </button>
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
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this download?"
        icon={<Trash2 size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          The downloaded video files for “{download.title || 'this broadcast'}”
          are removed from your computer. If its platforms no longer list the
          broadcast, the stream leaves your history too; stored chat and
          transcript are kept either way.
        </p>
        {deleteError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {deleteError}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={deleting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete download'}
          </button>
        </div>
      </Modal>

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

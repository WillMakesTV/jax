import {
  AlertTriangle,
  Clapperboard,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState} from 'react'
import {
  DeleteInspirationVideo,
  GetInspirationVideos,
  ProcessInspirationVideo,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {PageHeader} from '../components/PageHeader'
import {openExternal} from '../lib/browser'
import {useDataChanged} from '../lib/dataChanged'
import {formatCompact} from '../lib/format'
import {
  AddInspirationModal,
  clock,
  inspirationError,
  videoMeta,
} from './Inspiration'

/** How each pipeline state reads on a card. */
const STATUS_LABELS: Record<string, string> = {
  tracked: 'Not downloaded',
  downloading: 'Downloading',
  transcribing: 'Transcribing',
  analyzing: 'Studying',
  ready: 'Studied',
  error: 'Failed',
}

/** True while the pipeline is working on this video. */
export function isWorking(status: string): boolean {
  return (
    status === 'downloading' ||
    status === 'transcribing' ||
    status === 'analyzing'
  )
}

/**
 * One inspiration channel: the videos indexed from it, in the same card
 * language the Videos section uses. Tracked videos carry a Download CTA that
 * runs the download → transcribe → study pipeline.
 */
export function InspirationChannelDetails({
  channel,
  onOpenVideo,
}: {
  channel: main.InspirationChannel
  /** Open one video's manifest page. */
  onOpenVideo: (video: main.InspirationVideo) => void
}) {
  const [videos, setVideos] = useState<main.InspirationVideo[]>([])
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(() => {
    GetInspirationVideos(channel.id)
      .then((v) => setVideos(v ?? []))
      .catch(() => {})
  }, [channel.id])

  useEffect(load, [load])
  useDataChanged(['inspiration'], load)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        description={
          channel.handle
            ? `${channel.handle} — ${videos.length} indexed video${videos.length === 1 ? '' : 's'}`
            : `${videos.length} indexed video${videos.length === 1 ? '' : 's'}`
        }
        actions={
          <div className="flex items-center gap-2">
            {channel.url && (
              <button
                type="button"
                onClick={() => openExternal(channel.url)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                <ExternalLink size={14} aria-hidden />
                Open on YouTube
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={14} aria-hidden />
              Add video
            </button>
          </div>
        }
      />

      {videos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
          Nothing indexed from this channel yet. Add a video to download,
          transcribe, and break it down.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} onOpen={() => onOpenVideo(v)} />
          ))}
        </ul>
      )}

      <AddInspirationModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function VideoCard({
  video,
  onOpen,
}: {
  video: main.InspirationVideo
  onOpen: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const working = isWorking(video.status)
  const thumb = video.thumbUrl || video.thumbnailUrl

  const download = async () => {
    setBusy(true)
    setError('')
    try {
      await ProcessInspirationVideo(video.id)
    } catch (err) {
      setError(inspirationError(err, 'That video could not be downloaded.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    try {
      await DeleteInspirationVideo(video.id)
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-edge bg-surface text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
      >
        <div className="relative">
          {thumb ? (
            <img
              src={thumb}
              alt={`${video.title || 'Untitled video'} thumbnail`}
              className="aspect-video w-full object-cover"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
              <Clapperboard size={28} aria-hidden />
            </div>
          )}
          {video.durationSecs > 0 && (
            <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {clock(video.durationSecs)}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-4">
          <p className="line-clamp-2 text-sm font-semibold text-fg">
            {video.title || 'Untitled video'}
          </p>
          {videoMeta(video) && (
            <p className="mt-1 text-xs text-fg-muted">{videoMeta(video)}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill video={video} />
            {video.views > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <Eye size={12} aria-hidden />
                {formatCompact(video.views)}
              </span>
            )}
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            {!working && video.status !== 'ready' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void download()
                }}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={12} aria-hidden className="animate-spin" />
                ) : (
                  <Download size={12} aria-hidden />
                )}
                {video.status === 'error' ? 'Try again' : 'Download & study'}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void remove()
              }}
              title="Remove this video"
              aria-label="Remove this video"
              className="ml-auto text-fg-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

/** The pipeline's state as a pill, with progress while it runs. */
export function StatusPill({video}: {video: main.InspirationVideo}) {
  const label = STATUS_LABELS[video.status] ?? video.status
  const working = isWorking(video.status)
  const detail =
    video.status === 'downloading' && video.progress > 0
      ? ` ${video.progress}%`
      : video.status === 'transcribing' && video.progress > 0
        ? ` ${clock(video.progress)}`
        : ''

  return (
    <span
      title={video.statusDetail || undefined}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        video.status === 'ready' && 'bg-accent/15 text-accent',
        video.status === 'error' &&
          'bg-red-500/15 text-red-600 dark:text-red-400',
        working && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        video.status === 'tracked' && 'border border-edge bg-bg text-fg-muted',
      )}
    >
      {working && <Loader2 size={11} aria-hidden className="animate-spin" />}
      {video.status === 'ready' && <Sparkles size={11} aria-hidden />}
      {video.status === 'error' && <AlertTriangle size={11} aria-hidden />}
      {label}
      {detail}
    </span>
  )
}

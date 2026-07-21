import {
  AlertTriangle,
  Clapperboard,
  ExternalLink,
  Eye,
  Link2,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState} from 'react'
import {
  DeleteInspirationVideo,
  GetInspirationChannel,
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
  tracked: 'Not processed',
  queued: 'Queued',
  downloading: 'Downloading',
  transcribing: 'Transcribing',
  analyzing: 'Studying',
  extracting: 'Extracting takeaways',
  ready: 'Studied',
  error: 'Failed',
}

/** True while the pipeline is working on this video. */
export function isWorking(status: string): boolean {
  return (
    status === 'queued' ||
    status === 'downloading' ||
    status === 'transcribing' ||
    status === 'analyzing' ||
    status === 'extracting'
  )
}

/**
 * One inspiration channel: the videos indexed from it, in the same card
 * language the Videos section uses. Tracked videos carry a Process CTA that
 * runs the whole pipeline: download, transcribe, study, extract takeaways.
 */
export function InspirationChannelDetails({
  channel: initial,
  onOpenVideo,
}: {
  channel: main.InspirationChannel
  /** Open one video's manifest page. */
  onOpenVideo: (video: main.InspirationVideo) => void
}) {
  const [channel, setChannel] = useState(initial)
  const [videos, setVideos] = useState<main.InspirationVideo[]>([])
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(() => {
    GetInspirationVideos(initial.id)
      .then((v) => setVideos(v ?? []))
      .catch(() => {})
    // Indexing a video refreshes the channel's own branding and metrics
    // behind the page, so re-read it alongside the videos.
    GetInspirationChannel(initial.id)
      .then(setChannel)
      .catch(() => {})
  }, [initial.id])

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

      <ChannelHero channel={channel} videoCount={videos.length} />

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

/**
 * The channel at the top of its page: its banner, avatar, what it says about
 * itself, the numbers the platform reports, and the links it publishes —
 * everything the indexer could pull in.
 */
function ChannelHero({
  channel,
  videoCount,
}: {
  channel: main.InspirationChannel
  videoCount: number
}) {
  const stats = [
    channel.subscribers > 0
      ? `${formatCompact(channel.subscribers)} subscribers`
      : '',
    channel.videoCount > 0
      ? `${formatCompact(channel.videoCount)} videos published`
      : '',
    `${videoCount} indexed here`,
  ].filter(Boolean)

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-edge bg-surface">
      {channel.bannerUrl && (
        <img
          src={channel.bannerUrl}
          alt={`${channel.name} banner`}
          className="h-28 w-full object-cover sm:h-40"
        />
      )}
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        {channel.avatarUrl && (
          <img
            src={channel.avatarUrl}
            alt={`${channel.name} avatar`}
            className="h-16 w-16 shrink-0 rounded-full border border-edge object-cover sm:h-20 sm:w-20"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-fg">
              {channel.name}
            </span>
            {channel.handle && (
              <span className="text-sm text-fg-muted">{channel.handle}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <Users size={12} aria-hidden />
              {stats.join(' · ')}
            </span>
          </div>
          {channel.description && (
            <p className="line-clamp-4 whitespace-pre-wrap text-sm text-fg-muted">
              {channel.description}
            </p>
          )}
          {channel.links.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {channel.links.map((l, i) => (
                <li key={`${l.url}-${i}`}>
                  <button
                    type="button"
                    onClick={() => openExternal(l.url)}
                    title={l.url}
                    className="inline-flex items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    <Link2 size={11} aria-hidden />
                    {l.label || l.url}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {channel.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {channel.tags.slice(0, 10).map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-edge bg-bg px-2 py-0.5 text-xs text-fg-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
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

  const process = async () => {
    setBusy(true)
    setError('')
    try {
      await ProcessInspirationVideo(video.id)
    } catch (err) {
      setError(inspirationError(err, 'That video could not be processed.'))
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
                  void process()
                }}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={12} aria-hidden className="animate-spin" />
                ) : (
                  <Play size={12} aria-hidden />
                )}
                {video.status === 'error' ? 'Try again' : 'Process'}
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

import {Clapperboard, Eye, RefreshCw} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState} from 'react'
import {GetVideos} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {PageHeader} from '../components/PageHeader'
import {PlatformPill} from '../components/PlatformPill'
import {formatAgo, formatCompact, formatDate} from '../lib/format'
import {useServices} from '../services/ServicesProvider'

interface VideosProps {
  /** Open the details view for one video. */
  onOpenVideo: (video: main.Video) => void
}

/** Visibility filter options; "public" is the default view. */
const STATUS_FILTERS = [
  {id: 'public', label: 'Public'},
  {id: 'unlisted', label: 'Unlisted'},
  {id: 'private', label: 'Private'},
  {id: 'all', label: 'All'},
] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]['id']

/** A video's visibility; entries predating the field count as public. */
const statusOf = (v: main.Video) => v.status || 'public'

/**
 * All videos/VODs from the connected channels, aggregated newest-first.
 * Results come from the backend's 1-hour API cache; the refresh CTA forces a
 * fresh fetch.
 */
export function Videos({onOpenVideo}: VideosProps) {
  const {statuses} = useServices()
  const [list, setList] = useState<main.VideoList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('public')

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    setError('')
    try {
      setList(await GetVideos(force))
    } catch {
      setError('Could not load videos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const oauthConnected = statuses.twitch.connected || statuses.youtube.connected
  const allVideos = list?.videos ?? []
  const videos = allVideos.filter(
    (v) => statusFilter === 'all' || statusOf(v) === statusFilter,
  )

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Videos"
        description="Every video and VOD from your connected channels, in one place."
        actions={
          <div className="flex items-center gap-3">
            {list?.fetchedAt && (
              <span className="text-xs text-fg-muted">
                Updated {formatAgo(list.fetchedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              title="Fetch the latest data from the platforms"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              <RefreshCw
                size={14}
                aria-hidden
                className={clsx(loading && 'animate-spin')}
              />
              Refresh
            </button>
          </div>
        }
      />

      {error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Visibility filter. Public-only by default. */}
      {allVideos.length > 0 && (
        <div
          role="group"
          aria-label="Filter videos by visibility"
          className="mb-4 flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
        >
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              aria-pressed={statusFilter === f.id}
              className={clsx(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                statusFilter === f.id
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {loading && allVideos.length === 0 ? (
        <p className="text-sm text-fg-muted">Loading videos…</p>
      ) : allVideos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Clapperboard size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">
            {oauthConnected ? 'No videos yet' : 'No services connected'}
          </p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            {oauthConnected
              ? 'Videos and VODs on your connected channels will appear here.'
              : 'Connect Twitch or YouTube in Settings → Services to see your videos here.'}
          </p>
        </div>
      ) : videos.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No{' '}
          {STATUS_FILTERS.find((f) => f.id === statusFilter)?.label.toLowerCase()}{' '}
          videos on your channels.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <VideoCard
              key={`${v.platform}-${v.id}`}
              video={v}
              onOpen={() => onOpenVideo(v)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VideoCard({
  video,
  onOpen,
}: {
  video: main.Video
  onOpen: () => void
}) {
  const meta = [
    formatDate(video.publishedAt),
    video.kind,
    video.viewCount > 0 ? `${formatCompact(video.viewCount)} views` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open details for ${video.title || 'untitled video'}`}
      className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface text-left transition-colors hover:bg-surface-hover"
    >
      <div className="relative">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={`${video.title || 'Untitled video'} thumbnail`}
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
            <Clapperboard size={28} aria-hidden />
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {video.duration}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="line-clamp-2 text-sm font-semibold text-fg">
          {video.title || 'Untitled video'}
        </p>
        {meta && <p className="mt-1 text-xs text-fg-muted">{meta}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Host channel tag. */}
          <PlatformPill
            platform={video.platform}
            label={video.channelName || undefined}
          />
          {/* Visibility badge; public is the norm, so only flag the rest. */}
          {statusOf(video) !== 'public' && (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium capitalize text-amber-600 dark:text-amber-400">
              {statusOf(video)}
            </span>
          )}
          {video.viewCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <Eye size={12} aria-hidden />
              {formatCompact(video.viewCount)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

import {
  ArrowLeft,
  BarChart3,
  Clapperboard,
  Clock,
  ExternalLink,
  Eye,
  Radio,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {GetChannelVideos} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {LiveBadge} from '../live/LiveOverview'
import {useLiveData} from '../live/LiveDataProvider'
import {openExternal} from '../lib/browser'
import {formatCompact, formatDate, formatNumber, formatUptime} from '../lib/format'
import {platformName} from '../services/services'

interface ChannelDetailsProps {
  /** The connected platform whose channel to show ('twitch' | 'youtube' | 'kick'). */
  platform: string
  onBack: () => void
  /** Open one of the channel's videos in the video details view. */
  onOpenVideo: (video: main.Video) => void
}

/**
 * Detail page for one connected channel: live status, channel-level analytics
 * (followers/subscribers/views/…), links out, and the channel's recent
 * videos. Reads from the shared live-data poll so metrics stay current.
 */
export function ChannelDetails({
  platform,
  onBack,
  onOpenVideo,
}: ChannelDetailsProps) {
  const {platforms} = useLiveData()
  const stream = platforms.find((p) => p.platform === platform)

  if (!stream) {
    return (
      <div className="flex flex-col">
        <BackButton onBack={onBack} />
        <p className="text-sm text-fg-muted">
          This channel is no longer connected.
        </p>
      </div>
    )
  }

  const name = stream.channelName || platformName(platform)

  return (
    <div className="flex flex-col">
      <BackButton onBack={onBack} />

      <ChannelHero stream={stream} name={name} platform={platform} />

      {stream.error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">
          {stream.error}
        </p>
      )}

      {/* Live now: preview + real-time metrics. */}
      {stream.live && (
        <section
          aria-label="Live now"
          className="mb-8 flex flex-col gap-4 lg:flex-row"
        >
          <div className="w-full max-w-md shrink-0">
            {stream.thumbnailUrl ? (
              <img
                src={stream.thumbnailUrl}
                alt="Live stream preview"
                className="aspect-video w-full rounded-xl border border-edge object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-edge bg-surface text-fg-muted">
                <Radio size={32} aria-hidden />
              </div>
            )}
          </div>
          <div className="grid flex-1 grid-cols-2 content-start gap-4">
            <Tile
              icon={Eye}
              label="Watching now"
              value={formatNumber(stream.viewerCount)}
            />
            <Tile
              icon={Clock}
              label="Uptime"
              value={formatUptime(stream.startedAt)}
            />
            <Tile
              icon={Radio}
              label="Category"
              value={stream.category || '—'}
            />
            <Tile
              icon={BarChart3}
              label="Title"
              value={stream.title || 'Untitled broadcast'}
            />
          </div>
        </section>
      )}

      {/* Channel analytics from the live poll's detail list. */}
      {(stream.details ?? []).length > 0 && (
        <section aria-label="Analytics" className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            <BarChart3 size={16} aria-hidden />
            Channel analytics
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {(stream.details ?? []).map((d) => (
              <div
                key={d.label}
                className="rounded-xl border border-edge bg-surface p-4"
              >
                <p className="text-xs font-medium text-fg-muted">{d.label}</p>
                <p className="mt-1 truncate text-xl font-semibold text-fg">
                  {d.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Links out. */}
      <div className="mb-8 flex flex-wrap gap-3">
        {stream.live && stream.streamUrl && (
          <button
            type="button"
            onClick={() => openExternal(stream.streamUrl)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <ExternalLink size={16} aria-hidden />
            Watch stream
          </button>
        )}
        {stream.channelUrl && (
          <button
            type="button"
            onClick={() => openExternal(stream.channelUrl)}
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
          >
            <ExternalLink size={16} aria-hidden />
            Open channel
          </button>
        )}
      </div>

      <RecentVideos platform={platform} onOpenVideo={onOpenVideo} />
    </div>
  )
}

/**
 * Branded hero for a channel: the remote banner as a backdrop with the
 * channel's avatar, name, platform, and live status overlaid.
 */
function ChannelHero({
  stream,
  name,
  platform,
}: {
  stream: main.LiveStream
  name: string
  platform: string
}) {
  return (
    <section
      aria-label="Channel"
      className="mb-8 overflow-hidden rounded-2xl border border-edge bg-surface"
    >
      {/* Banner backdrop: the channel banner, else a blurred avatar, else a
          brand-tinted gradient. */}
      <div className="relative h-28 w-full overflow-hidden bg-surface-hover sm:h-40">
        {stream.bannerUrl ? (
          <img
            src={stream.bannerUrl}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
          />
        ) : stream.avatarUrl ? (
          <img
            src={stream.avatarUrl}
            alt=""
            aria-hidden
            className="h-full w-full scale-110 object-cover opacity-40 blur-2xl"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-accent/30 to-accent/5" />
        )}
      </div>

      <div className="relative z-10 flex flex-wrap items-end gap-4 px-6 pb-5">
        {/* Avatar, pulled up to straddle the banner edge (above the banner). */}
        <div className="-mt-10 shrink-0 sm:-mt-12">
          {stream.avatarUrl ? (
            <img
              src={stream.avatarUrl}
              alt=""
              aria-hidden
              className="h-20 w-20 rounded-full border-4 border-surface bg-surface object-cover sm:h-24 sm:w-24"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-surface bg-bg sm:h-24 sm:w-24">
              <BrandTile platform={platform} size={40} />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">
              {name}
            </h1>
            <LiveBadge isLive={stream.live} />
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-fg-muted">
            <BrandTile platform={platform} size={14} />
            {platformName(platform)}
          </p>
        </div>
      </div>
    </section>
  )
}

function BackButton({onBack}: {onBack: () => void}) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
    >
      <ArrowLeft size={16} aria-hidden />
      Back to Dashboard
    </button>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon size={16} aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 truncate text-xl font-semibold text-fg">{value}</p>
    </div>
  )
}

/** The channel's most recent videos on this platform (cached). */
function RecentVideos({
  platform,
  onOpenVideo,
}: {
  platform: string
  onOpenVideo: (video: main.Video) => void
}) {
  const [videos, setVideos] = useState<main.Video[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    GetChannelVideos(platform)
      .then((list) => {
        if (cancelled) return
        // On YouTube show only public videos; Twitch VODs/highlights/clips all
        // count as public.
        const visible = (list ?? []).filter(
          (v) => platform !== 'youtube' || v.status === 'public',
        )
        setVideos(visible.slice(0, 9))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [platform])

  if (loaded && videos.length === 0) return null

  return (
    <section aria-label="Recent videos">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        <Clapperboard size={16} aria-hidden />
        Recent videos
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => (
          <button
            key={`${v.platform}-${v.id}`}
            type="button"
            onClick={() => onOpenVideo(v)}
            className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface text-left transition-colors hover:bg-surface-hover"
          >
            <div className="relative">
              {v.thumbnailUrl ? (
                <img
                  src={v.thumbnailUrl}
                  alt=""
                  aria-hidden
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
                  <Clapperboard size={24} aria-hidden />
                </div>
              )}
              {v.duration && (
                <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {v.duration}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <p className="line-clamp-2 text-sm font-semibold text-fg">
                {v.title || 'Untitled video'}
              </p>
              <p className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                <BrandTile platform={v.platform} size={14} />
                {[
                  v.kind,
                  formatDate(v.publishedAt),
                  v.viewCount > 0 ? `${formatCompact(v.viewCount)} views` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

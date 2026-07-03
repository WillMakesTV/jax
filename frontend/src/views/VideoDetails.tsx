import {
  ArrowLeft,
  Calendar,
  Clapperboard,
  ExternalLink,
  Eye,
  MessageSquare,
  RefreshCw,
  ThumbsUp,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState} from 'react'
import {GetVideoDetails} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {PageHeader} from '../components/PageHeader'
import {PlatformPill} from '../components/PlatformPill'
import {openExternal} from '../lib/browser'
import {formatAgo, formatCompact, formatDate, formatNumber} from '../lib/format'
import {platformName} from '../services/services'

interface VideoDetailsProps {
  video: main.Video
  onBack: () => void
}

/**
 * Detail view for one video: analytics (views, likes, comments, ...) and the
 * top viewer comments, from the backend's 1-hour cache with a force-refresh
 * CTA.
 */
export function VideoDetails({video, onBack}: VideoDetailsProps) {
  const [details, setDetails] = useState<main.VideoDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(
    async (force: boolean) => {
      setLoading(true)
      setError('')
      try {
        setDetails(await GetVideoDetails(video.platform, video.id, force))
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not load the video details.',
        )
      } finally {
        setLoading(false)
      }
    },
    [video.platform, video.id],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  // The freshest copy of the video's metadata wins (details are refreshable).
  const v = details?.video ?? video

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Videos
      </button>

      <PageHeader
        title={v.title || 'Untitled video'}
        description={`Hosted on ${platformName(v.platform)}${
          v.channelName ? ` · ${v.channelName}` : ''
        }`}
        actions={
          <div className="flex items-center gap-3">
            {details?.fetchedAt && (
              <span className="text-xs text-fg-muted">
                Updated {formatAgo(details.fetchedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              title="Fetch the latest data from the platform"
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

      {/* Summary: thumbnail + key metric tiles. */}
      <section
        aria-label="Video summary"
        className="flex flex-col gap-4 lg:flex-row"
      >
        <div className="w-full max-w-md shrink-0">
          <div className="relative overflow-hidden rounded-xl border border-edge">
            {v.thumbnailUrl ? (
              <img
                src={v.thumbnailUrl}
                alt={`${v.title || 'Video'} thumbnail`}
                className="aspect-video w-full object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-surface text-fg-muted">
                <Clapperboard size={32} aria-hidden />
              </div>
            )}
            {v.duration && (
              <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {v.duration}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PlatformPill platform={v.platform} label={v.channelName || undefined} />
            {v.kind && <PlatformPill platform="" label={v.kind} />}
            <button
              type="button"
              onClick={() => openExternal(v.url)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <ExternalLink size={14} aria-hidden />
              Watch on {platformName(v.platform)}
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 content-start gap-4">
          <SummaryTile
            icon={Eye}
            label="Views"
            value={v.viewCount > 0 ? formatNumber(v.viewCount) : '—'}
          />
          <SummaryTile
            icon={Calendar}
            label="Published"
            value={formatDate(v.publishedAt) || '—'}
          />
          {(details?.stats ?? [])
            .filter((s) => s.label !== 'Views')
            .map((s) => (
              <SummaryTile
                key={s.label}
                icon={statIcon(s.label)}
                label={s.label}
                value={s.value}
              />
            ))}
        </div>
      </section>

      {/* Description */}
      {v.description && (
        <section aria-label="Description" className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Description
          </h2>
          <p className="max-w-3xl whitespace-pre-wrap rounded-xl border border-edge bg-surface p-5 text-sm text-fg">
            {v.description}
          </p>
        </section>
      )}

      {/* Comments */}
      <section aria-label="Comments" className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Comments
        </h2>
        {loading && !details ? (
          <p className="text-sm text-fg-muted">Loading comments…</p>
        ) : (details?.comments ?? []).length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
            >
              <MessageSquare size={20} />
            </span>
            <p className="text-sm text-fg-muted">
              {details?.commentsNote || 'No comments yet.'}
            </p>
          </div>
        ) : (
          <ul className="flex max-w-3xl flex-col gap-3">
            {(details?.comments ?? []).map((c, i) => (
              <li
                key={`${c.author}-${c.publishedAt}-${i}`}
                className="flex items-start gap-3 rounded-xl border border-edge bg-surface p-4"
              >
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt=""
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-full"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-fg-muted"
                  >
                    <MessageSquare size={14} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-semibold text-fg">{c.author}</span>{' '}
                    <span className="text-xs text-fg-muted">
                      {formatDate(c.publishedAt)}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">
                    {c.text}
                  </p>
                  <p className="mt-2 flex items-center gap-4 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1">
                      <ThumbsUp size={12} aria-hidden />
                      {formatCompact(c.likeCount)}
                    </span>
                    {c.replyCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare size={12} aria-hidden />
                        {formatCompact(c.replyCount)}{' '}
                        {c.replyCount === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function statIcon(label: string) {
  switch (label) {
    case 'Likes':
      return ThumbsUp
    case 'Comments':
      return MessageSquare
    default:
      return Clapperboard
  }
}

function SummaryTile({
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
      <p className="mt-2 truncate text-2xl font-semibold text-fg">{value}</p>
    </div>
  )
}

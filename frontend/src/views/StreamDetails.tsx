import {ArrowLeft, Calendar, Clock, ExternalLink, Eye, Radio, Video} from 'lucide-react'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {PageHeader} from '../components/PageHeader'
import {openExternal} from '../lib/browser'
import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatNumber,
} from '../lib/format'
import {platformName} from '../services/services'

interface StreamDetailsProps {
  stream: main.PastStream
  onBack: () => void
}

/**
 * Detail view for one aggregated stream: a summary of the broadcast plus a
 * card per channel it was streamed to, each with that platform's own title,
 * thumbnail, timings, and stats.
 */
export function StreamDetails({stream, onBack}: StreamDetailsProps) {
  const duration = stream.broadcasts.find((b) => b.duration)?.duration

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Streams
      </button>

      <PageHeader
        title={stream.title || 'Untitled stream'}
        description={`Streamed to ${stream.broadcasts.length} channel${
          stream.broadcasts.length === 1 ? '' : 's'
        }.`}
      />

      {/* Summary: thumbnail + aggregate tiles. */}
      <section
        aria-label="Stream summary"
        className="flex flex-col gap-4 lg:flex-row"
      >
        {stream.thumbnailUrl ? (
          <img
            src={stream.thumbnailUrl}
            alt={`${stream.title || 'Stream'} thumbnail`}
            className="aspect-video w-full max-w-md rounded-xl border border-edge object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full max-w-md items-center justify-center rounded-xl border border-edge bg-surface text-fg-muted">
            <Video size={32} aria-hidden />
          </div>
        )}

        <div className="grid flex-1 grid-cols-2 content-start gap-4">
          <SummaryTile
            icon={Calendar}
            label="Date"
            value={formatDate(stream.startedAt) || '—'}
          />
          <SummaryTile icon={Clock} label="Duration" value={duration || '—'} />
          <SummaryTile
            icon={Eye}
            label="Total views"
            value={
              stream.totalViews > 0 ? formatCompact(stream.totalViews) : '—'
            }
          />
          <SummaryTile
            icon={Radio}
            label="Channels"
            value={String(stream.broadcasts.length)}
          />
        </div>
      </section>

      {/* Per-channel details. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Channel details
      </h2>
      <div className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2">
        {stream.broadcasts.map((b) => (
          <ChannelDetailCard key={`${b.platform}-${b.url}`} broadcast={b} />
        ))}
      </div>
    </div>
  )
}

export function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar
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

export function DetailRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-right text-sm font-medium text-fg">
        {value}
      </dd>
    </div>
  )
}

function ChannelDetailCard({broadcast}: {broadcast: main.PastBroadcast}) {
  const name = platformName(broadcast.platform)
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface">
      <div className="flex items-center gap-3 border-b border-edge p-4">
        <BrandTile platform={broadcast.platform} size={32} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{name}</p>
          {/* Each channel keeps its own title (they differ per platform). */}
          <p className="truncate text-xs text-fg-muted">
            {broadcast.title || 'Untitled'}
          </p>
        </div>
      </div>

      {broadcast.thumbnailUrl && (
        <img
          src={broadcast.thumbnailUrl}
          alt={`${name} thumbnail`}
          className="aspect-video w-full object-cover"
        />
      )}

      <div className="flex flex-1 flex-col p-4">
        <dl className="divide-y divide-edge">
          <DetailRow
            label="Went live"
            value={formatDateTime(broadcast.startedAt) || '—'}
          />
          <DetailRow label="Duration" value={broadcast.duration || '—'} />
          <DetailRow
            label="Views"
            value={
              broadcast.viewCount > 0 ? formatNumber(broadcast.viewCount) : '—'
            }
          />
        </dl>

        <button
          type="button"
          onClick={() => openExternal(broadcast.url)}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-edge bg-bg px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
        >
          <ExternalLink size={16} aria-hidden />
          Watch on {name}
        </button>
      </div>
    </article>
  )
}

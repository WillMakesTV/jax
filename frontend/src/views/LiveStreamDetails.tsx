import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Eye,
  Gauge,
  Radio,
  Users,
} from 'lucide-react'
import {useEffect} from 'react'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {PageHeader} from '../components/PageHeader'
import {openExternal} from '../lib/browser'
import {
  formatCompact,
  formatDateTime,
  formatDurationMs,
  formatKbps,
  formatNumber,
  formatUptime,
} from '../lib/format'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {platformName} from '../services/services'
import {DetailRow, SummaryTile} from './StreamDetails'

interface LiveStreamDetailsProps {
  onBack: () => void
}

/**
 * Detail view for the current live stream: aggregate metrics plus a card per
 * channel currently broadcasting, fed live by the shared data provider.
 */
export function LiveStreamDetails({onBack}: LiveStreamDetailsProps) {
  const {platforms, obs, requestFastPolling} = useLiveData()

  // Detailed metrics view: poll platforms at the fast cadence while open.
  useEffect(() => requestFastPolling(), [requestFastPolling])

  const live = platforms.filter((p) => p.live)
  const {totalViewers, uptimeMs} = aggregateLive(platforms, obs)

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Past Streams
      </button>

      {live.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-12 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Radio size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">
            The stream has ended
          </p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Once its VODs are processed it will appear under Past streams.
          </p>
        </div>
      ) : (
        <>
          <PageHeader
            description={`Live on ${live
              .map((p) => platformName(p.platform))
              .join(' + ')}.`}
          />

          {/* Aggregate metrics. */}
          <section
            aria-label="Live summary"
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          >
            <SummaryTile
              icon={Users}
              label="Total viewers"
              value={formatCompact(totalViewers)}
            />
            <SummaryTile
              icon={Clock}
              label="Uptime"
              value={uptimeMs !== null ? formatDurationMs(uptimeMs) : '—'}
            />
            <SummaryTile
              icon={Radio}
              label="Live channels"
              value={String(live.length)}
            />
            <SummaryTile
              icon={Gauge}
              label="Encoder"
              value={
                obs?.outputActive
                  ? obs.kbps !== null
                    ? formatKbps(obs.kbps)
                    : 'Streaming'
                  : '—'
              }
            />
          </section>

          {/* Per-channel live details. */}
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Channel details
          </h2>
          <div className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2">
            {live.map((p) => (
              <LiveChannelCard key={p.platform} stream={p} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function LiveChannelCard({stream}: {stream: main.LiveStream}) {
  const name = platformName(stream.platform)
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface">
      <div className="flex items-center gap-3 border-b border-edge p-4">
        <BrandTile platform={stream.platform} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">
            {stream.channelName || name}
          </p>
          {/* Each channel keeps its own live title. */}
          <p className="truncate text-xs text-fg-muted">
            {stream.title || 'Untitled broadcast'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-500 dark:text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
          Live
        </span>
      </div>

      {stream.thumbnailUrl && (
        <img
          src={stream.thumbnailUrl}
          alt={`${name} live preview`}
          className="aspect-video w-full object-cover"
        />
      )}

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-4 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <Eye size={14} aria-hidden />
            {formatNumber(stream.viewerCount)} watching
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={14} aria-hidden />
            {formatUptime(stream.startedAt)}
          </span>
        </div>

        <dl className="divide-y divide-edge">
          {stream.category && (
            <DetailRow label="Category" value={stream.category} />
          )}
          <DetailRow
            label="Went live"
            value={formatDateTime(stream.startedAt) || '—'}
          />
          {stream.details.map((d) => (
            <DetailRow key={d.label} label={d.label} value={d.value} />
          ))}
        </dl>

        <div className="mt-4 flex gap-3">
          {stream.streamUrl && (
            <button
              type="button"
              onClick={() => openExternal(stream.streamUrl)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <ExternalLink size={16} aria-hidden />
              Watch stream
            </button>
          )}
          {stream.channelUrl && (
            <button
              type="button"
              onClick={() => openExternal(stream.channelUrl)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-edge bg-bg px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
            >
              <ExternalLink size={16} aria-hidden />
              Open channel
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

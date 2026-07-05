import {
  Activity,
  Clock,
  Cpu,
  ExternalLink,
  Eye,
  HardDrive,
  MonitorPlay,
  Radio,
  Video,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {Modal} from '../components/Modal'
import {openExternal} from '../lib/browser'
import {
  formatBytes,
  formatCompact,
  formatDurationMs,
  formatFrameDrops,
  formatKbps,
  formatNumber,
  formatUptime,
} from '../lib/format'
import {platformName} from '../services/services'
import {OBS_POLL_MS, useLiveData, type ObsMetrics} from './LiveDataProvider'

// ---------------------------------------------------------------------------
// Shared live-stream UI: the aggregate overview panel (summary tiles plus
// per-channel and encoder cards, each opening a detail dialog) and the small
// status pills used across views. The overview is designed to sit on an
// accent-coloured hero, so its empty state uses translucent accent styling.
// ---------------------------------------------------------------------------

/** Live/offline badge with a pinging dot while live. */
export function LiveBadge({isLive}: {isLive: boolean}) {
  if (!isLive) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted">
        <span className="h-2 w-2 rounded-full bg-fg-muted" aria-hidden />
        Offline
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      Live
    </span>
  )
}

/** Small live/offline pill used inside cards and section headers. */
export function StatusPill({live, label}: {live: boolean; label?: string}) {
  return live ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-500 dark:text-red-400">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
      {label ?? 'Live'}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" aria-hidden />
      {label ?? 'Offline'}
    </span>
  )
}

/**
 * The live-broadcast overview: aggregate summary tiles and the channel and
 * encoder cards, with their detail dialogs. Requests the fast platform poll
 * cadence while mounted.
 */
export function LiveOverview({
  onOpenChannel,
}: {
  /**
   * Open a channel's detail page. When provided, channel cards navigate here
   * instead of opening the in-place platform modal.
   */
  onOpenChannel?: (platform: string) => void
} = {}) {
  const {platforms, obs, oauthConnected, obsConnected, requestFastPolling} =
    useLiveData()
  const [detail, setDetail] = useState<main.LiveStream | null>(null)
  const [obsDetailOpen, setObsDetailOpen] = useState(false)

  // This panel shows detailed metrics, so ask the shared provider for the
  // fast platform poll cadence while it is on screen.
  useEffect(() => requestFastPolling(), [requestFastPolling])

  const nothingConnected = !oauthConnected && !obsConnected

  if (nothingConnected) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-accent-fg/10 p-5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-fg/15"
        >
          <Radio size={20} />
        </span>
        <div>
          <p className="text-sm font-semibold">No services connected</p>
          <p className="text-sm opacity-80">
            Connect Twitch, YouTube, or OBS in Settings → Services to see live
            metrics here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Channel + encoder cards. Channel cards navigate to the channel's
          detail page when a handler is provided, else open a dialog. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {platforms.map((p) => (
          <ChannelCard
            key={p.platform}
            stream={p}
            onSelect={() =>
              onOpenChannel ? onOpenChannel(p.platform) : setDetail(p)
            }
          />
        ))}
        {obsConnected && (
          <ObsCard obs={obs} onSelect={() => setObsDetailOpen(true)} />
        )}
      </div>

      <PlatformDetailModal stream={detail} onClose={() => setDetail(null)} />
      <ObsDetailModal
        obs={obsDetailOpen ? obs : null}
        onClose={() => setObsDetailOpen(false)}
      />
    </div>
  )
}

function ChannelCard({
  stream,
  onSelect,
}: {
  stream: main.LiveStream
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col rounded-xl border border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex w-full items-center gap-3">
        <BrandTile platform={stream.platform} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">
            {stream.channelName || platformName(stream.platform)}
          </p>
          <p className="text-xs text-fg-muted">{platformName(stream.platform)}</p>
        </div>
        <StatusPill live={stream.live} />
      </div>

      {stream.error ? (
        <p className="mt-3 text-sm text-fg-muted">{stream.error}</p>
      ) : stream.live ? (
        <>
          <p className="mt-3 line-clamp-1 text-sm text-fg">
            {stream.title || 'Untitled broadcast'}
          </p>
          <div className="mt-2 flex items-center gap-4 text-sm text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <Eye size={14} aria-hidden />
              {formatCompact(stream.viewerCount)} watching
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={14} aria-hidden />
              {formatUptime(stream.startedAt)}
            </span>
          </div>
          {stream.category && (
            <span className="mt-3 inline-flex w-fit items-center rounded-full border border-edge bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted">
              {stream.category}
            </span>
          )}
        </>
      ) : stream.details.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          Not live. Click for channel details.
        </p>
      ) : null}

      {/* Channel analytics (followers, subscribers, totals) ride along on
          the same card so the hero is the one stats surface. */}
      {!stream.error && stream.details.length > 0 && (
        <dl className="mt-3 divide-y divide-edge border-t border-edge">
          {stream.details.map((d) => (
            <div
              key={d.label}
              className="flex items-baseline justify-between gap-4 py-1.5"
            >
              <dt className="shrink-0 text-xs text-fg-muted">{d.label}</dt>
              <dd className="truncate text-right text-sm font-medium text-fg">
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </button>
  )
}

function ObsCard({
  obs,
  onSelect,
}: {
  obs: ObsMetrics | null
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col rounded-xl border border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex w-full items-center gap-3">
        <BrandTile platform="obs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">OBS Studio</p>
          <p className="text-xs text-fg-muted">Encoder</p>
        </div>
        <StatusPill
          live={Boolean(obs?.outputActive)}
          label={
            obs?.outputReconnecting
              ? 'Reconnecting'
              : obs?.outputActive
                ? 'Streaming'
                : 'Idle'
          }
        />
      </div>

      {obs ? (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <MonitorPlay size={14} aria-hidden />
            {Math.round(obs.activeFps)} fps
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Activity size={14} aria-hidden />
            {obs.outputActive && obs.kbps !== null ? formatKbps(obs.kbps) : '—'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Cpu size={14} aria-hidden />
            {obs.cpuUsage.toFixed(1)}% CPU
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Video size={14} aria-hidden />
            {formatFrameDrops(obs.outputSkippedFrames, obs.outputTotalFrames)}{' '}
            dropped
          </span>
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">Waiting for stats…</p>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Detail dialogs
// ---------------------------------------------------------------------------

function DetailRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-right text-sm font-medium text-fg">
        {value}
      </dd>
    </div>
  )
}

function PlatformDetailModal({
  stream,
  onClose,
}: {
  stream: main.LiveStream | null
  onClose: () => void
}) {
  const open = stream !== null
  if (!stream) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={stream.channelName || platformName(stream.platform)}
      icon={<BrandTile platform={stream.platform} size={28} />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <StatusPill live={stream.live} />
          {stream.live && (
            <span className="text-sm text-fg-muted">
              up {formatUptime(stream.startedAt)}
            </span>
          )}
        </div>

        {stream.live && stream.thumbnailUrl && (
          <img
            src={stream.thumbnailUrl}
            alt="Live stream preview"
            className="w-full rounded-lg border border-edge"
          />
        )}

        {stream.error && <p className="text-sm text-fg-muted">{stream.error}</p>}

        {stream.live && (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-edge bg-bg p-3">
              <p className="text-xs text-fg-muted">Viewers</p>
              <p className="mt-1 text-xl font-semibold text-fg">
                {formatNumber(stream.viewerCount)}
              </p>
            </div>
            <div className="rounded-lg border border-edge bg-bg p-3">
              <p className="text-xs text-fg-muted">Category</p>
              <p className="mt-1 truncate text-xl font-semibold text-fg">
                {stream.category || '—'}
              </p>
            </div>
          </div>
        )}

        {(stream.title || stream.details.length > 0) && (
          <dl className="divide-y divide-edge">
            {stream.title && <DetailRow label="Title" value={stream.title} />}
            {stream.details.map((d) => (
              <DetailRow key={d.label} label={d.label} value={d.value} />
            ))}
          </dl>
        )}

        <div className="flex gap-3">
          {stream.live && stream.streamUrl && (
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
    </Modal>
  )
}

function ObsDetailModal({
  obs,
  onClose,
}: {
  obs: ObsMetrics | null
  onClose: () => void
}) {
  if (!obs) return null
  return (
    <Modal
      open
      onClose={onClose}
      title="OBS Studio"
      icon={<BrandTile platform="obs" size={28} />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <StatusPill
            live={obs.outputActive}
            label={
              obs.outputReconnecting
                ? 'Reconnecting'
                : obs.outputActive
                  ? 'Streaming'
                  : 'Idle'
            }
          />
          {obs.outputActive && (
            <span className="text-sm text-fg-muted">
              up {formatDurationMs(obs.outputDuration)}
            </span>
          )}
        </div>

        <dl className="divide-y divide-edge">
          <DetailRow
            label="Bitrate"
            value={
              obs.outputActive && obs.kbps !== null ? formatKbps(obs.kbps) : '—'
            }
          />
          <DetailRow
            label="Data output"
            value={obs.outputActive ? formatBytes(obs.outputBytes) : '—'}
          />
          <DetailRow
            label="Congestion"
            value={
              obs.outputActive
                ? `${(obs.outputCongestion * 100).toFixed(0)}%`
                : '—'
            }
          />
          <DetailRow
            label="Dropped frames (network)"
            value={formatFrameDrops(
              obs.outputSkippedFrames,
              obs.outputTotalFrames,
            )}
          />
          <DetailRow
            label="Skipped frames (render)"
            value={formatFrameDrops(
              obs.renderSkippedFrames,
              obs.renderTotalFrames,
            )}
          />
          <DetailRow label="FPS" value={String(Math.round(obs.activeFps))} />
          <DetailRow
            label="Frame render time"
            value={`${obs.averageFrameRenderTime.toFixed(1)} ms`}
          />
          <DetailRow label="CPU usage" value={`${obs.cpuUsage.toFixed(1)}%`} />
          <DetailRow
            label="Memory"
            value={`${Math.round(obs.memoryUsage)} MB`}
          />
          <DetailRow
            label="Free disk space"
            value={formatBytes(obs.availableDiskSpace * 1e6)}
          />
        </dl>

        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <HardDrive size={14} aria-hidden />
          Stats refresh every {OBS_POLL_MS / 1000}s while OBS is connected.
        </p>
      </div>
    </Modal>
  )
}

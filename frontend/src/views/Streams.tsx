import {
  Activity,
  CalendarPlus,
  Clock,
  Cpu,
  Disc,
  ExternalLink,
  Eye,
  Gauge,
  HardDrive,
  Layers,
  Link2,
  MessageSquare,
  Mic,
  MonitorPlay,
  PlayCircle,
  Radio,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {
  GetPastStreams,
  GroupPastStreams,
  UngroupPastStreams,
} from '../../wailsjs/go/main/App'
import {useChat} from '../chat/ChatProvider'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {Modal} from '../components/Modal'
import {openExternal} from '../lib/browser'
import {
  formatBytes,
  formatCompact,
  formatDate,
  formatDurationMs,
  formatFrameDrops,
  formatKbps,
  formatNumber,
  formatUptime,
} from '../lib/format'
import {
  aggregateLive,
  OBS_POLL_MS,
  useLiveData,
  type ObsMetrics,
} from '../live/LiveDataProvider'
import {platformName, SERVICES} from '../services/services'
import {useServices} from '../services/ServicesProvider'

interface StreamsProps {
  /** Open the details view for an aggregated past stream. */
  onOpenStream: (stream: main.PastStream) => void
  /** Open the details view for the current live stream. */
  onOpenLive: () => void
}

/**
 * Streams overview: a hero banner, a live-stream metrics panel fed by the
 * Twitch/YouTube APIs and OBS's WebSocket, aggregated live chat, past streams
 * aggregated by timing across platforms, and stream-planning cards.
 */
export function Streams({onOpenStream, onOpenLive}: StreamsProps) {
  return (
    <div className="flex h-full flex-col gap-8">
      <Hero />
      <LiveStreamSection />
      <ChatSection />
      <ObsSection />
      <PastStreamsSection onOpenStream={onOpenStream} onOpenLive={onOpenLive} />
      <PlanningSection />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-accent p-8 text-accent-fg">
      {/* Decorative watermark. */}
      <Radio
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 opacity-10"
        size={180}
        strokeWidth={1.5}
      />
      <div className="relative max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
          Streams
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Plan, go live, and review
        </h1>
        <p className="mt-2 text-sm opacity-90">
          Track your live broadcast in real time, revisit past streams, and line
          up what&apos;s next — all in one place.
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Live stream section
// ---------------------------------------------------------------------------

function LiveStreamSection() {
  const {platforms, obs, oauthConnected, obsConnected, requestFastPolling} =
    useLiveData()
  const [detail, setDetail] = useState<main.LiveStream | null>(null)
  const [obsDetailOpen, setObsDetailOpen] = useState(false)

  // This view shows detailed metrics, so ask the shared provider for the fast
  // platform poll cadence while it is on screen.
  useEffect(() => requestFastPolling(), [requestFastPolling])

  const nothingConnected = !oauthConnected && !obsConnected
  const livePlatforms = platforms.filter((p) => p.live)
  const {anyLive, totalViewers, uptimeMs} = aggregateLive(platforms, obs)
  const uptime = uptimeMs !== null ? formatDurationMs(uptimeMs) : '—'

  return (
    <section aria-label="Live stream">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Live stream
        </h2>
        <LiveBadge isLive={anyLive} />
      </div>

      {nothingConnected ? (
        <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-5">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Radio size={20} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">
              No services connected
            </p>
            <p className="text-sm text-fg-muted">
              Connect Twitch, YouTube, or OBS in Settings → Services to see live
              metrics here.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Aggregate summary tiles. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryTile
              icon={Users}
              label="Total viewers"
              value={anyLive ? formatCompact(totalViewers) : '—'}
              hint={
                livePlatforms.length > 1
                  ? `across ${livePlatforms.length} channels`
                  : undefined
              }
            />
            <SummaryTile
              icon={Radio}
              label="Live channels"
              value={String(livePlatforms.length)}
              hint={
                livePlatforms.length
                  ? livePlatforms.map((p) => platformName(p.platform)).join(' + ')
                  : 'none live'
              }
            />
            <SummaryTile icon={Clock} label="Uptime" value={uptime} />
            <SummaryTile
              icon={Gauge}
              label="Encoder"
              value={
                !obsConnected
                  ? 'Not connected'
                  : obs?.outputActive
                    ? obs.kbps !== null
                      ? formatKbps(obs.kbps)
                      : 'Streaming'
                    : 'Idle'
              }
              hint={
                obs?.outputActive
                  ? `${Math.round(obs.activeFps)} fps`
                  : undefined
              }
            />
          </div>

          {/* Channel + encoder cards; each opens a detail dialog. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {platforms.map((p) => (
              <ChannelCard
                key={p.platform}
                stream={p}
                onSelect={() => setDetail(p)}
              />
            ))}
            {obsConnected && (
              <ObsCard obs={obs} onSelect={() => setObsDetailOpen(true)} />
            )}
          </div>
        </div>
      )}

      <PlatformDetailModal stream={detail} onClose={() => setDetail(null)} />
      <ObsDetailModal
        obs={obsDetailOpen ? obs : null}
        onClose={() => setObsDetailOpen(false)}
      />
    </section>
  )
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon size={16} aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold text-fg">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}

function LiveBadge({isLive}: {isLive: boolean}) {
  if (!isLive) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted">
        <span className="h-2 w-2 rounded-full bg-fg-muted" aria-hidden />
        Offline
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-500 dark:text-red-400">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      Live
    </span>
  )
}

/** Small live/offline pill used inside cards. */
function StatusPill({live, label}: {live: boolean; label?: string}) {
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
      ) : (
        <p className="mt-3 text-sm text-fg-muted">
          Not live. Click for channel details.
        </p>
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

// ---------------------------------------------------------------------------
// Chat
//
// Aggregated live chat across every channel currently broadcasting, fed by
// the app-wide ChatProvider (Twitch IRC + YouTube Data API).
// ---------------------------------------------------------------------------

const chatTimeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})

function ChatSection() {
  const {messages, active} = useChat()
  const listRef = useRef<HTMLDivElement>(null)
  // Follow new messages only while the user is already at the bottom.
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <section aria-label="Chat">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Chat
        </h2>
        <StatusPill live={active} label={active ? 'Connected' : 'Offline'} />
      </div>

      <div className="rounded-xl border border-edge bg-surface">
        {messages.length === 0 ? (
          <div className="flex items-center gap-3 p-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
            >
              <MessageSquare size={20} />
            </span>
            <p className="text-sm text-fg-muted">
              {active
                ? 'Connected — chat messages will appear here.'
                : 'Chat from all your channels appears here while you are live.'}
            </p>
          </div>
        ) : (
          <div
            ref={listRef}
            onScroll={onScroll}
            className="max-h-80 overflow-y-auto p-4"
          >
            <ul className="space-y-1.5">
              {messages.map((m) => (
                <li
                  key={`${m.platform}-${m.id}`}
                  className="flex items-start gap-2"
                >
                  {/* Channel source of the chatter. */}
                  <span className="mt-0.5" title={platformName(m.platform)}>
                    <BrandTile platform={m.platform} size={16} />
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm leading-snug">
                    <span
                      className="font-semibold text-fg"
                      style={m.color ? {color: m.color} : undefined}
                    >
                      {m.author}
                    </span>{' '}
                    <span className="text-fg">{m.text}</span>
                  </p>
                  <span className="shrink-0 pt-0.5 text-[10px] text-fg-muted">
                    {chatTimeFmt.format(m.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// OBS
//
// Stream controls are live; the remaining cards are placeholders that come to
// life as more obs-websocket requests are wired up (the plumbing exists via
// ServicesProvider.obsRequest).
// ---------------------------------------------------------------------------

interface ObsFeatureCard {
  title: string
  description: string
  icon: LucideIcon
}

const OBS_FEATURE_CARDS: ObsFeatureCard[] = [
  {
    title: 'Scene switcher',
    description: 'Preview your scenes and switch between them without leaving Jax.',
    icon: Layers,
  },
  {
    title: 'Recording & replay',
    description: 'Control recordings and the replay buffer, and see where files land.',
    icon: Disc,
  },
  {
    title: 'Audio mixer',
    description: 'Watch levels and mute or unmute sources at a glance.',
    icon: Mic,
  },
]

/** Live OBS stream controls: start/stop the broadcast with a confirm step. */
function StreamControlsCard() {
  const {statuses, obsRequest} = useServices()
  const {obs} = useLiveData()

  const connected = statuses.obs.connected
  const streaming = Boolean(obs?.outputActive)
  const reconnecting = Boolean(obs?.outputReconnecting)

  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Drop a pending confirmation when the stream state changes underneath it
  // (e.g. the stream was started/stopped from OBS itself).
  useEffect(() => {
    setConfirming(false)
  }, [streaming])

  const toggleStream = async () => {
    setBusy(true)
    setError('')
    try {
      await obsRequest(streaming ? 'StopStream' : 'StartStream')
      // The status pill and button flip when the next stats poll lands.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The OBS request failed.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-edge bg-surface p-5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
        >
          <PlayCircle size={18} />
        </span>
        <span className="ml-auto">
          <StatusPill
            live={streaming}
            label={
              reconnecting
                ? 'Reconnecting'
                : streaming
                  ? 'Streaming'
                  : connected
                    ? 'Idle'
                    : 'Offline'
            }
          />
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold text-fg">Stream controls</p>
      <p className="mt-1 flex-1 text-sm text-fg-muted">
        {connected
          ? 'Start or stop the broadcast right from the dashboard.'
          : 'Connect OBS in Settings → Services to control the stream.'}
      </p>

      {connected && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                onClick={toggleStream}
                disabled={busy}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50',
                  streaming
                    ? 'bg-red-600 text-white'
                    : 'bg-accent text-accent-fg',
                )}
              >
                {busy ? 'Working…' : streaming ? 'Confirm stop' : 'Confirm go live'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                streaming
                  ? 'border border-red-600/50 text-red-600 hover:bg-red-600/10 dark:text-red-400'
                  : 'bg-accent text-accent-fg transition-opacity hover:opacity-90',
              )}
            >
              {streaming ? 'Stop streaming' : 'Start streaming'}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

function ObsSection() {
  const {statuses} = useServices()
  const connected = statuses.obs.connected

  return (
    <section aria-label="OBS Studio">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          OBS Studio
        </h2>
        <StatusPill
          live={connected}
          label={connected ? 'Connected' : 'Not connected'}
        />
      </div>

      <p className="mb-4 max-w-2xl text-sm text-fg-muted">
        {connected
          ? `Connected to OBS at ${statuses.obs.account}. Review and control features are on the way.`
          : 'Connect OBS in Settings → Services to review and control it from here.'}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StreamControlsCard />
        {OBS_FEATURE_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.title}
              className="flex flex-col rounded-xl border border-dashed border-edge bg-surface p-5"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
                >
                  <Icon size={18} />
                </span>
                <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                  Soon
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-fg">{card.title}</p>
              <p className="mt-1 text-sm text-fg-muted">{card.description}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Past streams
//
// One stream is broadcast to several platforms under the same title, so the
// backend aggregates Twitch VODs and completed YouTube broadcasts by title
// into PastStream records referencing each channel's copy. The current live
// stream (if any) leads the grid.
// ---------------------------------------------------------------------------

/** Stable identity for one broadcast; mirrors broadcastKey in past.go. */
const broadcastKeyOf = (b: main.PastBroadcast) => `${b.platform}|${b.url}`

/** Selection identity for an aggregated stream. */
const streamKeyOf = (s: main.PastStream) =>
  s.broadcasts.map(broadcastKeyOf).join(',')

function PastStreamsSection({
  onOpenStream,
  onOpenLive,
}: {
  onOpenStream: (stream: main.PastStream) => void
  onOpenLive: () => void
}) {
  const {platforms} = useLiveData()
  const [past, setPast] = useState<main.PastStream[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const result = await GetPastStreams()
      setPast(result ?? [])
    } catch {
      // Backend unavailable (e.g. plain Vite dev); leave the list empty.
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleSelected = useCallback((stream: main.PastStream) => {
    setError('')
    setSelected((prev) => {
      const key = streamKeyOf(stream)
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const selectedStreams = past.filter((s) => selected.has(streamKeyOf(s)))
  // Ungroup applies when exactly one manually-grouped stream is selected.
  const ungroupTarget =
    selectedStreams.length === 1 && selectedStreams[0].groupId
      ? selectedStreams[0]
      : null

  const onGroup = async () => {
    setBusy(true)
    setError('')
    try {
      await GroupPastStreams(
        selectedStreams.flatMap((s) => s.broadcasts.map(broadcastKeyOf)),
      )
      setSelected(new Set())
      await reload()
    } catch {
      setError('Could not group the selected streams.')
    } finally {
      setBusy(false)
    }
  }

  const onUngroup = async () => {
    if (!ungroupTarget) return
    setBusy(true)
    setError('')
    try {
      await UngroupPastStreams(ungroupTarget.groupId)
      setSelected(new Set())
      await reload()
    } catch {
      setError('Could not ungroup the selected stream.')
    } finally {
      setBusy(false)
    }
  }

  const live = platforms.filter((p) => p.live)
  const empty = loaded && past.length === 0 && live.length === 0

  return (
    <section aria-label="Past streams">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Past streams
        </h2>

        {/* Selection CTA: group the checked streams into one, or dissolve a
            manual group. Timing-based matching occasionally misses, so this
            is the manual escape hatch. */}
        {selectedStreams.length > 0 && (
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
            <span className="text-xs text-fg-muted">
              {selectedStreams.length} selected
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              Clear
            </button>
            {ungroupTarget && (
              <button
                type="button"
                onClick={onUngroup}
                disabled={busy}
                className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                Ungroup
              </button>
            )}
            {selectedStreams.length >= 2 && (
              <button
                type="button"
                onClick={onGroup}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Link2 size={14} aria-hidden />
                {busy ? 'Grouping…' : 'Group streams'}
              </button>
            )}
          </div>
        )}
      </div>

      {!loaded && past.length === 0 ? (
        <p className="text-sm text-fg-muted">Loading past streams…</p>
      ) : empty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Video size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">No past streams yet</p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Once you&apos;ve streamed on a connected channel, your broadcasts
            appear here aggregated across platforms.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.length > 0 && <LiveNowCard live={live} onOpen={onOpenLive} />}
          {past.map((stream) => (
            <PastStreamCard
              key={streamKeyOf(stream)}
              stream={stream}
              selected={selected.has(streamKeyOf(stream))}
              onToggleSelect={() => toggleSelected(stream)}
              onOpen={() => onOpenStream(stream)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** Thumbnail area shared by the live and past cards. */
function CardThumbnail({
  url,
  alt,
  overlay,
}: {
  url: string
  alt: string
  overlay?: ReactNode
}) {
  return (
    <div className="relative">
      {url ? (
        <img src={url} alt={alt} className="aspect-video w-full object-cover" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
          <Video size={28} aria-hidden />
        </div>
      )}
      {overlay}
    </div>
  )
}

/** Small platform chip linking out to one channel's copy of the stream. */
function BroadcastChip({
  platform,
  label,
  url,
}: {
  platform: string
  label: string
  url: string
}) {
  const def = SERVICES.find((s) => s.id === platform)
  const Icon = def?.Icon
  return (
    <button
      type="button"
      onClick={() => url && openExternal(url)}
      title={`Open on ${def?.name ?? platform}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
    >
      {Icon && (
        <span
          aria-hidden
          className="flex h-4 w-4 items-center justify-center rounded-full text-white"
          style={{backgroundColor: def?.brand}}
        >
          <Icon size={10} />
        </span>
      )}
      {label}
    </button>
  )
}

/** The current broadcast, aggregated across platforms, leading the grid. */
function LiveNowCard({
  live,
  onOpen,
}: {
  live: main.LiveStream[]
  onOpen: () => void
}) {
  const title = live.find((p) => p.title)?.title ?? 'Live now'
  const thumbnail = live.find((p) => p.thumbnailUrl)?.thumbnailUrl ?? ''
  const viewers = live.reduce((sum, p) => sum + p.viewerCount, 0)

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-red-500/40 bg-surface">
      {/* Thumbnail and title open the live details view; the platform chips
          below deep-link to each channel's stream instead. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open live stream details"
        className="text-left transition-opacity hover:opacity-90"
      >
        <CardThumbnail
          url={thumbnail}
          alt="Current live stream preview"
          overlay={
            <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Live
            </span>
          }
        />
      </button>
      <div className="flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left text-sm font-semibold text-fg hover:underline"
        >
          {title}
        </button>
        <p className="mt-1 text-xs text-fg-muted">
          {formatCompact(viewers)} watching now
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {live.map((p) => (
            <BroadcastChip
              key={p.platform}
              platform={p.platform}
              label={`${formatCompact(p.viewerCount)} watching`}
              url={p.streamUrl}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

function PastStreamCard({
  stream,
  selected,
  onToggleSelect,
  onOpen,
}: {
  stream: main.PastStream
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
}) {
  const duration = stream.broadcasts.find((b) => b.duration)?.duration
  const meta = [
    formatDate(stream.startedAt),
    duration,
    stream.totalViews > 0 ? `${formatCompact(stream.totalViews)} views` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-xl border bg-surface',
        selected ? 'border-accent ring-1 ring-accent' : 'border-edge',
      )}
    >
      {/* Selection checkbox for manual grouping, floating over the thumbnail. */}
      <label
        className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-edge bg-bg/85 backdrop-blur-sm"
        title="Select stream for grouping"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${stream.title || 'untitled stream'} for grouping`}
          className="h-3.5 w-3.5 accent-accent"
        />
      </label>
      {/* Thumbnail and title open the stream's details view; the platform
          chips below deep-link to each channel's VOD instead. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${stream.title || 'untitled stream'}`}
        className="text-left transition-opacity hover:opacity-90"
      >
        <CardThumbnail
          url={stream.thumbnailUrl}
          alt={`${stream.title || 'Untitled stream'} thumbnail`}
        />
      </button>
      <div className="flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left text-sm font-semibold text-fg hover:underline"
        >
          {stream.title || 'Untitled stream'}
        </button>
        {meta && <p className="mt-1 text-xs text-fg-muted">{meta}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {stream.broadcasts.map((b) => (
            <BroadcastChip
              key={`${b.platform}-${b.url}`}
              platform={b.platform}
              label={
                b.viewCount > 0 ? `${formatCompact(b.viewCount)} views` : 'Watch'
              }
              url={b.url}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Stream planning
// ---------------------------------------------------------------------------

interface PlanningCard {
  title: string
  description: string
  icon: LucideIcon
}

const PLANNING_CARDS: PlanningCard[] = [
  {
    title: 'Plan a stream',
    description:
      'Outline your next broadcast — title, description, and the plan for the run.',
    icon: CalendarPlus,
  },
  {
    title: 'Link a channel source',
    description:
      'Associate a Twitch or YouTube channel so streams post to the right place.',
    icon: Link2,
  },
]

function PlanningSection() {
  return (
    <section aria-label="Stream planning">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Stream planning
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PLANNING_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.title}
              className="flex items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
              >
                <Icon size={20} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-fg">
                    {card.title}
                  </span>
                  <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                    Soon
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{card.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

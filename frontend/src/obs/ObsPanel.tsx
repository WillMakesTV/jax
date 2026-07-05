import {Info, MonitorPlay, Plug} from 'lucide-react'
import {useEffect, useState} from 'react'
import {Modal} from '../components/Modal'
import {StatusPill} from '../live/LiveOverview'
import {OBS_POLL_MS, useLiveData} from '../live/LiveDataProvider'
import {
  formatBytes,
  formatDurationMs,
  formatFrameDrops,
  formatKbps,
} from '../lib/format'
import {useServices} from '../services/ServicesProvider'
import {MixerPanel} from './MixerPanel'
import {ScenesPanel} from './ScenesPanel'
import {StreamControls} from './StreamControls'
import {useObsPreview} from './useObsPreview'

/** Target preview frame interval (~30 fps). */
const PREVIEW_FRAME_MS = 1000 / 30

interface ObsVersionInfo {
  obsVersion: string
  obsWebSocketVersion: string
  platformDescription: string
}

/**
 * OBS Studio panel for the Broadcast section: a near-live program-output
 * preview with inline stream controls, the primary sources (mics, music,
 * webcam), the scene switcher, and connection details.
 */
export function ObsPanel() {
  const {statuses, configs, obsRequest} = useServices()
  const {obs, obsConnected} = useLiveData()

  const [version, setVersion] = useState<ObsVersionInfo | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const {preview, sceneName} = useObsPreview(PREVIEW_FRAME_MS)

  // Version info once per connection.
  useEffect(() => {
    if (!obsConnected) {
      setVersion(null)
      return
    }
    let cancelled = false
    obsRequest<ObsVersionInfo>('GetVersion')
      .then((v) => {
        if (!cancelled) setVersion(v)
      })
      .catch(() => {
        // Tolerated; the connection card just omits versions.
      })
    return () => {
      cancelled = true
    }
  }, [obsConnected, obsRequest])

  if (!obsConnected) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
        >
          <Plug size={20} />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">OBS is not connected</p>
          <p className="text-sm text-fg-muted">
            Connect OBS in Settings → Services.
            {configs.obsAutoConnect &&
              ' Jax is checking for OBS every 10 seconds and will connect automatically.'}
          </p>
        </div>
      </div>
    )
  }

  const streaming = Boolean(obs?.outputActive)
  const reconnecting = Boolean(obs?.outputReconnecting)

  return (
    <div className="flex flex-col gap-6">
      {/* Preview + controls with primary sources alongside, then scenes full
          width — all in one container. */}
      <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-surface p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="group relative overflow-hidden rounded-xl border border-edge bg-black">
              {preview ? (
                <img
                  src={preview}
                  alt={`OBS program output${sceneName ? ` — scene ${sceneName}` : ''}`}
                  className="aspect-video w-full object-contain"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center text-fg-muted">
                  <MonitorPlay size={32} aria-hidden />
                </div>
              )}
              <span className="absolute left-2 top-2">
                <StatusPill
                  live={streaming || reconnecting}
                  label={
                    reconnecting
                      ? 'Reconnecting'
                      : streaming
                        ? 'On air'
                        : 'Preview'
                  }
                />
              </span>
              {/* Connection Info: revealed on hover/focus at the top-right. */}
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 delay-700 hover:bg-black/85 focus:opacity-100 focus:delay-0 focus-visible:opacity-100 group-hover:opacity-100 group-hover:delay-0"
              >
                <Info size={14} aria-hidden />
                Connection Info
              </button>
              {sceneName && (
                <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  {sceneName}
                </span>
              )}
            </div>

            {/* Inline stream controls + preview caption beneath the preview. */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <StreamControls />
              <p className="text-xs text-fg-muted">
                Program output at ~{Math.round(1000 / PREVIEW_FRAME_MS)} fps
                over the OBS WebSocket.
              </p>
            </div>
          </div>

          {/* Primary sources (mics, music, webcam), to the right. */}
          <div className="w-full lg:w-80 lg:shrink-0 lg:border-l lg:border-edge lg:pl-4 xl:w-96">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Primary Sources
            </h2>
            <MixerPanel />
          </div>
        </div>

        {/* Scenes, full width beneath the preview + sources. */}
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Scenes
          </h2>
          <ScenesPanel />
        </div>
      </div>

      {/* Everything captured about the connection and encoder, in two
          columns: the connection identity and the encoder metrics. */}
      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="OBS connection details"
        maxWidthClass="max-w-2xl"
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {/* Connection identity. */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Connection
              </p>
              <dl className="divide-y divide-edge">
                <Row label="Address" value={statuses.obs.account || '—'} />
                <Row
                  label="Status"
                  value={
                    reconnecting
                      ? 'Reconnecting'
                      : streaming
                        ? 'Streaming'
                        : 'Connected'
                  }
                />
                {version && (
                  <>
                    <Row label="OBS version" value={version.obsVersion} />
                    <Row
                      label="WebSocket"
                      value={version.obsWebSocketVersion}
                    />
                    <Row label="Platform" value={version.platformDescription} />
                  </>
                )}
                <Row
                  label="Auto-connect"
                  value={configs.obsAutoConnect ? 'On (10s retry)' : 'Off'}
                />
              </dl>
            </div>

            {/* Encoder metrics. */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Encoder
              </p>
              {obs ? (
                <dl className="divide-y divide-edge">
                  <Row
                    label="Bitrate"
                    value={
                      streaming && obs.kbps !== null ? formatKbps(obs.kbps) : '—'
                    }
                  />
                  <Row
                    label="Stream uptime"
                    value={
                      streaming ? formatDurationMs(obs.outputDuration) : '—'
                    }
                  />
                  <Row
                    label="Data output"
                    value={streaming ? formatBytes(obs.outputBytes) : '—'}
                  />
                  <Row
                    label="Congestion"
                    value={
                      streaming
                        ? `${(obs.outputCongestion * 100).toFixed(0)}%`
                        : '—'
                    }
                  />
                  <Row label="FPS" value={String(Math.round(obs.activeFps))} />
                  <Row
                    label="Frame render time"
                    value={`${obs.averageFrameRenderTime.toFixed(1)} ms`}
                  />
                  <Row
                    label="Dropped (network)"
                    value={formatFrameDrops(
                      obs.outputSkippedFrames,
                      obs.outputTotalFrames,
                    )}
                  />
                  <Row
                    label="Skipped (render)"
                    value={formatFrameDrops(
                      obs.renderSkippedFrames,
                      obs.renderTotalFrames,
                    )}
                  />
                  <Row label="CPU" value={`${obs.cpuUsage.toFixed(1)}%`} />
                  <Row
                    label="Memory"
                    value={`${Math.round(obs.memoryUsage)} MB`}
                  />
                  <Row
                    label="Free disk"
                    value={formatBytes(obs.availableDiskSpace * 1e6)}
                  />
                </dl>
              ) : (
                <p className="text-sm text-fg-muted">Waiting for stats…</p>
              )}
            </div>
          </div>
          <p className="text-xs text-fg-muted">
            Stats refresh every {OBS_POLL_MS / 1000}s while OBS is connected.
          </p>
        </div>
      </Modal>
    </div>
  )
}

function Row({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-right text-sm font-medium text-fg">
        {value}
      </dd>
    </div>
  )
}

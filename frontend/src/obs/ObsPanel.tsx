import {Info, MonitorPlay, Plug} from 'lucide-react'
import clsx from 'clsx'
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

/** Target preview frame interval (~10 fps). */
const PREVIEW_FRAME_MS = 100
/** How often the current program scene name is re-checked. */
const SCENE_POLL_MS = 1_000

interface ObsVersionInfo {
  obsVersion: string
  obsWebSocketVersion: string
  platformDescription: string
}

interface ProgramScene {
  currentProgramSceneName: string
}

interface Screenshot {
  imageData: string
}

/**
 * OBS Studio panel for the Live Dashboard: connection details, encoder
 * metrics, and a near-live preview of the program output captured over the
 * OBS WebSocket (GetSourceScreenshot on the current program scene).
 */
export function ObsPanel() {
  const {statuses, configs, obsRequest} = useServices()
  const {obs, obsConnected} = useLiveData()

  const [version, setVersion] = useState<ObsVersionInfo | null>(null)
  const [preview, setPreview] = useState('')
  const [sceneName, setSceneName] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [cardTab, setCardTab] = useState<'connection' | 'controls'>('connection')

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

  // Program-output preview: a self-pacing snapshot loop targeting ~10 fps.
  // Each frame schedules the next only after its capture finishes, so a slow
  // capture can never pile requests up on the OBS socket. The scene name is
  // re-checked once a second rather than per frame.
  useEffect(() => {
    if (!obsConnected) {
      setPreview('')
      setSceneName('')
      return
    }
    let cancelled = false
    let timer: number | undefined
    let scene = ''
    let lastSceneCheck = 0

    const tick = async () => {
      const start = performance.now()
      try {
        if (!scene || start - lastSceneCheck > SCENE_POLL_MS) {
          const s = await obsRequest<ProgramScene>('GetCurrentProgramScene')
          scene = s.currentProgramSceneName
          lastSceneCheck = start
          if (!cancelled) setSceneName(scene)
        }
        const shot = await obsRequest<Screenshot>('GetSourceScreenshot', {
          sourceName: scene,
          imageFormat: 'jpg',
          imageWidth: 640,
          imageCompressionQuality: 60,
        })
        if (!cancelled) setPreview(shot.imageData)
      } catch {
        if (!cancelled) {
          setPreview('')
          scene = '' // re-resolve; the scene may have been renamed/removed
        }
      }
      if (!cancelled) {
        const elapsed = performance.now() - start
        timer = window.setTimeout(
          () => void tick(),
          Math.max(0, PREVIEW_FRAME_MS - elapsed),
        )
      }
    }

    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row">
      {/* Program output preview. */}
      <div className="w-full max-w-xl">
        <div className="relative overflow-hidden rounded-xl border border-edge bg-black">
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
              live={streaming}
              label={streaming ? 'On air' : 'Preview'}
            />
          </span>
          {sceneName && (
            <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {sceneName}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          Program output at ~{Math.round(1000 / PREVIEW_FRAME_MS)} fps over
          the OBS WebSocket.
        </p>
      </div>

      {/* Connection details, height-matched to the preview: on large screens
          the card is absolutely positioned inside a flex-stretched wrapper so
          the preview column alone drives the row height; the key rows show
          here and the full capture lives in the modal. */}
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-col rounded-xl border border-edge bg-surface p-5 lg:absolute lg:inset-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Connection card sections"
              className="flex items-center gap-1 rounded-lg border border-edge bg-bg p-0.5"
            >
              {(
                [
                  {id: 'connection', label: 'Connection'},
                  {id: 'controls', label: 'Controls'},
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={cardTab === t.id}
                  onClick={() => setCardTab(t.id)}
                  className={clsx(
                    'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                    cardTab === t.id
                      ? 'bg-accent text-accent-fg'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <StatusPill
              live={streaming}
              label={
                obs?.outputReconnecting
                  ? 'Reconnecting'
                  : streaming
                    ? 'Streaming'
                    : 'Connected'
              }
            />
          </div>

          {cardTab === 'connection' ? (
            <>
              <dl className="min-h-0 flex-1 divide-y divide-edge overflow-hidden">
                <Row label="Address" value={statuses.obs.account || '—'} />
                {version && (
                  <Row label="OBS version" value={version.obsVersion} />
                )}
                {obs && (
                  <>
                    <Row
                      label="Bitrate"
                      value={
                        streaming && obs.kbps !== null
                          ? formatKbps(obs.kbps)
                          : '—'
                      }
                    />
                    <Row
                      label="Stream uptime"
                      value={
                        streaming ? formatDurationMs(obs.outputDuration) : '—'
                      }
                    />
                    <Row label="FPS" value={String(Math.round(obs.activeFps))} />
                    <Row label="CPU" value={`${obs.cpuUsage.toFixed(1)}%`} />
                  </>
                )}
              </dl>
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
              >
                <Info size={14} aria-hidden />
                Show more details
              </button>
            </>
          ) : (
            <StreamControls />
          )}
        </div>
      </div>
      </div>

      {/* Audio mixer / scenes, beneath the preview. */}
      <ObsTools />

      {/* Everything captured about the connection and encoder. */}
      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="OBS connection details"
      >
        <div className="flex flex-col gap-3">
          <dl className="divide-y divide-edge">
            <Row label="Address" value={statuses.obs.account || '—'} />
            {version && (
              <>
                <Row label="OBS version" value={version.obsVersion} />
                <Row
                  label="WebSocket version"
                  value={version.obsWebSocketVersion}
                />
                <Row label="Platform" value={version.platformDescription} />
              </>
            )}
            <Row
              label="Auto-connect"
              value={configs.obsAutoConnect ? 'On (10s retry)' : 'Off'}
            />
            {obs && (
              <>
                <Row
                  label="Bitrate"
                  value={
                    streaming && obs.kbps !== null ? formatKbps(obs.kbps) : '—'
                  }
                />
                <Row
                  label="Stream uptime"
                  value={streaming ? formatDurationMs(obs.outputDuration) : '—'}
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
                  label="Dropped frames (network)"
                  value={formatFrameDrops(
                    obs.outputSkippedFrames,
                    obs.outputTotalFrames,
                  )}
                />
                <Row
                  label="Skipped frames (render)"
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
                  label="Free disk space"
                  value={formatBytes(obs.availableDiskSpace * 1e6)}
                />
              </>
            )}
          </dl>
          <p className="text-xs text-fg-muted">
            Stats refresh every {OBS_POLL_MS / 1000}s while OBS is connected.
          </p>
        </div>
      </Modal>
    </div>
  )
}

type ObsToolTab = 'mixer' | 'scenes'

/** Tabbed tools: the audio mixer (mics + music) and the scene switcher. */
function ObsTools() {
  const [tab, setTab] = useState<ObsToolTab>('mixer')
  const tabs: {id: ObsToolTab; label: string}[] = [
    {id: 'mixer', label: 'Audio Mixer'},
    {id: 'scenes', label: 'Scenes'},
  ]
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="OBS tools"
        className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-accent text-accent-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'mixer' && <MixerPanel />}
      {tab === 'scenes' && <ScenesPanel />}
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

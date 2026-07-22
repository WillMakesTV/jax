import {
  Circle,
  Eye,
  EyeOff,
  MonitorPlay,
  Pin,
  PinOff,
  Plug,
  ScrollText,
  Settings2,
  Square,
} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {
  GetTeleprompterSchemes,
  GetTeleprompterSettings,
  OpenTeleprompter,
  SetTeleprompterSettings,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useCaptureHidden} from '../lib/captureHidden'
import {formatDurationMs} from '../lib/format'
import {SETTING_KEYS, loadSetting} from '../lib/settings'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'
import {useObsPreview} from './useObsPreview'

/** Target preview frame interval for the record panel (~10 fps). */
const FRAME_MS = 100

/** How often the record output's status is re-read while the panel is up. */
const STATUS_POLL_MS = 1_000

interface RecordStatus {
  outputActive: boolean
  outputDuration: number
}

interface StopRecordResponse {
  outputPath: string
}

/**
 * Record new footage straight from OBS: a program-output preview with
 * start/stop controls driving OBS's own record output. When a recording
 * stops, the file OBS wrote is handed to onRecorded — the caller treats it
 * like any picked footage file.
 */
export function ObsRecordPanel({
  onRecorded,
  recordDir,
  planId,
}: {
  /** Receives the recorded file's absolute path after Stop recording. */
  onRecorded: (path: string) => void
  /** When set, OBS records into this directory instead of its own default
   *  (restored once the recording stops). */
  recordDir?: string
  /** When set, the panel offers the plan's spoken script in its own side
   *  window — the teleprompter, while recording. */
  planId?: string
}) {
  const {obsRequest} = useServices()
  const {obsConnected} = useLiveData()
  const {preview, sceneName} = useObsPreview(FRAME_MS)

  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The same hide-from-capture preference as the status bar's eye, right
  // where a screen-sharing recording is being set up. The script window
  // follows the same flag.
  const [captureHidden, setCaptureHidden] = useCaptureHidden()
  const toggleCaptureHidden = async () => {
    setError('')
    try {
      await setCaptureHidden(!captureHidden)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The capture preference could not be changed.',
      )
    }
  }

  const openPrompter = async () => {
    if (!planId) return
    setError('')
    try {
      await OpenTeleprompter(planId)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The teleprompter could not be opened.',
      )
    }
  }

  // The teleprompter's settings — colours, auto-scroll, keep-on-top — live
  // in the backend so the window and this panel never disagree; a change is
  // applied to an already-open window immediately.
  const [settings, setSettings] = useState<main.TeleprompterSettings | null>(
    null,
  )
  const [schemes, setSchemes] = useState<main.TeleprompterScheme[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    if (!planId) return
    let cancelled = false
    GetTeleprompterSettings()
      .then((s) => {
        if (!cancelled) setSettings(s)
      })
      .catch(() => {})
    GetTeleprompterSchemes()
      .then((s) => {
        if (!cancelled) setSchemes(s ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [planId])

  const applySettings = async (next: main.TeleprompterSettings) => {
    setSettings(next)
    setError('')
    try {
      setSettings(await SetTeleprompterSettings(next))
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The teleprompter settings could not be saved.',
      )
    }
  }

  // OBS's own record directory while we've pointed it at recordDir; restored
  // after the recording stops.
  const prevDir = useRef('')

  // Follow the record output's actual state — it can also be driven from OBS
  // itself — polling while the panel is on screen.
  useEffect(() => {
    if (!obsConnected) {
      setRecording(false)
      setDuration(0)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const s = await obsRequest<RecordStatus>('GetRecordStatus')
        if (!cancelled) {
          setRecording(s.outputActive)
          setDuration(s.outputDuration)
        }
      } catch {
        // Tolerated; the next poll retries.
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), STATUS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [obsConnected, obsRequest])

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      if (recordDir) {
        // Point OBS's record output at the caller's folder for this take,
        // remembering its own directory to put back afterwards. An OBS too
        // old for SetRecordDirectory just keeps its default.
        try {
          const {recordDirectory} = await obsRequest<{
            recordDirectory: string
          }>('GetRecordDirectory')
          await obsRequest('SetRecordDirectory', {
            recordDirectory: recordDir,
          })
          prevDir.current = recordDirectory
        } catch {
          prevDir.current = ''
        }
      }
      await obsRequest('StartRecord')
      setRecording(true)
      setDuration(0)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The recording could not be started.',
      )
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    setError('')
    try {
      const {outputPath} = await obsRequest<StopRecordResponse>('StopRecord')
      setRecording(false)
      setDuration(0)
      if (prevDir.current) {
        // Give OBS its own record directory back.
        void obsRequest('SetRecordDirectory', {
          recordDirectory: prevDir.current,
        }).catch(() => {})
        prevDir.current = ''
      }
      if (outputPath) onRecorded(outputPath)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The recording could not be stopped.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!obsConnected) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-4">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
        >
          <Plug size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">OBS is not connected</p>
          <p className="text-sm text-fg-muted">
            Connect OBS in Settings → Services to record footage from it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface">
      <div className="relative bg-black">
        {preview ? (
          <img
            src={preview}
            alt={`OBS program output${sceneName ? ` — scene ${sceneName}` : ''}`}
            className="aspect-video w-full object-contain"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center text-fg-muted">
            <MonitorPlay size={28} aria-hidden />
          </div>
        )}
        {recording && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white">
            <Circle
              size={8}
              aria-hidden
              fill="currentColor"
              className="animate-pulse"
            />
            REC {formatDurationMs(duration)}
          </span>
        )}
        {sceneName && (
          <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {sceneName}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 p-3">
        {recording ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Square size={13} aria-hidden fill="currentColor" />
            {busy ? 'Stopping…' : 'Stop recording'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Circle size={13} aria-hidden fill="currentColor" />
            {busy ? 'Starting…' : 'Start recording'}
          </button>
        )}
        {planId && (
          <>
            <button
              type="button"
              onClick={() => void openPrompter()}
              title="Open the plan's spoken script in its own window beside the app — it follows the hide-from-capture setting"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              <ScrollText size={13} aria-hidden />
              Teleprompter
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-pressed={settingsOpen}
              title="Colours, auto-scroll and keep-on-top for the teleprompter"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              <Settings2 size={13} aria-hidden />
              Prompter settings
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void toggleCaptureHidden()}
          title={
            captureHidden
              ? 'The app (and the script window) is hidden from screen captures — click to show it again'
              : 'Hide the app (and the script window) from screen captures, shares, and screenshots'
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          {captureHidden ? (
            <EyeOff size={13} aria-hidden />
          ) : (
            <Eye size={13} aria-hidden />
          )}
          {captureHidden ? 'Hidden from capture' : 'Hide from capture'}
        </button>
        <p className="text-xs text-fg-muted">
          {recordDir
            ? "Records OBS's program output straight into the plan's sources folder; the file is added to the plan when the recording stops."
            : "Records OBS's program output to its configured recording folder; the file is added to the plan when the recording stops."}
        </p>
        {planId && settingsOpen && settings && (
          <div className="w-full rounded-lg border border-edge bg-bg p-3">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-fg">
                Colours
                <select
                  value={settings.scheme}
                  onChange={(e) =>
                    void applySettings(
                      main.TeleprompterSettings.createFrom({
                        ...settings,
                        scheme: e.target.value,
                      }),
                    )
                  }
                  className="rounded-lg border border-edge bg-surface px-2 py-1 text-sm text-fg outline-none focus:border-accent"
                >
                  {schemes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={settings.scroll}
                  onChange={(e) =>
                    void applySettings(
                      main.TeleprompterSettings.createFrom({
                        ...settings,
                        scroll: e.target.checked,
                      }),
                    )
                  }
                  className="h-4 w-4 accent-accent"
                />
                Scroll while reading
              </label>

              {/* The speed only means anything while the scroll is on. */}
              <label
                className={
                  settings.scroll
                    ? 'flex items-center gap-2 text-sm text-fg'
                    : 'flex items-center gap-2 text-sm text-fg-muted'
                }
              >
                Speed
                <input
                  type="range"
                  min={6}
                  max={120}
                  step={2}
                  value={settings.speed}
                  disabled={!settings.scroll}
                  onChange={(e) =>
                    void applySettings(
                      main.TeleprompterSettings.createFrom({
                        ...settings,
                        speed: Number(e.target.value),
                      }),
                    )
                  }
                  className="accent-accent"
                />
                <span className="w-24 tabular-nums text-xs text-fg-muted">
                  {settings.speed} lines/min
                </span>
              </label>

              <button
                type="button"
                onClick={() =>
                  void applySettings(
                    main.TeleprompterSettings.createFrom({
                      ...settings,
                      topmost: !settings.topmost,
                    }),
                  )
                }
                aria-pressed={settings.topmost}
                title={
                  settings.topmost
                    ? 'The teleprompter stays above every other window — click to let it fall behind again'
                    : 'Keep the teleprompter above every other window, so it stays readable over OBS or a game'
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                {settings.topmost ? (
                  <Pin size={13} aria-hidden />
                ) : (
                  <PinOff size={13} aria-hidden />
                )}
                {settings.topmost ? 'Kept on top' : 'Keep on top'}
              </button>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              Changes apply to an open teleprompter straight away.
            </p>
          </div>
        )}
        {error && (
          <p className="w-full text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

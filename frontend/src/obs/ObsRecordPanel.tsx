import {
  Circle,
  Eye,
  EyeOff,
  MonitorPlay,
  Plug,
  ScrollText,
  Square,
} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {OpenScriptWindow} from '../../wailsjs/go/main/App'
import {useCaptureHidden} from '../lib/captureHidden'
import {formatDurationMs} from '../lib/format'
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
  /** When set, the panel offers the plan's script in its own side window —
   *  the teleprompter while recording. */
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

  const showScript = async () => {
    if (!planId) return
    setError('')
    try {
      await OpenScriptWindow(planId)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The script window could not be opened.',
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
          <button
            type="button"
            onClick={() => void showScript()}
            title="Open the plan's script in its own window beside the app — it follows the hide-from-capture setting"
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            <ScrollText size={13} aria-hidden />
            Show script
          </button>
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
        {error && (
          <p className="w-full text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

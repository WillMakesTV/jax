import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AddTranscriptLine,
  BeginTranscriptSession,
  GetTranscriptForStream,
  StartTranscription,
  StopTranscription,
} from '../../wailsjs/go/main/App'
import {EventsOn} from '../../wailsjs/runtime/runtime'
import {obsMicDeviceLabel} from '../lib/obs'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'

/** One transcript line: consecutive speech grouped chat-style. */
export interface TranscriptLine {
  id: string
  text: string
  /** Unix millis of the first words in the group. */
  at: number
  /** Unix millis when the group's last utterance ended. */
  endAt: number
}

/** The transcriber's lifecycle, mirrored from its status events. */
export type TranscriptPhase = 'idle' | 'loading' | 'listening'

/** A new group starts when speech pauses longer than this. */
const GROUP_GAP_MS = 4_000
/** Groups stop growing past this length so lines stay readable. */
const GROUP_MAX_CHARS = 400
/** Bounded history. */
const MAX_LINES = 500

/**
 * Fold one utterance into a chat-style grouped line list: continuous speech
 * joins the previous group, a pause (or an oversized group) starts a new one.
 * Shared by the live feed and stored-transcript rendering.
 */
export function foldTranscriptLine(
  prev: TranscriptLine[],
  text: string,
  at: number,
  endAt: number,
): TranscriptLine[] {
  const trimmed = text.trim()
  if (!trimmed) return prev
  const last = prev[prev.length - 1]
  if (
    last &&
    at - last.endAt < GROUP_GAP_MS &&
    last.text.length < GROUP_MAX_CHARS
  ) {
    const merged = {...last, text: `${last.text} ${trimmed}`, endAt}
    return [...prev.slice(0, -1), merged]
  }
  return [...prev, {id: `${at}-${prev.length}`, text: trimmed, at, endAt}]
}

/** Group a stored transcript (raw utterances, spoken order) for display. */
export function groupTranscriptLines(
  items: {text: string; at: number; endAt: number}[],
): TranscriptLine[] {
  return items.reduce<TranscriptLine[]>(
    (acc, item) => foldTranscriptLine(acc, item.text, item.at, item.endAt),
    [],
  )
}

/** One JSON line from the transcriber sidecar. */
interface SidecarMessage {
  status?: string
  device?: string
  error?: string
  text?: string
  start?: number // unix seconds
  end?: number
}

interface TranscriptContextValue {
  lines: TranscriptLine[]
  capturing: boolean
  phase: TranscriptPhase
  /** The device being captured, once known. */
  deviceLabel: string
  error: string
  start: () => Promise<void>
  stop: () => void
  clear: () => void
}

const TranscriptContext = createContext<TranscriptContextValue | undefined>(
  undefined,
)

/**
 * Live local transcription of the broadcaster's microphone. The Go backend
 * runs a Python sidecar (ffmpeg capture -> VAD -> faster-whisper, fully
 * offline — the same pipeline as the twitch-chatter-bot project) on the
 * device that is enabled (unmuted) in OBS, and streams utterances back as
 * events. Utterances are grouped into chat-style lines by when they were
 * spoken. Mounted app-wide so a running capture survives navigation.
 *
 * Capture is automatic: it starts whenever a broadcast is live AND an OBS
 * microphone is enabled, and stops when either ends. A manual Stop pauses
 * the automation until the conditions reset (e.g. the next stream).
 */
export function TranscriptProvider({children}: {children: ReactNode}) {
  const {obsRequest} = useServices()
  const {platforms, obs, mics, obsConnected} = useLiveData()
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [capturing, setCapturing] = useState(false)
  const [phase, setPhase] = useState<TranscriptPhase>('idle')
  const [deviceLabel, setDeviceLabel] = useState('')
  const [error, setError] = useState('')

  // Manual Stop while conditions still hold suppresses auto-restart until
  // they reset, so the automation never fights the user.
  const userPaused = useRef(false)

  // The backend transcript-log session lines are appended to (0 = none, e.g.
  // storage unavailable). Sessions are keyed by the stream's start time, so
  // capture restarts within one stream append to the same log.
  const sessionId = useRef(0)

  // The stream start whose stored transcript has been restored into the tab.
  const seededFor = useRef('')

  const appendText = useCallback((text: string, at: number, endAt: number) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setLines((prev) => {
      const last = prev[prev.length - 1]
      // Continuous speech joins the previous group; a pause starts a new one.
      if (
        last &&
        at - last.endAt < GROUP_GAP_MS &&
        last.text.length < GROUP_MAX_CHARS
      ) {
        const merged = {...last, text: `${last.text} ${trimmed}`, endAt}
        return [...prev.slice(0, -1), merged]
      }
      const next = [
        ...prev,
        {id: `${at}-${prev.length}`, text: trimmed, at, endAt},
      ]
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }, [])

  // Sidecar events, forwarded by the backend.
  useEffect(() => {
    const offLine = EventsOn('transcript:line', (raw: string) => {
      let msg: SidecarMessage
      try {
        msg = JSON.parse(raw) as SidecarMessage
      } catch {
        return
      }
      if (msg.error) {
        setError(msg.error)
        return
      }
      if (msg.status) {
        // 'ready' (model warm at app startup) changes nothing user-visible;
        // 'stopped' arrives after a stop command completes.
        if (msg.status === 'listening') setPhase('listening')
        else if (msg.status === 'stopped') setPhase('idle')
        else if (msg.status === 'loading') setPhase('loading')
        if (msg.device) setDeviceLabel(msg.device)
        return
      }
      if (msg.text && msg.start && msg.end) {
        const at = Math.round(msg.start * 1000)
        const endAt = Math.round(msg.end * 1000)
        appendText(msg.text, at, endAt)
        // Persist the raw utterance to the stream's transcript log.
        if (sessionId.current) {
          AddTranscriptLine(sessionId.current, at, endAt, msg.text).catch(() => {
            // Storage hiccups shouldn't interrupt live captioning.
          })
        }
      }
    })
    const offExit = EventsOn('transcript:exit', (detail: string) => {
      setCapturing(false)
      setPhase('idle')
      if (detail) setError(detail)
    })
    return () => {
      offLine()
      offExit()
    }
  }, [appendText])

  const start = useCallback(async () => {
    setError('')
    userPaused.current = false // an explicit start re-arms the automation
    if (!obsConnected) {
      setError('Connect OBS first — the transcript follows its enabled microphone.')
      return
    }
    const enabled = mics.find((m) => !m.muted)
    if (!enabled) {
      setError('No unmuted audio input capture device in OBS to transcribe.')
      return
    }
    try {
      // '' when OBS uses the OS default; the sidecar then picks the first
      // available capture device.
      const label = await obsMicDeviceLabel(obsRequest, enabled.name)
      setDeviceLabel(label || 'Default microphone')
      await StartTranscription(label)
      setCapturing(true)
      setPhase('loading')

      // Open (or reopen) this stream's transcript log, keyed by the earliest
      // live platform's start time so it matches the aggregated past stream.
      const live = platforms.filter((p) => p.live)
      const startedAt =
        live
          .map((p) => p.startedAt)
          .filter(Boolean)
          .sort()[0] ?? new Date().toISOString()
      const title = live.find((p) => p.title)?.title ?? ''
      sessionId.current = await BeginTranscriptSession(startedAt, title).catch(
        () => 0,
      )
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not start the transcriber.',
      )
    }
  }, [obsConnected, mics, platforms, obsRequest])

  // Restore the stream's stored transcript when the app (re)opens while a
  // broadcast is already running, so the tab shows the whole stream — not
  // just what was transcribed since launch. Anything transcribed while the
  // history loads is folded back in on top.
  const liveStartedAt =
    platforms
      .filter((p) => p.live)
      .map((p) => p.startedAt)
      .filter(Boolean)
      .sort()[0] ?? ''
  useEffect(() => {
    if (!liveStartedAt || seededFor.current === liveStartedAt) return
    seededFor.current = liveStartedAt
    GetTranscriptForStream(liveStartedAt)
      .then((stored) => {
        if (!stored || stored.length === 0) return
        setLines((prev) => {
          let merged = groupTranscriptLines(stored)
          const lastEnd = merged[merged.length - 1]?.endAt ?? 0
          for (const line of prev) {
            if (line.at > lastEnd) {
              merged = foldTranscriptLine(merged, line.text, line.at, line.endAt)
            }
          }
          return merged.length > MAX_LINES
            ? merged.slice(merged.length - MAX_LINES)
            : merged
        })
      })
      .catch(() => {
        // Storage unavailable; live captioning still works.
      })
  }, [liveStartedAt])

  const stopCapture = useCallback(() => {
    void StopTranscription()
    setCapturing(false)
    setPhase('idle')
  }, [])

  /** Manual stop: also pauses auto-start until the live/mic conditions reset. */
  const stop = useCallback(() => {
    userPaused.current = true
    stopCapture()
  }, [stopCapture])

  // Automation: capture whenever a broadcast is live and an OBS microphone
  // is enabled; stop when either condition ends. Keyed on transitions so a
  // failed start does not retry in a loop (the panel shows the error and the
  // manual button remains).
  const {anyLive} = aggregateLive(platforms, obs)
  const micEnabled = mics.some((m) => !m.muted)
  const shouldCapture = obsConnected && anyLive && micEnabled
  const prevShould = useRef(false)
  useEffect(() => {
    if (shouldCapture && !prevShould.current) {
      if (!userPaused.current && !capturing) void start()
    } else if (!shouldCapture && prevShould.current) {
      userPaused.current = false // conditions reset; re-arm for next time
      if (capturing) stopCapture()
    }
    prevShould.current = shouldCapture
  }, [shouldCapture, capturing, start, stopCapture])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<TranscriptContextValue>(
    () => ({lines, capturing, phase, deviceLabel, error, start, stop, clear}),
    [lines, capturing, phase, deviceLabel, error, start, stop, clear],
  )

  return (
    <TranscriptContext.Provider value={value}>
      {children}
    </TranscriptContext.Provider>
  )
}

export function useTranscript(): TranscriptContextValue {
  const context = useContext(TranscriptContext)
  if (!context) {
    throw new Error('useTranscript must be used within a TranscriptProvider')
  }
  return context
}

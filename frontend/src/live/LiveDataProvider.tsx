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
import {GetLiveStreams} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useServices} from '../services/ServicesProvider'

/**
 * App-wide live-broadcast data: Twitch/YouTube stream state from the Go
 * backend and OBS encoder stats over its WebSocket. One provider polls so the
 * Streams page and the status bar share the same data (and API budget).
 *
 * Platform APIs are polled slowly by default — the YouTube Data API has a
 * daily quota, and an all-day 10s poll would exhaust it. Views that want
 * fresher data (the Streams page) call requestFastPolling() while mounted.
 */

/** Platform poll cadence while a consumer has requested fast polling. */
const PLATFORM_POLL_FAST_MS = 10_000
/** Baseline platform poll cadence (status bar only). */
const PLATFORM_POLL_SLOW_MS = 60_000
/** OBS stats poll cadence (local WebSocket; cheap). */
export const OBS_POLL_MS = 5_000

/** obs-websocket v5 GetStats response (fields we use). */
interface ObsStats {
  cpuUsage: number
  memoryUsage: number
  availableDiskSpace: number
  activeFps: number
  averageFrameRenderTime: number
  renderSkippedFrames: number
  renderTotalFrames: number
}

/** obs-websocket v5 GetStreamStatus response (fields we use). */
interface ObsStreamStatus {
  outputActive: boolean
  outputReconnecting: boolean
  outputDuration: number
  outputCongestion: number
  outputBytes: number
  outputSkippedFrames: number
  outputTotalFrames: number
}

/** Snapshot of OBS encoder health, one poll tick. */
export interface ObsMetrics extends ObsStats, ObsStreamStatus {
  /** Output bitrate computed from the byte delta between polls; null on the first tick. */
  kbps: number | null
}

interface LiveDataContextValue {
  /** Per-platform broadcast state (connected platforms only). */
  platforms: main.LiveStream[]
  /** OBS encoder metrics, or null when OBS is unavailable. */
  obs: ObsMetrics | null
  oauthConnected: boolean
  obsConnected: boolean
  /**
   * Ask for fast platform polling while the calling view is mounted. Returns
   * a cleanup that releases the request — call from a useEffect.
   */
  requestFastPolling: () => () => void
}

const LiveDataContext = createContext<LiveDataContextValue | undefined>(
  undefined,
)

/** Cross-platform aggregates shared by the Streams page and the status bar. */
export function aggregateLive(
  platforms: main.LiveStream[],
  obs: ObsMetrics | null,
) {
  const live = platforms.filter((p) => p.live)
  const anyLive = live.length > 0 || Boolean(obs?.outputActive)
  const totalViewers = live.reduce((sum, p) => sum + p.viewerCount, 0)

  // Uptime: earliest platform start, falling back to OBS's output duration.
  const earliestStart = live
    .map((p) => Date.parse(p.startedAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)[0]
  const uptimeMs =
    earliestStart !== undefined
      ? Date.now() - earliestStart
      : obs?.outputActive
        ? obs.outputDuration
        : null

  return {anyLive, liveCount: live.length, totalViewers, uptimeMs}
}

export function LiveDataProvider({children}: {children: ReactNode}) {
  const {statuses, obsRequest} = useServices()
  const [platforms, setPlatforms] = useState<main.LiveStream[]>([])
  const [obs, setObs] = useState<ObsMetrics | null>(null)
  const [fastCount, setFastCount] = useState(0)
  const prevBytes = useRef<{bytes: number; at: number} | null>(null)

  const oauthConnected = statuses.twitch.connected || statuses.youtube.connected
  const obsConnected = statuses.obs.connected

  const requestFastPolling = useCallback(() => {
    setFastCount((c) => c + 1)
    return () => setFastCount((c) => Math.max(0, c - 1))
  }, [])

  // Twitch / YouTube via the Go backend.
  const platformPollMs =
    fastCount > 0 ? PLATFORM_POLL_FAST_MS : PLATFORM_POLL_SLOW_MS
  useEffect(() => {
    if (!oauthConnected) {
      setPlatforms([])
      return
    }
    let cancelled = false
    const tick = () => {
      GetLiveStreams()
        .then((result) => {
          if (!cancelled) setPlatforms(result ?? [])
        })
        .catch(() => {
          // Backend unavailable; keep the last snapshot.
        })
    }
    tick()
    const id = window.setInterval(tick, platformPollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [oauthConnected, platformPollMs])

  // OBS encoder stats over its WebSocket.
  useEffect(() => {
    if (!obsConnected) {
      setObs(null)
      prevBytes.current = null
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const [stats, stream] = await Promise.all([
          obsRequest<ObsStats>('GetStats'),
          obsRequest<ObsStreamStatus>('GetStreamStatus'),
        ])
        if (cancelled) return

        // Bitrate from the byte delta between this poll and the previous one.
        let kbps: number | null = null
        const now = Date.now()
        const prev = prevBytes.current
        if (prev && stream.outputBytes >= prev.bytes && now > prev.at) {
          kbps = ((stream.outputBytes - prev.bytes) * 8) / (now - prev.at)
        }
        prevBytes.current = {bytes: stream.outputBytes, at: now}

        setObs({...stats, ...stream, kbps})
      } catch {
        if (!cancelled) setObs(null)
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), OBS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [obsConnected, obsRequest])

  const value = useMemo<LiveDataContextValue>(
    () => ({platforms, obs, oauthConnected, obsConnected, requestFastPolling}),
    [platforms, obs, oauthConnected, obsConnected, requestFastPolling],
  )

  return (
    <LiveDataContext.Provider value={value}>
      {children}
    </LiveDataContext.Provider>
  )
}

export function useLiveData(): LiveDataContextValue {
  const context = useContext(LiveDataContext)
  if (!context) {
    throw new Error('useLiveData must be used within a LiveDataProvider')
  }
  return context
}

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
import {
  fetchObsCamera,
  fetchObsMics,
  type ObsCamera,
  type ObsMic,
} from '../lib/obs'
import {loadSceneCameras} from '../lib/sceneCameras'
import {SETTING_KEYS, loadSetting} from '../lib/settings'
import {useServices} from '../services/ServicesProvider'
import {anyChannelConnected} from '../services/services'

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
  /**
   * OBS's audio input capture devices (microphones) and their mute state.
   * Refreshed with the stats poll; mute changes apply instantly via events.
   */
  mics: ObsMic[]
  /**
   * The Application Audio Capture source designated as "Music" (OBS tab →
   * Primary Sources) and its mute state; null when none is designated or the
   * source is missing from OBS.
   */
  music: ObsMic | null
  /**
   * The active (program) scene's designated primary camera and its
   * visibility; null when none is designated or the source is not in the
   * active scene.
   */
  camera: ObsCamera | null
  /** The current OBS program scene name ('' when unknown/disconnected). */
  programScene: string
  /** Input name designated as the primary microphone ('' when unset). */
  micSourceName: string
  /** Recompute the active scene's primary camera (after a designation change). */
  refreshCamera: () => void
  /**
   * Bumped whenever a source designation (mic/music/camera) might have
   * changed; panels re-read their settings when this changes.
   */
  sourcesRev: number
  /** Re-read designations and re-poll OBS immediately (after a change). */
  refreshObs: () => void
  oauthConnected: boolean
  obsConnected: boolean
  /**
   * Ask for fast platform polling while the calling view is mounted. Returns
   * a cleanup that releases the request — call from a useEffect.
   */
  requestFastPolling: () => () => void
  /** Re-poll the platforms immediately (e.g. after clearing a cache). */
  refreshPlatforms: () => void
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
  const {statuses, obsRequest, onObsEvent} = useServices()
  const [platforms, setPlatforms] = useState<main.LiveStream[]>([])
  const [obs, setObs] = useState<ObsMetrics | null>(null)
  const [mics, setMics] = useState<ObsMic[]>([])
  const [music, setMusic] = useState<ObsMic | null>(null)
  const [camera, setCamera] = useState<ObsCamera | null>(null)
  const [programScene, setProgramScene] = useState('')
  const [micSourceName, setMicSourceName] = useState('')
  const [fastCount, setFastCount] = useState(0)
  const prevBytes = useRef<{bytes: number; at: number} | null>(null)

  // Bumped by refreshObs after a designation change; forces the OBS effect to
  // re-run and signals panels to re-read their settings.
  const [obsNonce, setObsNonce] = useState(0)
  const refreshObs = useCallback(() => setObsNonce((n) => n + 1), [])

  const oauthConnected = anyChannelConnected(statuses)
  const obsConnected = statuses.obs.connected

  const requestFastPolling = useCallback(() => {
    setFastCount((c) => c + 1)
    return () => setFastCount((c) => Math.max(0, c - 1))
  }, [])

  // Bumping the nonce re-runs the platform poll effect, ticking immediately.
  const [pollNonce, setPollNonce] = useState(0)
  const refreshPlatforms = useCallback(() => setPollNonce((n) => n + 1), [])

  // Resolve the active (program) scene's designated primary camera.
  const refreshCamera = useCallback(async () => {
    try {
      const {currentProgramSceneName: scene} = await obsRequest<{
        currentProgramSceneName: string
      }>('GetCurrentProgramScene')
      setProgramScene(scene)
      const cams = await loadSceneCameras()
      setCamera(await fetchObsCamera(obsRequest, scene, cams[scene] ?? ''))
    } catch {
      setCamera(null)
    }
  }, [obsRequest])

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
  }, [oauthConnected, platformPollMs, pollNonce])

  // OBS encoder stats over its WebSocket.
  useEffect(() => {
    if (!obsConnected) {
      setObs(null)
      setMics([])
      setMusic(null)
      setCamera(null)
      setProgramScene('')
      setMicSourceName('')
      prevBytes.current = null
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const [stats, stream, micList] = await Promise.all([
          obsRequest<ObsStats>('GetStats'),
          obsRequest<ObsStreamStatus>('GetStreamStatus'),
          fetchObsMics(obsRequest),
        ])
        if (cancelled) return
        setMics(micList)

        // The designated primary mic (a label over the mic list; drives the
        // status bar). Re-read each tick to pick up (re)designations.
        try {
          const micName = (await loadSetting(SETTING_KEYS.obsMicSource)) ?? ''
          if (!cancelled) setMicSourceName(micName)
        } catch {
          if (!cancelled) setMicSourceName('')
        }

        // The designated Music source's mute state. Re-reading the setting
        // each tick also picks up (re)designations made in Primary Sources.
        try {
          const name = (await loadSetting(SETTING_KEYS.obsMusicSource)) ?? ''
          if (!name) {
            if (!cancelled) setMusic(null)
          } else {
            const {inputMuted} = await obsRequest<{inputMuted: boolean}>(
              'GetInputMute',
              {inputName: name},
            )
            if (!cancelled) setMusic({name, muted: inputMuted})
          }
        } catch {
          // Designated source missing from OBS; hide the indicator.
          if (!cancelled) setMusic(null)
        }

        // Bitrate from the byte delta between this poll and the previous one.
        let kbps: number | null = null
        const now = Date.now()
        const prev = prevBytes.current
        if (prev && stream.outputBytes >= prev.bytes && now > prev.at) {
          kbps = ((stream.outputBytes - prev.bytes) * 8) / (now - prev.at)
        }
        prevBytes.current = {bytes: stream.outputBytes, at: now}

        setObs({...stats, ...stream, kbps})
        void refreshCamera()
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
  }, [obsConnected, obsRequest, refreshCamera, obsNonce])

  // Mute toggles apply instantly (from OBS itself or our own UI) between
  // stats polls.
  useEffect(() => {
    if (!obsConnected) return
    return onObsEvent<{inputName: string; inputMuted: boolean}>(
      'InputMuteStateChanged',
      (e) => {
        setMics((prev) =>
          prev.map((m) =>
            m.name === e.inputName ? {...m, muted: e.inputMuted} : m,
          ),
        )
        setMusic((prev) =>
          prev && prev.name === e.inputName
            ? {...prev, muted: e.inputMuted}
            : prev,
        )
      },
    )
  }, [obsConnected, onObsEvent])

  // Keep the active scene's primary camera fresh: program-scene switches
  // recompute it; visibility toggles of the camera item apply in place.
  useEffect(() => {
    if (!obsConnected) return
    const offs = [
      onObsEvent<{sceneName: string}>('CurrentProgramSceneChanged', () => {
        void refreshCamera()
      }),
      onObsEvent<{
        sceneName: string
        sceneItemId: number
        sceneItemEnabled: boolean
      }>('SceneItemEnableStateChanged', (e) => {
        setCamera((prev) =>
          prev &&
          prev.sceneName === e.sceneName &&
          prev.sceneItemId === e.sceneItemId
            ? {...prev, enabled: e.sceneItemEnabled}
            : prev,
        )
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [obsConnected, onObsEvent, refreshCamera])

  const value = useMemo<LiveDataContextValue>(
    () => ({
      platforms,
      obs,
      mics,
      music,
      camera,
      programScene,
      micSourceName,
      refreshCamera,
      sourcesRev: obsNonce,
      refreshObs,
      oauthConnected,
      obsConnected,
      requestFastPolling,
      refreshPlatforms,
    }),
    [
      platforms,
      obs,
      mics,
      music,
      camera,
      programScene,
      micSourceName,
      refreshCamera,
      obsNonce,
      refreshObs,
      oauthConnected,
      obsConnected,
      requestFastPolling,
      refreshPlatforms,
    ],
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

import {
  Mic,
  MicOff,
  Music,
  RefreshCw,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
import {fetchSceneCameraSources} from '../lib/obs'
import {loadSceneCameras, saveSceneCameras} from '../lib/sceneCameras'
import {SETTING_KEYS, loadSetting, saveSetting} from '../lib/settings'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'

/** How often the level meters repaint (events arrive faster; we batch). */
const METER_PAINT_MS = 100

/** OBS input kind for "Application Audio Capture" (the Music candidates). */
const APP_AUDIO_KIND = 'wasapi_process_output_capture'

/** Volume-meter peak (mul, 0..1) → dBFS, floored at -60. */
const dbOf = (mul: number) => (mul > 0 ? 20 * Math.log10(mul) : -60)

/**
 * Primary Sources: OBS's audio input capture devices (microphones), the
 * Application Audio Capture source designated as "Music" (both with live
 * level meters and mute toggles), and the active scene's primary webcam
 * (visibility toggle). The high-volume InputVolumeMeters event stream is
 * enabled only while this panel is mounted.
 *
 * `compact` renders a minimal glance view: no section headings, no
 * change-source controls or labels — just an icon toggle and level meter per
 * source, tightly stacked.
 */
export function MixerPanel({compact = false}: {compact?: boolean} = {}) {
  const {
    mics,
    camera,
    programScene,
    micSourceName,
    refreshCamera,
    sourcesRev,
    refreshObs,
    obsConnected,
  } = useLiveData()
  const {obsRequest, onObsEvent, setObsMeterEvents} = useServices()
  const [levels, setLevels] = useState<Record<string, number>>({})
  const levelsRef = useRef<Record<string, number>>({})
  const [error, setError] = useState('')

  // The designated Music source (null while the setting loads; '' = unset).
  const [musicSource, setMusicSource] = useState<string | null>(null)
  const [musicMuted, setMusicMuted] = useState(false)
  const [appInputs, setAppInputs] = useState<string[]>([])
  const [picking, setPicking] = useState(false)

  // Camera-kind sources present in the active scene, for the webcam picker.
  const [cameraSources, setCameraSources] = useState<string[]>([])
  const [pickingCamera, setPickingCamera] = useState(false)

  // Ask OBS for volume-meter events only while this panel is on screen.
  useEffect(() => {
    if (!obsConnected) return
    setObsMeterEvents(true)
    return () => setObsMeterEvents(false)
  }, [obsConnected, setObsMeterEvents])

  // Meter events arrive ~every 50ms; buffer them and repaint on a timer.
  useEffect(() => {
    if (!obsConnected) return
    const off = onObsEvent<{
      inputs: {inputName: string; inputLevelsMul: number[][]}[]
    }>('InputVolumeMeters', (e) => {
      for (const input of e.inputs ?? []) {
        levelsRef.current[input.inputName] = Math.max(
          0,
          ...(input.inputLevelsMul ?? []).map((ch) => ch[1] ?? 0),
        )
      }
    })
    const id = window.setInterval(
      () => setLevels({...levelsRef.current}),
      METER_PAINT_MS,
    )
    return () => {
      off()
      window.clearInterval(id)
    }
  }, [obsConnected, onObsEvent])

  // Load the persisted Music designation; re-read when it changes anywhere
  // (e.g. designated from the Scenes source list).
  useEffect(() => {
    loadSetting(SETTING_KEYS.obsMusicSource).then((v) => setMusicSource(v ?? ''))
  }, [sourcesRev])

  // Application Audio Capture sources available as Music candidates.
  const refreshAppInputs = useCallback(async () => {
    try {
      const {inputs} = await obsRequest<{
        inputs: {inputName: string; inputKind: string}[]
      }>('GetInputList')
      setAppInputs(
        (inputs ?? [])
          .filter((i) => i.inputKind === APP_AUDIO_KIND)
          .map((i) => i.inputName),
      )
    } catch {
      setAppInputs([])
    }
  }, [obsRequest])
  useEffect(() => {
    if (obsConnected) void refreshAppInputs()
  }, [obsConnected, refreshAppInputs])

  const musicActive = Boolean(musicSource && appInputs.includes(musicSource))

  // Music mute state, kept fresh via mute events.
  useEffect(() => {
    if (!obsConnected || !musicActive || !musicSource) return
    obsRequest<{inputMuted: boolean}>('GetInputMute', {inputName: musicSource})
      .then((r) => setMusicMuted(r.inputMuted))
      .catch(() => {})
    return onObsEvent<{inputName: string; inputMuted: boolean}>(
      'InputMuteStateChanged',
      (e) => {
        if (e.inputName === musicSource) setMusicMuted(e.inputMuted)
      },
    )
  }, [obsConnected, musicActive, musicSource, obsRequest, onObsEvent])

  const toggleMute = (name: string) => {
    setError('')
    obsRequest('ToggleInputMute', {inputName: name}).catch(() => {
      setError(`Could not toggle ${name}.`)
    })
    // The InputMuteStateChanged event updates the pill.
  }

  const designateMusic = (name: string) => {
    saveSetting(SETTING_KEYS.obsMusicSource, name)
    setMusicSource(name)
    setPicking(false)
    refreshObs()
  }

  // Camera sources available in the active scene (refreshed with the scene).
  const refreshCameraSources = useCallback(async () => {
    if (!programScene) {
      setCameraSources([])
      return
    }
    try {
      setCameraSources(await fetchSceneCameraSources(obsRequest, programScene))
    } catch {
      setCameraSources([])
    }
  }, [obsRequest, programScene])
  useEffect(() => {
    if (obsConnected) void refreshCameraSources()
    setPickingCamera(false)
  }, [obsConnected, refreshCameraSources])

  const toggleCamera = () => {
    if (!camera) return
    setError('')
    obsRequest('SetSceneItemEnabled', {
      sceneName: camera.sceneName,
      sceneItemId: camera.sceneItemId,
      sceneItemEnabled: !camera.enabled,
    })
      .then(() => refreshCamera())
      .catch(() => setError(`Could not toggle ${camera.name}.`))
    // The SceneItemEnableStateChanged event also updates the state.
  }

  const designateCamera = async (name: string) => {
    const cams = await loadSceneCameras()
    cams[programScene] = name
    saveSceneCameras(cams)
    setPickingCamera(false)
    refreshCamera()
    refreshObs()
  }

  if (compact) {
    return (
      <div>
        <ul className="flex flex-col gap-1.5">
          {mics.map((mic) => (
            <CompactRow
              key={mic.name}
              kind="mic"
              off={mic.muted}
              db={dbOf(mic.muted ? 0 : levels[mic.name] ?? 0)}
              onToggle={() => toggleMute(mic.name)}
            />
          ))}
          {musicActive && musicSource && (
            <CompactRow
              kind="music"
              off={musicMuted}
              db={dbOf(musicMuted ? 0 : levels[musicSource] ?? 0)}
              onToggle={() => toggleMute(musicSource)}
            />
          )}
          {camera && (
            <CompactRow
              kind="camera"
              off={!camera.enabled}
              onToggle={toggleCamera}
            />
          )}
        </ul>
        {mics.length === 0 && !musicActive && !camera && (
          <p className="text-sm text-fg-muted">No sources found in OBS.</p>
        )}
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Microphones. */}
      <p className="mb-2 text-sm font-semibold text-fg">Microphones</p>
      {mics.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No audio input capture devices found in OBS.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mics.map((mic) => (
            <MixerRow
              key={mic.name}
              name={mic.name}
              muted={mic.muted}
              db={dbOf(mic.muted ? 0 : levels[mic.name] ?? 0)}
              onToggle={() => toggleMute(mic.name)}
              icon="mic"
              primary={Boolean(micSourceName) && mic.name === micSourceName}
            />
          ))}
        </ul>
      )}

      {/* Music: one Application Audio Capture source, user-designated. */}
      <div className="mt-3 border-t border-edge pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Music size={14} aria-hidden />
            Music
          </p>
          {musicActive && !picking && (
            <button
              type="button"
              onClick={() => {
                setPicking(true)
                void refreshAppInputs()
              }}
              className="text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Change source
            </button>
          )}
        </div>

        {musicSource === null ? null : musicActive && !picking ? (
          <ul>
            <MixerRow
              name={musicSource}
              muted={musicMuted}
              db={dbOf(musicMuted ? 0 : levels[musicSource] ?? 0)}
              onToggle={() => toggleMute(musicSource)}
              icon="music"
            />
          </ul>
        ) : appInputs.length === 0 ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              No Application Audio Capture sources in OBS. Add one (Sources →
              Application Audio Capture) for your music player, then pick it
              here.
            </p>
            <button
              type="button"
              onClick={() => void refreshAppInputs()}
              title="Re-check OBS sources"
              aria-label="Re-check OBS sources"
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-fg-muted">
              {musicSource && !musicActive
                ? `"${musicSource}" is gone from OBS — pick its replacement:`
                : 'Pick the Application Audio Capture source that plays your music:'}
            </p>
            {appInputs.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => designateMusic(name)}
                className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Primary Webcam: the active scene's designated camera. */}
      <div className="mt-3 border-t border-edge pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Video size={14} aria-hidden />
            Primary Webcam
          </p>
          {camera && !pickingCamera && (
            <button
              type="button"
              onClick={() => {
                setPickingCamera(true)
                void refreshCameraSources()
              }}
              className="text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Change camera
            </button>
          )}
        </div>

        {!programScene ? (
          <p className="text-sm text-fg-muted">
            No active scene reported by OBS yet.
          </p>
        ) : camera && !pickingCamera ? (
          <ul>
            <WebcamRow
              name={camera.name}
              enabled={camera.enabled}
              onToggle={toggleCamera}
            />
          </ul>
        ) : cameraSources.length === 0 ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              No camera sources in &quot;{programScene}&quot;. Add a Video
              Capture Device to this scene, then pick it here.
            </p>
            <button
              type="button"
              onClick={() => void refreshCameraSources()}
              title="Re-check scene sources"
              aria-label="Re-check scene sources"
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-fg-muted">
              Pick the primary camera for &quot;{programScene}&quot;:
            </p>
            {cameraSources.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => void designateCamera(name)}
                className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

/** The primary webcam row: visibility toggle for the active scene's camera. */
function WebcamRow({
  name,
  enabled,
  onToggle,
}: {
  name: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <li className="flex items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        title={enabled ? 'Hide in the active scene' : 'Show in the active scene'}
        aria-label={`${enabled ? 'Hide' : 'Show'} ${name}`}
        className={clsx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          enabled
            ? 'bg-green-500/15 text-green-600 hover:bg-green-500/25 dark:text-green-400'
            : 'bg-red-500/15 text-red-500 hover:bg-red-500/25 dark:text-red-400',
        )}
      >
        {enabled ? <Video size={16} /> : <VideoOff size={16} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-fg">{name}</p>
          <span
            className={clsx(
              'text-[11px] font-semibold',
              enabled
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-500 dark:text-red-400',
            )}
          >
            {enabled ? 'On' : 'Hidden'}
          </span>
        </div>
      </div>
    </li>
  )
}

/**
 * A minimal source row for the compact glance view: an icon toggle plus a
 * level bar, no label. Audio rows animate a live meter; the camera row shows
 * a static full/empty bar for its visibility.
 */
function CompactRow({
  kind,
  off,
  db,
  onToggle,
}: {
  kind: 'mic' | 'music' | 'camera'
  off: boolean
  /** dBFS for audio rows; omitted for the camera (static). */
  db?: number
  onToggle: () => void
}) {
  const OnIcon = kind === 'mic' ? Mic : kind === 'music' ? Volume2 : Video
  const OffIcon = kind === 'mic' ? MicOff : kind === 'music' ? VolumeX : VideoOff
  const label = kind === 'mic' ? 'Mic' : kind === 'music' ? 'Music' : 'Camera'
  const isCamera = kind === 'camera'
  const pct = isCamera
    ? off
      ? 0
      : 100
    : Math.max(0, Math.min(1, ((db ?? -60) + 60) / 60)) * 100
  const barColor = isCamera
    ? 'bg-green-500'
    : (db ?? -60) > -9
      ? 'bg-red-500'
      : (db ?? -60) > -20
        ? 'bg-yellow-500'
        : 'bg-green-500'
  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={off ? 'Enable source' : 'Disable source'}
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
          off
            ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25 dark:text-red-400'
            : 'bg-green-500/15 text-green-600 hover:bg-green-500/25 dark:text-green-400',
        )}
      >
        {off ? <OffIcon size={14} /> : <OnIcon size={14} />}
      </button>
      <span className="w-12 shrink-0 text-xs font-medium text-fg-muted">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
        <div
          className={clsx(
            'h-full rounded-full transition-[width] duration-100 ease-linear',
            barColor,
          )}
          style={{width: `${pct}%`}}
        />
      </div>
    </li>
  )
}

function MixerRow({
  name,
  muted,
  db,
  onToggle,
  icon,
  primary,
}: {
  name: string
  muted: boolean
  db: number
  onToggle: () => void
  icon: 'mic' | 'music'
  primary?: boolean
}) {
  const pct = Math.max(0, Math.min(1, (db + 60) / 60)) * 100
  const OnIcon = icon === 'mic' ? Mic : Volume2
  const OffIcon = icon === 'mic' ? MicOff : VolumeX
  return (
    <li className="flex items-center gap-3">
      {/* Mute toggle; state confirms via the OBS event. */}
      <button
        type="button"
        onClick={onToggle}
        title={muted ? 'Unmute in OBS' : 'Mute in OBS'}
        aria-label={`${muted ? 'Unmute' : 'Mute'} ${name}`}
        className={clsx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          muted
            ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25 dark:text-red-400'
            : 'bg-green-500/15 text-green-600 hover:bg-green-500/25 dark:text-green-400',
        )}
      >
        {muted ? <OffIcon size={16} /> : <OnIcon size={16} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-fg">
            <span className="truncate">{name}</span>
            {primary && (
              <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                Primary
              </span>
            )}
          </p>
          <span
            className={clsx(
              'text-[11px] font-semibold',
              muted
                ? 'text-red-500 dark:text-red-400'
                : 'text-green-600 dark:text-green-400',
            )}
          >
            {muted ? 'Muted' : 'On'}
          </span>
        </div>
        {/* Peak level meter, -60 dB … 0 dB. */}
        <div
          role="meter"
          aria-label={`${name} level`}
          aria-valuemin={-60}
          aria-valuemax={0}
          aria-valuenow={Math.round(db)}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover"
        >
          <div
            className={clsx(
              'h-full rounded-full transition-[width] duration-100 ease-linear',
              db > -9 ? 'bg-red-500' : db > -20 ? 'bg-yellow-500' : 'bg-green-500',
            )}
            style={{width: `${pct}%`}}
          />
        </div>
      </div>
    </li>
  )
}

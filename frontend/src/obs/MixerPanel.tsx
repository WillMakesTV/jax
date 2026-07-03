import {Mic, MicOff, Music, RefreshCw, Volume2, VolumeX} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
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
 * The audio mixer: OBS's audio input capture devices (microphones) plus the
 * Application Audio Capture source designated as "Music", each with a live
 * level meter and a mute toggle. The high-volume InputVolumeMeters event
 * stream is enabled only while this panel is mounted.
 */
export function MixerPanel() {
  const {mics, obsConnected} = useLiveData()
  const {obsRequest, onObsEvent, setObsMeterEvents} = useServices()
  const [levels, setLevels] = useState<Record<string, number>>({})
  const levelsRef = useRef<Record<string, number>>({})
  const [error, setError] = useState('')

  // The designated Music source (null while the setting loads; '' = unset).
  const [musicSource, setMusicSource] = useState<string | null>(null)
  const [musicMuted, setMusicMuted] = useState(false)
  const [appInputs, setAppInputs] = useState<string[]>([])
  const [picking, setPicking] = useState(false)

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

  // Load the persisted Music designation.
  useEffect(() => {
    loadSetting(SETTING_KEYS.obsMusicSource).then((v) => setMusicSource(v ?? ''))
  }, [])

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
  }

  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      {/* Microphones. */}
      <p className="mb-3 text-sm font-semibold text-fg">Microphones</p>
      {mics.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No audio input capture devices found in OBS.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mics.map((mic) => (
            <MixerRow
              key={mic.name}
              name={mic.name}
              muted={mic.muted}
              db={dbOf(mic.muted ? 0 : levels[mic.name] ?? 0)}
              onToggle={() => toggleMute(mic.name)}
              icon="mic"
            />
          ))}
        </ul>
      )}

      {/* Music: one Application Audio Capture source, user-designated. */}
      <div className="mt-4 border-t border-edge pt-4">
        <div className="mb-3 flex items-center justify-between">
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

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

function MixerRow({
  name,
  muted,
  db,
  onToggle,
  icon,
}: {
  name: string
  muted: boolean
  db: number
  onToggle: () => void
  icon: 'mic' | 'music'
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
          <p className="truncate text-sm font-medium text-fg">{name}</p>
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
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-hover"
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

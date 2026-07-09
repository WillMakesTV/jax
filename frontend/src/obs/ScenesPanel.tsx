import {Eye, EyeOff, Layers, Mic, Music, Sparkles, Video} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
import {StatusPill} from '../live/LiveOverview'
import {useLiveData} from '../live/LiveDataProvider'
import {sourceRole, type SourceRole} from '../lib/obs'
import {loadSceneCameras, saveSceneCameras} from '../lib/sceneCameras'
import {SETTING_KEYS, loadSetting, saveSetting} from '../lib/settings'
import {
  DEFAULT_SMART_TEMPLATE,
  loadSmartSources,
  saveSmartSources,
  TEXT_GDIPLUS_KINDS,
  type SmartSource,
} from '../lib/smartSources'
import {useServices} from '../services/ServicesProvider'

/** How often the scene list / program scene re-syncs with OBS. */
const SCENES_POLL_MS = 3_000

interface SceneItem {
  id: number
  name: string
  enabled: boolean
}

/**
 * OBS scenes: the list on the left (the program scene highlighted, with
 * one-click switching), and the selected scene's sources with their
 * visible/hidden state on the right.
 */
export function ScenesPanel() {
  const {obsConnected, micSourceName, sourcesRev, refreshObs, refreshCamera} =
    useLiveData()
  const {obsRequest, onObsEvent} = useServices()
  const [scenes, setScenes] = useState<string[]>([])
  const [program, setProgram] = useState('')
  const [selected, setSelected] = useState('')
  const [items, setItems] = useState<SceneItem[]>([])
  const [error, setError] = useState('')

  // Source designations: name → input kind, plus the current music and the
  // selected scene's camera designation (mic is read from context).
  const [kinds, setKinds] = useState<Record<string, string>>({})
  const [musicName, setMusicName] = useState('')
  const [sceneCamera, setSceneCamera] = useState('')
  const [smart, setSmart] = useState<Record<string, SmartSource>>({})

  // Tracks the latest selected scene so a slow refreshItems() response for a
  // scene the user has since navigated away from doesn't overwrite items.
  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  const refresh = useCallback(async () => {
    try {
      const r = await obsRequest<{
        currentProgramSceneName: string
        scenes: {sceneName: string}[]
      }>('GetSceneList')
      // OBS returns scenes bottom-first; reverse to match its own UI order.
      const names = (r.scenes ?? []).map((s) => s.sceneName).reverse()
      setScenes(names)
      setProgram(r.currentProgramSceneName)
      setSelected((prev) =>
        prev && names.includes(prev) ? prev : r.currentProgramSceneName,
      )
    } catch {
      // Transient; the next poll retries.
    }
  }, [obsRequest])

  // Fetch the sources of one scene, ordered top-first like OBS's own UI.
  const refreshItems = useCallback(
    async (scene: string) => {
      if (!scene) {
        setItems([])
        return
      }
      try {
        const r = await obsRequest<{
          sceneItems: {
            sceneItemId: number
            sourceName: string
            sceneItemEnabled: boolean
          }[]
        }>('GetSceneItemList', {sceneName: scene})
        if (scene !== selectedRef.current) return // stale: user moved on
        setItems(
          (r.sceneItems ?? [])
            .map((i) => ({
              id: i.sceneItemId,
              name: i.sourceName,
              enabled: i.sceneItemEnabled,
            }))
            .reverse(),
        )
      } catch {
        if (scene === selectedRef.current) setItems([])
      }
    },
    [obsRequest],
  )

  // Scene list + program scene: a slow poll as a safety net, with instant
  // updates from OBS events below.
  useEffect(() => {
    if (!obsConnected) return
    void refresh()
    const id = window.setInterval(() => void refresh(), SCENES_POLL_MS)
    return () => window.clearInterval(id)
  }, [obsConnected, refresh])

  // Program-scene switches and scene add/remove/rename, event-driven.
  useEffect(() => {
    if (!obsConnected) return
    const offs = [
      onObsEvent<{sceneName: string}>('CurrentProgramSceneChanged', (e) =>
        setProgram(e.sceneName),
      ),
      onObsEvent('SceneListChanged', () => void refresh()),
      onObsEvent('SceneCreated', () => void refresh()),
      onObsEvent('SceneRemoved', () => void refresh()),
      onObsEvent('SceneNameChanged', () => void refresh()),
    ]
    return () => offs.forEach((off) => off())
  }, [obsConnected, onObsEvent, refresh])

  // Sources of the inspected scene, refetched when it changes.
  useEffect(() => {
    void refreshItems(selected)
  }, [selected, refreshItems])

  // Near-real-time source updates: visibility toggles apply in place; adds,
  // removals, and reorders refetch the selected scene's items.
  useEffect(() => {
    if (!obsConnected || !selected) return
    const offs = [
      onObsEvent<{
        sceneName: string
        sceneItemId: number
        sceneItemEnabled: boolean
      }>('SceneItemEnableStateChanged', (e) => {
        if (e.sceneName !== selected) return
        setItems((prev) =>
          prev.map((it) =>
            it.id === e.sceneItemId ? {...it, enabled: e.sceneItemEnabled} : it,
          ),
        )
      }),
      onObsEvent<{sceneName: string}>('SceneItemCreated', (e) => {
        if (e.sceneName === selected) void refreshItems(selected)
      }),
      onObsEvent<{sceneName: string}>('SceneItemRemoved', (e) => {
        if (e.sceneName === selected) void refreshItems(selected)
      }),
      onObsEvent<{sceneName: string}>('SceneItemListReindexed', (e) => {
        if (e.sceneName === selected) void refreshItems(selected)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [obsConnected, selected, onObsEvent, refreshItems])

  const switchTo = (name: string) => {
    setError('')
    obsRequest('SetCurrentProgramScene', {sceneName: name})
      .then(() => {
        setProgram(name)
        setSelected(name)
      })
      .catch(() => setError(`Could not switch to ${name}.`))
  }

  // Input kinds (name → kind) so each source can offer the right designation.
  useEffect(() => {
    if (!obsConnected) return
    let cancelled = false
    obsRequest<{inputs: {inputName: string; inputKind: string}[]}>(
      'GetInputList',
    )
      .then((r) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const i of r.inputs ?? []) map[i.inputName] = i.inputKind
        setKinds(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [obsConnected, obsRequest, selected, sourcesRev])

  // Current music + selected-scene camera designations (re-read on changes).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const music = (await loadSetting(SETTING_KEYS.obsMusicSource)) ?? ''
      const cams = await loadSceneCameras()
      if (cancelled) return
      setMusicName(music)
      setSceneCamera(selected ? (cams[selected] ?? '') : '')
    })()
    return () => {
      cancelled = true
    }
  }, [selected, sourcesRev])

  // Smart-source designations (re-read on changes).
  useEffect(() => {
    let cancelled = false
    loadSmartSources().then((s) => {
      if (!cancelled) setSmart(s)
    })
    return () => {
      cancelled = true
    }
  }, [sourcesRev])

  // Toggle a Text (GDI+) source as a smart source (managed text template).
  // Designating one retains whatever text it already shows in OBS: that text
  // becomes the template, and only the {tokens} inside it get replaced with
  // live values. The starter template is used only when the source is empty.
  const toggleSmart = async (name: string) => {
    const next = {...smart}
    if (next[name]) {
      delete next[name]
    } else {
      let template = DEFAULT_SMART_TEMPLATE
      try {
        const r = await obsRequest<{inputSettings: {text?: string}}>(
          'GetInputSettings',
          {inputName: name},
        )
        const current = r.inputSettings?.text
        if (typeof current === 'string' && current.trim()) template = current
      } catch {
        // OBS unreachable; fall back to the starter template.
      }
      next[name] = {template}
    }
    setSmart(next)
    saveSmartSources(next)
    refreshObs()
  }

  // Toggle a source's designation for its role (unset when already primary).
  const designate = async (role: SourceRole, name: string, active: boolean) => {
    const value = active ? '' : name
    if (role === 'mic') {
      saveSetting(SETTING_KEYS.obsMicSource, value)
    } else if (role === 'music') {
      saveSetting(SETTING_KEYS.obsMusicSource, value)
    } else {
      const cams = await loadSceneCameras()
      if (value) cams[selected] = value
      else delete cams[selected]
      saveSceneCameras(cams)
      refreshCamera()
    }
    refreshObs()
  }

  const isDesignated = (role: SourceRole, name: string): boolean => {
    if (role === 'mic') return micSourceName === name
    if (role === 'music') return musicName === name
    return sceneCamera === name
  }

  if (scenes.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-4">
        <Layers size={18} aria-hidden className="text-fg-muted" />
        <p className="text-sm text-fg-muted">No scenes reported by OBS yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4 sm:flex-row">
      {/* Scene list. */}
      <ul className="flex w-full flex-col gap-1 sm:w-64 sm:shrink-0">
        {scenes.map((name) => {
          const isProgram = name === program
          const isSelected = name === selected
          return (
            <li key={name}>
              <div
                className={clsx(
                  'group flex w-full items-center gap-2 rounded-lg border px-3 py-2',
                  isSelected
                    ? 'border-accent/50 bg-accent/10'
                    : 'border-transparent hover:bg-surface-hover',
                )}
              >
                {/* Select for inspection. */}
                <button
                  type="button"
                  onClick={() => setSelected(name)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg"
                >
                  {name}
                </button>
                {isProgram ? (
                  <StatusPill live label="Active" />
                ) : (
                  <button
                    type="button"
                    onClick={() => switchTo(name)}
                    className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
                  >
                    Switch
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Sources of the selected scene. */}
      <div className="min-w-0 flex-1 rounded-lg border border-edge bg-bg p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Sources in {selected || '—'}
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-fg-muted">This scene has no sources.</p>
        ) : (
          <ul className="divide-y divide-edge">
            {items.map((item) => {
              const role = sourceRole(kinds[item.name] ?? '')
              const isText = TEXT_GDIPLUS_KINDS.has(kinds[item.name] ?? '')
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-2 py-2"
                >
                  <span
                    className={clsx(
                      'min-w-0 flex-1 truncate text-sm',
                      item.enabled ? 'text-fg' : 'text-fg-muted line-through',
                    )}
                  >
                    {item.name}
                  </span>
                  {/* Toggle a Text (GDI+) source as a managed smart source. */}
                  {isText && (
                    <SmartButton
                      active={Boolean(smart[item.name])}
                      onClick={() => void toggleSmart(item.name)}
                    />
                  )}
                  {/* Designate this source as the primary for its role. */}
                  {role && (
                    <DesignateButton
                      role={role}
                      active={isDesignated(role, item.name)}
                      onClick={() =>
                        void designate(
                          role,
                          item.name,
                          isDesignated(role, item.name),
                        )
                      }
                    />
                  )}
                  <span
                    title={item.enabled ? 'Visible' : 'Hidden'}
                    className={clsx(
                      'shrink-0',
                      item.enabled
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-fg-muted',
                    )}
                  >
                    {item.enabled ? (
                      <Eye size={15} aria-label="Visible" />
                    ) : (
                      <EyeOff size={15} aria-label="Hidden" />
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

const ROLE_META: Record<
  SourceRole,
  {label: string; icon: typeof Video; set: string; unset: string}
> = {
  camera: {
    label: 'Camera',
    icon: Video,
    set: 'Set as this scene’s primary camera',
    unset: 'Primary camera — click to unset',
  },
  mic: {
    label: 'Mic',
    icon: Mic,
    set: 'Set as primary microphone',
    unset: 'Primary microphone — click to unset',
  },
  music: {
    label: 'Music',
    icon: Music,
    set: 'Set as the Music source',
    unset: 'Music source — click to unset',
  },
}

/** Pill CTA to toggle a Text (GDI+) source as a smart source. */
function SmartButton({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={
        active
          ? 'Smart source — manage its text in OBS Studio → Smart Sources'
          : 'Make this a smart source (app-managed text)'
      }
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors',
        active
          ? 'bg-accent text-accent-fg'
          : 'border border-edge bg-bg text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Sparkles size={11} aria-hidden />
      Smart
    </button>
  )
}

/** Pill CTA to designate a source as the primary for its role. */
function DesignateButton({
  role,
  active,
  onClick,
}: {
  role: SourceRole
  active: boolean
  onClick: () => void
}) {
  const meta = ROLE_META[role]
  const Icon = meta.icon
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? meta.unset : meta.set}
      aria-pressed={active}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors',
        active
          ? 'bg-accent text-accent-fg'
          : 'border border-edge bg-bg text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon size={11} aria-hidden />
      {meta.label}
    </button>
  )
}

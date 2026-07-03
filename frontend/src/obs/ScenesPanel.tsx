import {Eye, EyeOff, Layers} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useState} from 'react'
import {StatusPill} from '../live/LiveOverview'
import {useLiveData} from '../live/LiveDataProvider'
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
  const {obsConnected} = useLiveData()
  const {obsRequest} = useServices()
  const [scenes, setScenes] = useState<string[]>([])
  const [program, setProgram] = useState('')
  const [selected, setSelected] = useState('')
  const [items, setItems] = useState<SceneItem[]>([])
  const [error, setError] = useState('')

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

  useEffect(() => {
    if (!obsConnected) return
    void refresh()
    const id = window.setInterval(() => void refresh(), SCENES_POLL_MS)
    return () => window.clearInterval(id)
  }, [obsConnected, refresh])

  // Sources of the inspected scene.
  useEffect(() => {
    if (!selected) {
      setItems([])
      return
    }
    let cancelled = false
    obsRequest<{
      sceneItems: {
        sceneItemId: number
        sourceName: string
        sceneItemEnabled: boolean
      }[]
    }>('GetSceneItemList', {sceneName: selected})
      .then((r) => {
        if (cancelled) return
        setItems(
          (r.sceneItems ?? [])
            .map((i) => ({
              id: i.sceneItemId,
              name: i.sourceName,
              enabled: i.sceneItemEnabled,
            }))
            .reverse(), // bottom-first from OBS; show top-first like its UI
        )
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [selected, obsRequest])

  const switchTo = (name: string) => {
    setError('')
    obsRequest('SetCurrentProgramScene', {sceneName: name})
      .then(() => {
        setProgram(name)
        setSelected(name)
      })
      .catch(() => setError(`Could not switch to ${name}.`))
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
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span
                  className={clsx(
                    'truncate text-sm',
                    item.enabled ? 'text-fg' : 'text-fg-muted line-through',
                  )}
                >
                  {item.name}
                </span>
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
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

import {Pencil, Play, Plus, Trash2, Workflow} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {DeleteRoutine, GetRoutines} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useServices} from '../services/ServicesProvider'
import {END_ROUTINE, START_ROUTINE, runRoutine} from './routines'

/**
 * The OBS Studio "Routines" tab: the two built-in routines tied to the app's
 * Go live / Stop stream buttons, plus any custom routines. Each routine is
 * managed either in Jax (steps authored here) or by a Stream Deck Multi
 * Action (steps replayed from the deck's profile — see routines.ts).
 */

/** The manager chip's text: what runs, and from where. */
function managerLabel(routine: main.Routine): string {
  if (routine.manager === 'streamdeck') {
    const titles = [routine.streamdeckTitle, routine.streamdeckAfterTitle]
      .filter(Boolean)
      .join(' + ')
    return `Stream Deck · ${titles || 'Multi Action'}`
  }
  const count =
    (routine.steps ?? []).length + (routine.afterSteps ?? []).length
  return `Jax · ${count} step${count === 1 ? '' : 's'}`
}
export function RoutinesPanel({
  onEditRoutine,
}: {
  /** Open the add/edit form; null creates a new routine. */
  onEditRoutine: (routine: main.Routine | null) => void
}) {
  const {statuses, obsRequest} = useServices()
  const obsConnected = statuses.obs.connected

  const [routines, setRoutines] = useState<main.Routine[]>([])
  const [runningId, setRunningId] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState('')

  const reload = useCallback(() => {
    GetRoutines()
      .then((r) => setRoutines(r ?? []))
      .catch(() => setRoutines([]))
  }, [])
  useEffect(reload, [reload])

  const run = async (routine: main.Routine) => {
    setRunningId(routine.id)
    setNotes((n) => ({...n, [routine.id]: ''}))
    try {
      const warnings = await runRoutine(routine, obsRequest)
      setNotes((n) => ({...n, [routine.id]: warnings.join(' · ')}))
    } catch (err) {
      setNotes((n) => ({
        ...n,
        [routine.id]:
          err instanceof Error && err.message
            ? err.message
            : 'The routine failed.',
      }))
    } finally {
      setRunningId('')
    }
  }

  const remove = async (id: string) => {
    setConfirmDelete('')
    try {
      await DeleteRoutine(id)
    } catch {
      // The list below re-reads the stored truth either way.
    }
    reload()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">
          The built-in routines run with the app's{' '}
          <span className="font-medium text-fg">Go live</span> and{' '}
          <span className="font-medium text-fg">Stop stream</span> buttons.
        </p>
        <button
          type="button"
          onClick={() => onEditRoutine(null)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          <Plus size={14} aria-hidden />
          Add routine
        </button>
      </div>

      <ul className="flex flex-col gap-3">
        {routines.map((routine) => (
          <li
            key={routine.id}
            className="rounded-xl border border-edge bg-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
              >
                <Workflow size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-fg">
                    {routine.name}
                  </h3>
                  {routine.builtIn && (
                    <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                      Built-in
                    </span>
                  )}
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    {managerLabel(routine)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {routine.trigger === START_ROUTINE
                    ? 'Runs with Go live: before-steps, the stream starts, then after-steps.'
                    : routine.trigger === END_ROUTINE
                      ? 'Runs with Stop stream: before-steps, the stream stops, then after-steps.'
                      : 'Runs manually.'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void run(routine)}
                  disabled={!obsConnected || runningId !== ''}
                  title={
                    obsConnected
                      ? undefined
                      : 'Connect OBS in Settings → Services to run routines.'
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play size={12} aria-hidden />
                  {runningId === routine.id ? 'Running…' : 'Run'}
                </button>
                <button
                  type="button"
                  onClick={() => onEditRoutine(routine)}
                  aria-label={`Edit ${routine.name}`}
                  className="rounded-lg border border-edge bg-bg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Pencil size={13} aria-hidden />
                </button>
                {!routine.builtIn &&
                  (confirmDelete === routine.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void remove(routine.id)}
                        className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete('')}
                        className="rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(routine.id)}
                      aria-label={`Delete ${routine.name}`}
                      className="rounded-lg border border-edge bg-bg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  ))}
              </div>
            </div>
            {notes[routine.id] && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {notes[routine.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

import {ArrowLeft, Plus, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useEvents} from '../events/EventsProvider'
import {useLiveData} from '../live/LiveDataProvider'
import {
  computeTokenValues,
  loadCustomTokens,
  sanitizeTokenName,
  saveCustomTokens,
} from '../lib/smartSources'

/**
 * Manage reusable custom tokens (bare name → static value) on their own page.
 * Edits persist immediately and flow into every smart-source template that
 * references them.
 */
export function CustomTokens({onBack}: {onBack: () => void}) {
  const {platforms, obs, refreshObs} = useLiveData()
  const {events} = useEvents()
  // null until the disk read resolves; this page is the only writer after.
  const [custom, setCustom] = useState<Record<string, string> | null>(null)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')

  useEffect(() => {
    loadCustomTokens().then(setCustom)
  }, [])

  const persist = (next: Record<string, string>) => {
    setCustom(next)
    saveCustomTokens(next)
    refreshObs()
  }

  // Current token values, used to reject a new name that clashes with a
  // built-in (or existing custom) token.
  const values = computeTokenValues(
    platforms,
    obs,
    events,
    new Date(),
    custom ?? {},
  )

  const add = () => {
    if (!custom) return
    const name = sanitizeTokenName(newName)
    if (!name || values[`{${name}}`] !== undefined) return
    persist({...custom, [name]: newValue})
    setNewName('')
    setNewValue('')
  }

  const update = (name: string, value: string) => {
    if (!custom) return
    persist({...custom, [name]: value})
  }

  const remove = (name: string) => {
    if (!custom) return
    const next = {...custom}
    delete next[name]
    persist(next)
  }

  const names = Object.keys(custom ?? {})

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Smart Sources
      </button>

      <div className="flex max-w-2xl flex-col gap-3">
        <p className="text-xs text-fg-muted">
          Reusable placeholders with a value you set. Insert them like any
          token, e.g. <span className="font-mono">{'{sponsor}'}</span>.
        </p>

        {names.length > 0 && (
          <ul className="flex flex-col gap-2">
            {names.map((name) => (
              <li key={name} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate font-mono text-xs text-fg-muted">
                  {`{${name}}`}
                </span>
                <input
                  value={custom?.[name] ?? ''}
                  onChange={(e) => update(name, e.target.value)}
                  placeholder="Value"
                  className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => remove(name)}
                  title="Remove token"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="token_name"
            className="w-40 shrink-0 rounded-lg border border-edge bg-bg px-2.5 py-1.5 font-mono text-sm text-fg outline-none focus:border-accent"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            placeholder="Value"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={add}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

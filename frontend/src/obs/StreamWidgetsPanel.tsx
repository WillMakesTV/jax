import {LayoutGrid, Plus, Trash2} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  DeleteStreamWidget,
  GetStreamWidgets,
  SaveStreamWidget,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useDataChanged} from '../lib/dataChanged'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'

/**
 * The OBS section's Stream Widgets tab: create and manage stream widgets —
 * on-stream elements the producer defines by name. The model is deliberately
 * minimal for now and grows properties as the feature does.
 */
export function StreamWidgetsPanel() {
  const [widgets, setWidgets] = useState<main.StreamWidget[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    GetStreamWidgets()
      .then((w) => setWidgets(w ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  // Widgets saved elsewhere (e.g. an MCP client) appear without a re-visit.
  useDataChanged(['stream_widgets'], load)

  const create = async () => {
    if (!name.trim()) {
      setError('Give the widget a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await SaveStreamWidget(
        main.StreamWidget.createFrom({
          id: '',
          name: name.trim(),
          createdAt: '',
        }),
      )
      setWidgets((prev) => [saved, ...prev])
      setName('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The widget could not be created.',
      )
    } finally {
      setSaving(false)
    }
  }

  const rename = async (widget: main.StreamWidget, next: string) => {
    if (!next.trim() || next.trim() === widget.name) return
    setError('')
    try {
      const saved = await SaveStreamWidget(
        main.StreamWidget.createFrom({...widget, name: next.trim()}),
      )
      setWidgets((prev) => prev.map((w) => (w.id === saved.id ? saved : w)))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The widget could not be renamed.',
      )
    }
  }

  const remove = async (id: string) => {
    setError('')
    try {
      await DeleteStreamWidget(id)
      setWidgets((prev) => prev.filter((w) => w.id !== id))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-fg-muted">
        Stream widgets are on-stream elements you define by name — goals,
        alerts, tickers — managed here as they grow into the broadcast.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
        className="flex items-center gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Follower goal"
          aria-label="Widget name"
          className={field}
        />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={14} aria-hidden />
          {saving ? 'Adding…' : 'Add widget'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {widgets.length === 0 ? (
        <div className="flex items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
          >
            <LayoutGrid size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              No stream widgets yet
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              Name your first widget above to start the collection.
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {widgets.map((w) => (
            <WidgetRow
              key={w.id}
              widget={w}
              onRename={(next) => void rename(w, next)}
              onDelete={() => void remove(w.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function WidgetRow({
  widget,
  onRename,
  onDelete,
}: {
  widget: main.StreamWidget
  onRename: (next: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(widget.name)

  // Adopt renames landing from elsewhere without clobbering typing.
  const [synced, setSynced] = useState(widget.name)
  if (widget.name !== synced) {
    setSynced(widget.name)
    setDraft(widget.name)
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
      >
        <LayoutGrid size={15} />
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        aria-label={`Widget name for ${widget.name}`}
        className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-fg outline-none transition-colors focus:border-accent focus:bg-bg"
      />
      <button
        type="button"
        onClick={onDelete}
        title="Delete widget"
        aria-label={`Delete widget ${widget.name}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </li>
  )
}

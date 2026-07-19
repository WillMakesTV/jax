import {LayoutGrid} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {GetStreamWidgets, SaveStreamWidget} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useDataChanged} from '../lib/dataChanged'
import {formatDate} from '../lib/format'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/**
 * A stream widget's own page, opened from the OBS section's Stream Widgets
 * tab: configure the widget here. The model is minimal for now — a name —
 * and this page is where its configuration grows.
 */
export function StreamWidgetDetails({
  widget,
  onBack,
}: {
  /** The widget being configured. */
  widget: main.StreamWidget
  onBack: () => void
}) {
  const [w, setW] = useState(widget)
  const [name, setName] = useState(widget.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // The navigation history hands us a snapshot; reload the live record so
  // edits from a previous visit (or elsewhere) are current.
  const load = useCallback(() => {
    GetStreamWidgets()
      .then((all) => {
        const fresh = (all ?? []).find((x) => x.id === widget.id)
        if (fresh) setW(fresh)
      })
      .catch(() => {})
  }, [widget])

  useEffect(load, [load])
  useDataChanged(['stream_widgets'], load)

  // Adopt the freshly reloaded record once, but never clobber typing.
  const [synced, setSynced] = useState(w)
  if (w !== synced) {
    setSynced(w)
    setName(w.name)
  }

  const dirty = name.trim() !== w.name

  const save = async () => {
    if (!name.trim()) {
      setError('Give the widget a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await SaveStreamWidget(
        main.StreamWidget.createFrom({...w, name: name.trim()}),
      )
      setW(saved)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The widget could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
        >
          <LayoutGrid size={20} />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-fg">
            {w.name || 'Stream widget'}
          </h1>
          {w.createdAt && (
            <p className="text-xs text-fg-muted">
              Created {formatDate(w.createdAt)}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="widget-name" className={labelCls}>
          Widget name
        </label>
        <input
          id="widget-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Follower goal"
          className={field}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex items-center gap-3">
        {dirty && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save widget'}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          Back to widgets
        </button>
      </div>
    </div>
  )
}

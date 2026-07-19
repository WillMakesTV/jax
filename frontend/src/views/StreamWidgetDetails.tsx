import {Image, LayoutGrid, Plus, Trash2, Type} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  AddWidgetField,
  GetStreamWidgets,
  GetWidgetFieldTypes,
  RemoveWidgetField,
  SaveStreamWidget,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useDataChanged} from '../lib/dataChanged'
import {formatDate} from '../lib/format'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/**
 * A stream widget's own page, opened from the OBS section's Stream Widgets
 * tab: configure the widget here — its name and the fields it carries,
 * drawn from the field-type catalog (Manage Field Types on the tab).
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
  // Field values being edited, keyed by field id; unsaved edits live here.
  const [values, setValues] = useState<Record<string, string>>({})
  const [types, setTypes] = useState<main.WidgetFieldType[]>([])
  const [addTypeId, setAddTypeId] = useState('')
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
    GetWidgetFieldTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
  }, [widget])

  useEffect(load, [load])
  useDataChanged(['stream_widgets', 'widget_field_types'], load)

  // Adopt the freshly reloaded record once, but never clobber typing.
  const [synced, setSynced] = useState(w)
  if (w !== synced) {
    setSynced(w)
    setName(w.name)
    setValues({})
  }

  const fields = w.fields ?? []
  const typeById = new Map(types.map((t) => [t.id, t]))
  const valueOf = (f: main.WidgetField) => values[f.id] ?? f.value

  const dirty =
    name.trim() !== w.name || fields.some((f) => valueOf(f) !== f.value)

  const save = async () => {
    if (!name.trim()) {
      setError('Give the widget a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await SaveStreamWidget(
        main.StreamWidget.createFrom({
          ...w,
          name: name.trim(),
          fields: fields.map((f) => ({...f, value: valueOf(f)})),
        }),
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

  const addField = async () => {
    if (!addTypeId) return
    setError('')
    try {
      setW(await AddWidgetField(w.id, addTypeId))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The field could not be added.',
      )
    }
  }

  const removeField = async (fieldID: string) => {
    setError('')
    try {
      setW(await RemoveWidgetField(w.id, fieldID))
    } catch {
      // Non-fatal; the record reconciles on the next load.
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

      {/* The widget's fields, drawn from the field-type catalog. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Fields</h2>
          <div className="flex items-center gap-2">
            <select
              value={addTypeId}
              onChange={(e) => setAddTypeId(e.target.value)}
              aria-label="Field type to add"
              className="rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
            >
              <option value="">Choose a field type…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void addField()}
              disabled={!addTypeId}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus size={14} aria-hidden />
              Add field
            </button>
          </div>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No fields yet — pick a field type above to give this widget its
            content. Manage the available types from the Stream Widgets tab.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {fields.map((f) => {
              const t = typeById.get(f.typeId)
              const kind = t?.kind ?? ''
              const cap = t?.maxLength ?? 0
              const value = valueOf(f)
              return (
                <li
                  key={f.id}
                  className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
                    >
                      {kind === 'image' ? (
                        <Image size={14} />
                      ) : (
                        <Type size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {f.label}
                    </span>
                    {cap > 0 && (
                      <span className="shrink-0 text-xs text-fg-muted">
                        {[...value].length}/{cap}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeField(f.id)}
                      title="Remove field"
                      aria-label={`Remove field ${f.label}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>

                  {kind === 'image' ? (
                    <p className="text-xs text-fg-muted">
                      Image/animation content (upload or AI generation) lands
                      here in a follow-up — the field is on the widget and ready
                      for it.
                    </p>
                  ) : kind === 'message' ? (
                    <textarea
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({...prev, [f.id]: e.target.value}))
                      }
                      rows={3}
                      maxLength={cap > 0 ? cap : undefined}
                      placeholder="Markdown message shown on stream…"
                      className={`${field} resize-y`}
                    />
                  ) : (
                    <input
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({...prev, [f.id]: e.target.value}))
                      }
                      maxLength={cap > 0 ? cap : undefined}
                      placeholder="Status shown on stream…"
                      className={field}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
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

import {
  Check,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Image,
  LayoutGrid,
  Plus,
  SlidersHorizontal,
  Trash2,
  Type,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  DeleteWidgetFieldType,
  GetClearedStreamWidgets,
  GetStreamWidgets,
  GetWidgetFieldTypes,
  SaveStreamWidget,
  SaveWidgetFieldType,
  SetStreamWidgetCleared,
  TestStreamWidget,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Modal} from '../components/Modal'
import {useDataChanged} from '../lib/dataChanged'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'

/**
 * The OBS section's Stream Widgets tab: create and manage stream widgets —
 * on-stream elements the producer defines by name. The model is deliberately
 * minimal for now and grows properties as the feature does.
 */
export function StreamWidgetsPanel({
  onOpenWidget,
}: {
  /** Open a widget's configuration page. */
  onOpenWidget: (widget: main.StreamWidget) => void
}) {
  const [widgets, setWidgets] = useState<main.StreamWidget[]>([])
  const [types, setTypes] = useState<main.WidgetFieldType[]>([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Widgets whose Browser Source is blanked (in-memory app state).
  const [clearedIds, setClearedIds] = useState<string[]>([])

  const load = useCallback(() => {
    GetStreamWidgets()
      .then((w) => setWidgets(w ?? []))
      .catch(() => {})
    GetWidgetFieldTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
    GetClearedStreamWidgets()
      .then((ids) => setClearedIds(ids ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  // Widgets saved elsewhere (e.g. an MCP client) appear without a re-visit.
  useDataChanged(['stream_widgets', 'widget_field_types'], load)

  // A widget's card thumbnail: its first image field carrying a file.
  const kindById = new Map(types.map((t) => [t.id, t.kind]))
  const thumbOf = (w: main.StreamWidget) =>
    (w.fields ?? []).find(
      (f) => f.valueUrl && kindById.get(f.typeId) === 'image',
    )?.valueUrl

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

  // Widgets whose 15-second test window is running, for button feedback.
  const [testingIds, setTestingIds] = useState<string[]>([])
  const test = async (w: main.StreamWidget) => {
    setError('')
    try {
      await TestStreamWidget(w.id)
      setTestingIds((prev) => (prev.includes(w.id) ? prev : [...prev, w.id]))
      window.setTimeout(
        () => setTestingIds((prev) => prev.filter((id) => id !== w.id)),
        15000,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The test could not be started.',
      )
    }
  }

  // Blank (or restore) a widget's Browser Source without touching OBS.
  const toggleCleared = async (w: main.StreamWidget) => {
    const cleared = clearedIds.includes(w.id)
    setError('')
    try {
      await SetStreamWidgetCleared(w.id, !cleared)
      setClearedIds((prev) =>
        cleared ? prev.filter((id) => id !== w.id) : [...prev, w.id],
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The widget could not be cleared.',
      )
    }
  }

  // Which widget's Browser Source address was just copied, for feedback.
  const [copiedId, setCopiedId] = useState('')
  const copySource = async (w: main.StreamWidget) => {
    if (!w.sourceUrl) return
    try {
      await navigator.clipboard.writeText(w.sourceUrl)
      setCopiedId(w.id)
      window.setTimeout(
        () => setCopiedId((cur) => (cur === w.id ? '' : cur)),
        2000,
      )
    } catch {
      // Clipboard unavailable; the details page still shows the address.
    }
  }

  const [fieldTypesOpen, setFieldTypesOpen] = useState(false)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-md text-sm text-fg-muted">
          Stream widgets are on-stream elements you define by name — goals,
          alerts, tickers — managed here as they grow into the broadcast.
        </p>
        <button
          type="button"
          onClick={() => setFieldTypesOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          <SlidersHorizontal size={14} aria-hidden />
          Manage Field Types
        </button>
      </div>

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
            <li
              key={w.id}
              className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3 transition-colors hover:border-accent/50"
            >
              <button
                type="button"
                onClick={() => onOpenWidget(w)}
                title="Configure this widget"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {thumbOf(w) ? (
                  <img
                    src={thumbOf(w)}
                    alt=""
                    aria-hidden
                    className="h-9 w-14 shrink-0 rounded-lg border border-edge object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
                  >
                    <LayoutGrid size={15} />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                  {w.name}
                </span>
              </button>
              {w.sourceUrl && (
                <button
                  type="button"
                  onClick={() => void toggleCleared(w)}
                  title={
                    clearedIds.includes(w.id)
                      ? 'Show this widget on its Browser Source again'
                      : "Clear this widget's Browser Source (show nothing)"
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  {clearedIds.includes(w.id) ? (
                    <Eye size={12} aria-hidden />
                  ) : (
                    <EyeOff size={12} aria-hidden />
                  )}
                  {clearedIds.includes(w.id) ? 'Show' : 'Clear'}
                </button>
              )}
              {w.sourceUrl && (
                <button
                  type="button"
                  onClick={() => void test(w)}
                  disabled={testingIds.includes(w.id)}
                  title="Show this widget on its Browser Source for 15 seconds"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                >
                  <FlaskConical size={12} aria-hidden />
                  {testingIds.includes(w.id) ? 'Testing…' : 'Test'}
                </button>
              )}
              {w.sourceUrl && (
                <button
                  type="button"
                  onClick={() => void copySource(w)}
                  title="Copy the OBS Browser Source address"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  {copiedId === w.id ? (
                    <Check size={12} aria-hidden />
                  ) : (
                    <Copy size={12} aria-hidden />
                  )}
                  {copiedId === w.id ? 'Copied' : 'Copy Browser Source'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <FieldTypesModal
        open={fieldTypesOpen}
        onClose={() => setFieldTypesOpen(false)}
      />
    </div>
  )
}

/** Human labels for the field kinds the backend understands. */
const FIELD_KINDS: {id: string; label: string; hint: string}[] = [
  {
    id: 'image',
    label: 'Image/Animation',
    hint: 'JPEG, GIF, or WebP — uploaded or generated with AI',
  },
  {
    id: 'message',
    label: 'Message',
    hint: 'Markdown text area, capped at 255 characters by default',
  },
  {
    id: 'status',
    label: 'Status',
    hint: 'Short plain text, capped at 110 characters by default',
  },
  {
    id: 'sound',
    label: 'Sound',
    hint: 'Uploaded audio (MP3, WAV, OGG, …) played when called upon',
  },
]

const kindLabel = (kind: string) =>
  FIELD_KINDS.find((k) => k.id === kind)?.label ?? kind

/**
 * The field-type catalog behind stream widgets: the kinds of fields a widget
 * can carry. Three defaults seed the list; each type also publishes its own
 * skill (Settings → Skills) — the brief behind generating that field's
 * content.
 */
function FieldTypesModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [types, setTypes] = useState<main.WidgetFieldType[]>([])
  const [name, setName] = useState('')
  const [kind, setKind] = useState('status')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    GetWidgetFieldTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])
  useDataChanged(['widget_field_types'], load)

  const create = async () => {
    if (!name.trim()) {
      setError('Give the field type a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await SaveWidgetFieldType(
        main.WidgetFieldType.createFrom({
          id: '',
          name: name.trim(),
          kind,
          maxLength: 0,
          createdAt: '',
        }),
      )
      setTypes((prev) => [...prev, saved])
      setName('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The field type could not be created.',
      )
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    setError('')
    try {
      await DeleteWidgetFieldType(id)
      setTypes((prev) => prev.filter((t) => t.id !== id))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage Field Types"
      icon={
        <SlidersHorizontal size={18} aria-hidden className="text-fg-muted" />
      }
      maxWidthClass="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          The kinds of fields a stream widget can carry. Each type publishes its
          own skill in Settings → Skills — the brief behind generating that
          field's content.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Countdown"
            aria-label="Field type name"
            className="min-w-40 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label="Field kind"
            title={FIELD_KINDS.find((k) => k.id === kind)?.hint}
            className="rounded-lg border border-edge bg-bg px-2.5 py-2 text-sm text-fg outline-none focus:border-accent"
          >
            {FIELD_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} aria-hidden />
            {saving ? 'Adding…' : 'Add'}
          </button>
        </form>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {types.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No field types — add one above to make it available to widgets.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {types.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3"
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
                >
                  {t.kind === 'image' ? (
                    <Image size={15} />
                  ) : (
                    <Type size={15} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    {t.name}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {kindLabel(t.kind)}
                    {t.maxLength > 0 && ` · max ${t.maxLength} characters`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void remove(t.id)}
                  title="Delete field type"
                  aria-label={`Delete field type ${t.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

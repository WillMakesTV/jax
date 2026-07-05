import {Layers, Pencil, Plus, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  DeleteContentSeries,
  GetContentSeries,
  SaveContentSeries,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Modal} from '../components/Modal'

/**
 * The Planning section's "Content Series" tab: reusable context/metadata for
 * recurring shows and segments, referenced when planning a stream.
 */
export function ContentSeriesPanel() {
  const [series, setSeries] = useState<main.ContentSeries[]>([])
  const [editing, setEditing] = useState<main.ContentSeries | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () => {
    GetContentSeries()
      .then((s) => setSeries(s ?? []))
      .catch(() => {})
  }
  useEffect(() => {
    load()
  }, [])

  const remove = async (id: string) => {
    try {
      await DeleteContentSeries(id)
      setSeries((prev) => prev.filter((s) => s.id !== id))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  const closeModal = () => {
    setCreating(false)
    setEditing(null)
  }
  const onSaved = () => {
    closeModal()
    load()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-fg-muted">
          Reusable context for your recurring shows and segments — reference
          them when planning a stream.
        </p>
        {series.length > 0 && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            Add series
          </button>
        )}
      </div>

      {series.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover sm:w-1/2"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            <Layers size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              Add a content series
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              Capture the title, category, tags, and notes for a recurring show
              so planning is a click.
            </p>
          </div>
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {series.map((s) => (
            <SeriesCard
              key={s.id}
              series={s}
              onEdit={() => setEditing(s)}
              onDelete={() => remove(s.id)}
            />
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <SeriesModal series={editing} onClose={closeModal} onSaved={onSaved} />
      )}
    </div>
  )
}

function SeriesCard({
  series,
  onEdit,
  onDelete,
}: {
  series: main.ContentSeries
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex flex-col rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
          {series.title}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            title="Edit series"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Pencil size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete series"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {series.category && (
        <span className="mt-1 w-fit rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
          {series.category}
        </span>
      )}

      {series.description && (
        <p className="mt-2 line-clamp-2 text-sm text-fg-muted">
          {series.description}
        </p>
      )}

      {series.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {series.tags.map((t) => (
            <span
              key={t}
              className="rounded-md bg-surface-hover px-2 py-0.5 text-xs text-fg-muted"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}

function SeriesModal({
  series,
  onClose,
  onSaved,
}: {
  series: main.ContentSeries | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(series?.title ?? '')
  const [description, setDescription] = useState(series?.description ?? '')
  const [category, setCategory] = useState(series?.category ?? '')
  const [tags, setTags] = useState((series?.tags ?? []).join(', '))
  const [notes, setNotes] = useState(series?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!title.trim()) {
      setError('Give the series a title.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await SaveContentSeries(
        main.ContentSeries.createFrom({
          id: series?.id ?? '',
          title: title.trim(),
          description: description.trim(),
          category: category.trim(),
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          notes: notes.trim(),
          createdAt: series?.createdAt ?? '',
        }),
      )
      onSaved()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the series.',
      )
    } finally {
      setSaving(false)
    }
  }

  const field =
    'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
  const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

  return (
    <Modal
      open
      onClose={onClose}
      title={series ? 'Edit series' : 'New content series'}
      icon={<Layers size={18} aria-hidden className="text-fg-muted" />}
      maxWidthClass="max-w-xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="flex flex-col gap-4"
      >
        <div>
          <label htmlFor="series-title" className={labelCls}>
            Title
          </label>
          <input
            id="series-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Building AI Bots"
            autoFocus
            className={field}
          />
        </div>

        <div>
          <label htmlFor="series-category" className={labelCls}>
            Category <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <input
            id="series-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Software & Game Development"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="series-description" className={labelCls}>
            Description{' '}
            <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <textarea
            id="series-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What is this series about?"
            className={`${field} resize-y`}
          />
        </div>

        <div>
          <label htmlFor="series-tags" className={labelCls}>
            Tags <span className="font-normal text-fg-muted">(comma-separated)</span>
          </label>
          <input
            id="series-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="ai, coding, twitch, youtube"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="series-notes" className={labelCls}>
            Notes <span className="font-normal text-fg-muted">(context)</span>
          </label>
          <textarea
            id="series-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Recurring talking points, links, format, sponsors…"
            className={`${field} resize-y`}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save series'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

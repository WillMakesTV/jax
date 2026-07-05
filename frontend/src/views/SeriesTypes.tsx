import {
  ArrowLeft,
  Pencil,
  Plus,
  Repeat,
  Shapes,
  Star,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  DeleteSeriesType,
  GetSeriesTypes,
  SaveSeriesType,
  SetDefaultSeriesType,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Modal} from '../components/Modal'

/**
 * The Content Series page's "Series Types" section: the classifications a
 * series can carry (e.g. a weekly episodic show vs. a one-off special) —
 * a title, whether it is episodic, and a longer description.
 */
export function SeriesTypesSection({onBack}: {onBack: () => void}) {
  const [types, setTypes] = useState<main.SeriesType[]>([])
  const [editing, setEditing] = useState<main.SeriesType | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () => {
    GetSeriesTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
  }
  useEffect(() => {
    load()
  }, [])

  const remove = async (id: string) => {
    try {
      await DeleteSeriesType(id)
      setTypes((prev) => prev.filter((t) => t.id !== id))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  // Clicking the current default's star clears it; anything else takes over
  // as the sole default (the backend unsets the previous holder).
  const setDefault = async (t: main.SeriesType) => {
    const id = t.isDefault ? '' : t.id
    try {
      await SetDefaultSeriesType(id)
      setTypes((prev) =>
        prev.map((p) =>
          main.SeriesType.createFrom({...p, isDefault: p.id === id}),
        ),
      )
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
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Content Series
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-fg-muted">
          The kinds of series you run — set one on each series so its format
          (episodic show, one-off special, …) is part of its context.
        </p>
        {types.length > 0 && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            Add type
          </button>
        )}
      </div>

      {types.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover sm:w-1/2"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            <Shapes size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              Add a series type
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              Describe a format — say, an episodic weekly show — and assign it
              to your series.
            </p>
          </div>
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {types.map((t) => (
            <TypeCard
              key={t.id}
              seriesType={t}
              onEdit={() => setEditing(t)}
              onDelete={() => void remove(t.id)}
              onToggleDefault={() => void setDefault(t)}
            />
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <TypeModal seriesType={editing} onClose={closeModal} onSaved={onSaved} />
      )}
    </div>
  )
}

function TypeCard({
  seriesType,
  onEdit,
  onDelete,
  onToggleDefault,
}: {
  seriesType: main.SeriesType
  onEdit: () => void
  onDelete: () => void
  onToggleDefault: () => void
}) {
  return (
    <li
      className={`flex flex-col rounded-xl border bg-surface p-4 ${
        seriesType.isDefault ? 'border-accent/50' : 'border-edge'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
          {seriesType.title}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleDefault}
            aria-pressed={seriesType.isDefault}
            title={
              seriesType.isDefault
                ? 'Default type — click to unset'
                : 'Make this the default type'
            }
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover ${
              seriesType.isDefault
                ? 'text-accent'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Star
              size={14}
              aria-hidden
              fill={seriesType.isDefault ? 'currentColor' : 'none'}
            />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit type"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Pencil size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete type"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {(seriesType.isDefault || seriesType.episodic) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {seriesType.isDefault && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
              <Star size={11} aria-hidden fill="currentColor" />
              Default
            </span>
          )}
          {seriesType.episodic && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
              <Repeat size={11} aria-hidden />
              Episodic
            </span>
          )}
        </div>
      )}

      {seriesType.description && (
        <p className="mt-2 line-clamp-3 text-sm text-fg-muted">
          {seriesType.description}
        </p>
      )}
    </li>
  )
}

function TypeModal({
  seriesType,
  onClose,
  onSaved,
}: {
  seriesType: main.SeriesType | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(seriesType?.title ?? '')
  const [episodic, setEpisodic] = useState(seriesType?.episodic ?? false)
  const [description, setDescription] = useState(seriesType?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!title.trim()) {
      setError('Give the type a title.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await SaveSeriesType(
        main.SeriesType.createFrom({
          id: seriesType?.id ?? '',
          title: title.trim(),
          episodic,
          description: description.trim(),
          createdAt: seriesType?.createdAt ?? '',
        }),
      )
      onSaved()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the type.',
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
      title={seriesType ? 'Edit series type' : 'New series type'}
      icon={<Shapes size={18} aria-hidden className="text-fg-muted" />}
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
          <label htmlFor="type-title" className={labelCls}>
            Title
          </label>
          <input
            id="type-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Weekly episodic show"
            autoFocus
            className={field}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-fg">Episodic</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              Series of this type run as numbered episodes rather than
              stand-alone streams.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={episodic}
            aria-label="Episodic"
            onClick={() => setEpisodic((v) => !v)}
            className={clsx(
              'relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              episodic ? 'bg-accent' : 'bg-surface-hover',
            )}
          >
            <span
              className={clsx(
                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                episodic ? 'translate-x-5' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>

        <div>
          <label htmlFor="type-description" className={labelCls}>
            Description{' '}
            <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <textarea
            id="type-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What defines this kind of series — cadence, format, structure…"
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
            {saving ? 'Saving…' : 'Save type'}
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

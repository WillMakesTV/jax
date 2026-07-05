import {Layers, Pencil, Plus, Shapes, Star, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  DeleteContentSeries,
  GetContentSeries,
  GetSeriesTypes,
  SetDefaultContentSeries,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {SERVICES} from '../services/services'
import {SeriesTypesSection} from './SeriesTypes'

/**
 * The Planning section's "Content Series" tab: reusable context/metadata for
 * recurring shows and segments, referenced when planning a stream. Adding and
 * editing happen on their own page (see EditSeries). A "Series Types"
 * sub-section manages the classifications a series can carry.
 */
export function ContentSeriesPanel({
  onEditSeries,
}: {
  /** Open the series editor page (null = create a new series). */
  onEditSeries: (series: main.ContentSeries | null) => void
}) {
  const [series, setSeries] = useState<main.ContentSeries[]>([])
  const [types, setTypes] = useState<main.SeriesType[]>([])
  const [showTypes, setShowTypes] = useState(false)

  const load = () => {
    GetContentSeries()
      .then((s) => setSeries(s ?? []))
      .catch(() => {})
    GetSeriesTypes()
      .then((t) => setTypes(t ?? []))
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

  // Clicking the current default's star clears it; anything else takes over
  // as the sole default (the backend unsets the previous holder).
  const setDefault = async (s: main.ContentSeries) => {
    const id = s.isDefault ? '' : s.id
    try {
      await SetDefaultContentSeries(id)
      setSeries((prev) =>
        prev.map((p) =>
          main.ContentSeries.createFrom({...p, isDefault: p.id === id}),
        ),
      )
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  // The Series Types sub-section; deleting a type can clear series
  // references, so the list reloads on the way back.
  if (showTypes) {
    return (
      <SeriesTypesSection
        onBack={() => {
          setShowTypes(false)
          load()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-fg-muted">
          Reusable context for your recurring shows and segments — reference
          them when planning a stream.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTypes(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
          >
            <Shapes size={14} aria-hidden />
            Series Types
          </button>
          {series.length > 0 && (
            <button
              type="button"
              onClick={() => onEditSeries(null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={14} aria-hidden />
              Add series
            </button>
          )}
        </div>
      </div>

      {series.length === 0 ? (
        <button
          type="button"
          onClick={() => onEditSeries(null)}
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
              Capture the title, categories, tags, and notes for a recurring
              show so planning is a click.
            </p>
          </div>
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {series.map((s) => (
            <SeriesCard
              key={s.id}
              series={s}
              typeTitle={types.find((t) => t.id === s.typeId)?.title ?? ''}
              onEdit={() => onEditSeries(s)}
              onDelete={() => remove(s.id)}
              onToggleDefault={() => void setDefault(s)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Chip showing a platform's category, with the service's brand icon. */
function CategoryChip({
  serviceId,
  category,
}: {
  serviceId: 'twitch' | 'youtube'
  category: main.ServiceCategory | undefined
}) {
  const svc = SERVICES.find((s) => s.id === serviceId)
  if (!svc || !category?.id) return null
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
      <svc.Icon size={11} title={svc.name} />
      {category.name}
    </span>
  )
}

function SeriesCard({
  series,
  typeTitle,
  onEdit,
  onDelete,
  onToggleDefault,
}: {
  series: main.ContentSeries
  /** Title of the series' type, '' when untyped. */
  typeTitle: string
  onEdit: () => void
  onDelete: () => void
  onToggleDefault: () => void
}) {
  const hasCategories =
    Boolean(series.twitchCategory?.id) || Boolean(series.youtubeCategory?.id)
  return (
    <li
      className={`flex flex-col rounded-xl border bg-surface p-4 ${
        series.isDefault ? 'border-accent/50' : 'border-edge'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
          {series.title}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleDefault}
            aria-pressed={series.isDefault}
            title={
              series.isDefault
                ? 'Default series — click to unset'
                : 'Make this the default series'
            }
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover ${
              series.isDefault
                ? 'text-accent'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Star
              size={14}
              aria-hidden
              fill={series.isDefault ? 'currentColor' : 'none'}
            />
          </button>
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

      {(series.isDefault || hasCategories || typeTitle) && (
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {series.isDefault && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
            <Star size={11} aria-hidden fill="currentColor" />
            Default
          </span>
        )}
        {typeTitle && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
            <Shapes size={11} aria-hidden />
            {typeTitle}
          </span>
        )}
        <CategoryChip serviceId="twitch" category={series.twitchCategory} />
        <CategoryChip serviceId="youtube" category={series.youtubeCategory} />
      </div>
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

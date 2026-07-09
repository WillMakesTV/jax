import {
  ArrowLeft,
  Check,
  Clapperboard,
  Film,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  DeleteVideoPlan,
  GetPastStreams,
  SaveVideoPlan,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EpisodeThumb} from '../components/EpisodeThumb'
import {
  PlanThumbnailEditor,
  zipThumbHistory,
} from '../components/PlanThumbnailEditor'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {formatDate} from '../lib/format'
import {DescriptionAiActions} from './PlanStream'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/** The two shapes a planned video can take. */
const FORMATS = [
  {
    id: 'long',
    label: 'Long form',
    icon: Film,
    hint: 'A full-length video — tutorials, breakdowns, VOD edits.',
  },
  {
    id: 'short',
    label: 'Short form',
    icon: Zap,
    hint: 'A Short/clip — vertical, under a minute.',
  },
] as const

/**
 * The video-plan edit page: create a new plan for a produced video (short or
 * long form), or edit an existing one — the non-live counterpart of the
 * stream-plan form. Saved plans surface at the top of the Videos page, like
 * planned streams do on the Broadcast page; a plan's read-only counterpart is
 * the VideoPlanDetails view page.
 */
export function PlanVideo({
  plan,
  onBack,
  onSaved,
  onDeleted,
}: {
  /** The plan being edited, or null when creating a new one. */
  plan: main.VideoPlan | null
  onBack: () => void
  /** Called with the stored plan after a save. */
  onSaved: (saved: main.VideoPlan) => void
  /** Called after the plan is deleted. */
  onDeleted: () => void
}) {
  const [title, setTitle] = useState(plan?.title ?? '')
  const [format, setFormat] = useState<string>(plan?.format || 'long')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [descSelection, setDescSelection] = useState<[number, number]>([0, 0])
  const [tags, setTags] = useState((plan?.tags ?? []).join(', '))
  // Thumbnail: generated or uploaded via the shared editor; the file is
  // staged here and attached to the plan on save.
  const [thumbFile, setThumbFile] = useState(plan?.thumbnailFile ?? '')
  const [thumbUrl, setThumbUrl] = useState(plan?.thumbnailUrl ?? '')
  // The past streams this video draws from (source footage).
  const [sources, setSources] = useState<main.VideoPlanStream[]>(
    (plan?.streams ?? []).map((s) => ({...s})),
  )
  // Past streams for the picker (cached backend read; fine on mount).
  const [pastStreams, setPastStreams] = useState<main.PastStream[]>([])
  const [streamsLoaded, setStreamsLoaded] = useState(false)
  useEffect(() => {
    GetPastStreams(false)
      .then((s) => setPastStreams(s ?? []))
      .catch(() => {})
      .finally(() => setStreamsLoaded(true))
  }, [])
  const isSelected = (startedAt: string) =>
    sources.some((src) => src.startedAt === startedAt)
  // Anchor of the last plain click; shift-clicking selects the range between
  // it and the clicked tile.
  const [anchor, setAnchor] = useState<number | null>(null)
  const pick = (index: number, shiftKey: boolean) => {
    const clicked = pastStreams[index]
    if (!clicked) return
    // The clicked tile's new state; a shift-click applies it to the whole
    // range (like a mail client's checkbox range selection).
    const select = !isSelected(clicked.startedAt)
    const range =
      shiftKey && anchor !== null
        ? pastStreams.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
        : [clicked]
    setSources((prev) => {
      if (!select) {
        const drop = new Set(range.map((s) => s.startedAt))
        return prev.filter((src) => !drop.has(src.startedAt))
      }
      const additions = range
        .filter((s) => !prev.some((src) => src.startedAt === s.startedAt))
        .map((s) => ({
          startedAt: s.startedAt,
          title: s.title || `Stream ${formatDate(s.startedAt)}`,
        }))
      return [...prev, ...additions]
    })
    if (!shiftKey) setAnchor(index)
  }
  const removeSource = (startedAt: string) =>
    setSources((prev) => prev.filter((s) => s.startedAt !== startedAt))
  // References the past-stream list no longer carries (e.g. the stream was
  // removed); they keep their stored title and can only be dropped.
  const orphans = streamsLoaded
    ? sources.filter(
        (src) => !pastStreams.some((s) => s.startedAt === src.startedAt),
      )
    : []
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const saved = await SaveVideoPlan(
        main.VideoPlan.createFrom({
          id: plan?.id ?? '',
          title: title.trim(),
          description,
          format,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          streams: sources,
          thumbnailFile: thumbFile,
          createdAt: plan?.createdAt ?? '',
        }),
      )
      onSaved(saved)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The plan could not be saved.',
      )
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!plan) return
    setDeleting(true)
    setError('')
    try {
      await DeleteVideoPlan(plan.id)
      onDeleted()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The plan could not be deleted.',
      )
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back
      </button>

      <form onSubmit={(e) => void save(e)} className="flex max-w-2xl flex-col gap-5">
        <p className="text-sm text-fg-muted">
          Plan a produced video — it appears at the top of the Videos page
          until you remove it.
        </p>

        <div>
          <label htmlFor="video-plan-title" className={labelCls}>
            Title
          </label>
          <input
            id="video-plan-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Top 5 moments from the launch stream"
            className={field}
          />
        </div>

        <div>
          <span className={labelCls}>Format</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                aria-pressed={format === f.id}
                className={clsx(
                  'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  format === f.id
                    ? 'border-accent bg-accent/10'
                    : 'border-edge bg-surface hover:bg-surface-hover',
                )}
              >
                <span
                  aria-hidden
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    format === f.id
                      ? 'bg-accent text-accent-fg'
                      : 'bg-surface-hover text-fg-muted',
                  )}
                >
                  <f.icon size={16} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-fg">
                    {f.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-muted">
                    {f.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={labelCls}>
            Thumbnail{' '}
            <span className="font-normal text-fg-muted">(optional)</span>
          </span>
          <div className="max-w-md">
            <PlanThumbnailEditor
              planTitle={title}
              planDescription={description}
              file={thumbFile}
              url={thumbUrl}
              history={zipThumbHistory(
                plan?.thumbnailHistory,
                plan?.thumbnailHistoryUrls,
              )}
              onApply={async (t) => {
                setThumbFile(t.file)
                setThumbUrl(t.url)
              }}
            />
          </div>
        </div>

        <div>
          <label htmlFor="video-plan-description" className={labelCls}>
            Description
          </label>
          <MarkdownField
            id="video-plan-description"
            value={description}
            onChange={setDescription}
            placeholder="What is this video about? Outline, beats, references…"
            onSelectionChange={(start, end) => setDescSelection([start, end])}
          />
          <DescriptionAiActions
            description={description}
            selection={descSelection}
            onDescription={(next) => {
              setDescription(next)
              setDescSelection([0, 0])
            }}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-fg">Source streams</span>
            {sources.length > 0 && (
              <span className="text-xs text-fg-muted">
                {sources.length} selected
              </span>
            )}
          </div>
          {/* References the past-stream list no longer resolves; removable
              chips above the picker. */}
          {orphans.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {orphans.map((s) => (
                <li
                  key={s.startedAt}
                  className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface py-0.5 pl-2.5 pr-1 text-xs font-medium text-fg-muted"
                >
                  <span className="max-w-56 truncate">
                    {s.title || 'Untitled stream'}
                  </span>
                  <span>{formatDate(s.startedAt)}</span>
                  <button
                    type="button"
                    onClick={() => removeSource(s.startedAt)}
                    title="Remove source stream"
                    aria-label={`Remove ${s.title || 'stream'} from sources`}
                    className="flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!streamsLoaded ? (
            <p className="text-sm text-fg-muted">Loading past streams…</p>
          ) : pastStreams.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No past streams available yet.
            </p>
          ) : (
            <ul
              aria-label="Pick source streams"
              className="grid max-h-96 select-none grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-edge bg-bg p-2 sm:grid-cols-3"
            >
              {pastStreams.map((s, i) => {
                const selected = isSelected(s.startedAt)
                return (
                  <li key={s.startedAt}>
                    <button
                      type="button"
                      onClick={(e) => pick(i, e.shiftKey)}
                      aria-pressed={selected}
                      aria-label={`${selected ? 'Remove' : 'Add'} ${s.title || 'untitled stream'} as a source`}
                      className={clsx(
                        'relative flex w-full flex-col overflow-hidden rounded-lg border text-left transition-colors',
                        selected
                          ? 'border-accent bg-accent/10 ring-1 ring-accent'
                          : 'border-edge bg-surface hover:bg-surface-hover',
                      )}
                    >
                      <EpisodeThumb
                        title={s.title}
                        startedAt={s.startedAt}
                        thumbnailUrl={s.thumbnailUrl}
                        episodeNumber={s.episodeNumber}
                      />
                      {selected && (
                        <span
                          aria-hidden
                          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg"
                        >
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-fg-muted">
            The past streams this video draws footage or material from. Click
            to select; Shift-click selects a range.
          </p>
        </div>

        <div>
          <label htmlFor="video-plan-tags" className={labelCls}>
            Tags
          </label>
          <input
            id="video-plan-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma, separated, tags"
            className={field}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Clapperboard size={14} aria-hidden />
            {saving ? 'Saving…' : 'Save video plan'}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          {plan && (
            <div className="ml-auto flex items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-xs text-fg-muted">
                    Delete this video plan?
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove()}
                    disabled={deleting}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Trash2 size={14} aria-hidden />
                  Delete plan
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  )
}

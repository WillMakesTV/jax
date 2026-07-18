import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clapperboard,
  Film,
  MonitorPlay,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  DeleteVideoPlan,
  GetPastStreams,
  ImportVideoPlanFootage,
  PickFootageFiles,
  RemoveVideoPlanFootage,
  SaveVideoPlan,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EpisodeThumb} from '../components/EpisodeThumb'
import {formatDate} from '../lib/format'
import {ObsRecordPanel} from '../obs/ObsRecordPanel'

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

/** Where the video's source material comes from on the content step. */
type ContentMode = 'streams' | 'footage'

/**
 * The video-plan edit page, in two steps: first the format (short or long
 * form), then the content — a title and the source material, picked from past
 * broadcasts or imported as new footage files. The non-live counterpart of
 * the stream-plan form; saved plans surface at the top of the Videos page,
 * and a plan's read-only counterpart is the VideoPlanDetails view page.
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
  const [step, setStep] = useState<1 | 2>(1)
  const [title, setTitle] = useState(plan?.title ?? '')
  const [format, setFormat] = useState<string>(plan?.format || 'long')
  const [tags, setTags] = useState((plan?.tags ?? []).join(', '))
  const [contentMode, setContentMode] = useState<ContentMode>('streams')
  // The past streams this video draws from (source footage).
  const [sources, setSources] = useState<main.VideoPlanStream[]>(
    (plan?.streams ?? []).map((s) => ({...s})),
  )
  // Footage already imported into the plan's workspace (edit mode), and files
  // picked this session that import on save (the plan may not exist yet).
  const [importedFiles, setImportedFiles] = useState<string[]>(
    plan?.files ?? [],
  )
  const [pendingPaths, setPendingPaths] = useState<string[]>([])
  // The Record-from-OBS panel (footage tab): an OBS preview with record
  // controls; stopped recordings join pendingPaths like picked files.
  const [obsRecordOpen, setObsRecordOpen] = useState(false)
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
        ? pastStreams.slice(
            Math.min(anchor, index),
            Math.max(anchor, index) + 1,
          )
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

  const addFootage = async () => {
    setError('')
    try {
      const paths = await PickFootageFiles()
      if (!paths || paths.length === 0) return
      setPendingPaths((prev) => [
        ...prev,
        ...paths.filter((p) => !prev.includes(p)),
      ])
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The files could not be picked.',
      )
    }
  }

  // Already-imported footage is removed from the workspace immediately (like
  // project files); pending picks are only local state until save.
  const removeImported = async (name: string) => {
    if (!plan) return
    try {
      const updated = await RemoveVideoPlanFootage(plan.id, name)
      setImportedFiles(updated.files ?? [])
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The footage could not be removed.',
      )
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      let saved = await SaveVideoPlan(
        main.VideoPlan.createFrom({
          id: plan?.id ?? '',
          title: title.trim(),
          format,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          streams: sources,
          // The description and thumbnail are the Publish tab's, not this
          // form's — passed straight through, because a save here must never
          // wipe the ones publishing has already drafted.
          description: plan?.description ?? '',
          thumbnailFile: plan?.thumbnailFile ?? '',
          createdAt: plan?.createdAt ?? '',
        }),
      )
      // Footage picked during the wizard imports once the plan exists.
      if (pendingPaths.length > 0) {
        saved = await ImportVideoPlanFootage(saved.id, pendingPaths)
      }
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

  const fileName = (path: string) => path.split(/[\\/]/).pop() || path

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={step === 1 ? onBack : () => setStep(1)}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        {step === 1 ? 'Back' : 'Format'}
      </button>

      {step === 1 ? (
        /* Step 1: the format, nothing else. */
        <div className="flex max-w-2xl flex-col gap-5">
          <p className="text-sm text-fg-muted">
            Plan a produced video — start by picking its shape. The content
            comes next.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                aria-pressed={format === f.id}
                className={clsx(
                  'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  format === f.id
                    ? 'border-accent bg-accent/10'
                    : 'border-edge bg-surface hover:bg-surface-hover',
                )}
              >
                <span
                  aria-hidden
                  className={clsx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                    format === f.id
                      ? 'bg-accent text-accent-fg'
                      : 'bg-surface-hover text-fg-muted',
                  )}
                >
                  <f.icon size={18} />
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

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              Next
              <ArrowRight size={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Step 2: the content — title and source material. */
        <form
          onSubmit={(e) => void save(e)}
          className="flex max-w-2xl flex-col gap-5"
        >
          <p className="text-sm text-fg-muted">
            A {format === 'short' ? 'short' : 'long'}-form video — give it a
            title and pick what it&apos;s made from.
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

          {/* No description or thumbnail here: both belong to publishing, and
              are drafted (with AI) on the plan's Publish tab against the video
              that actually got made — not against the idea of it. Asking for
              them up front means writing them twice. */}

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-fg">Content</span>
              {sources.length + importedFiles.length + pendingPaths.length >
                0 && (
                <span className="text-xs text-fg-muted">
                  {sources.length + importedFiles.length + pendingPaths.length}{' '}
                  selected
                </span>
              )}
            </div>
            <div
              role="tablist"
              aria-label="Content source"
              className="mb-2 flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
            >
              {(
                [
                  {id: 'streams', label: 'Past broadcasts'},
                  {id: 'footage', label: 'New footage'},
                ] as {id: ContentMode; label: string}[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={contentMode === m.id}
                  onClick={() => setContentMode(m.id)}
                  className={clsx(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    contentMode === m.id
                      ? 'bg-accent text-accent-fg'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {contentMode === 'streams' ? (
              <>
                {/* References the past-stream list no longer resolves;
                    removable chips above the picker. */}
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
                  The past streams this video draws footage or material from.
                  Click to select; Shift-click selects a range.
                </p>
              </>
            ) : (
              <>
                {importedFiles.length + pendingPaths.length > 0 && (
                  <ul className="mb-2 flex flex-col gap-1.5">
                    {importedFiles.map((name) => (
                      <li
                        key={`imported-${name}`}
                        className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-fg"
                      >
                        <Film
                          size={14}
                          aria-hidden
                          className="shrink-0 text-fg-muted"
                        />
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <button
                          type="button"
                          onClick={() => void removeImported(name)}
                          title="Remove footage"
                          aria-label={`Remove ${name}`}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </li>
                    ))}
                    {pendingPaths.map((path) => (
                      <li
                        key={`pending-${path}`}
                        className="flex items-center gap-2 rounded-lg border border-dashed border-edge bg-surface px-3 py-2 text-sm text-fg"
                      >
                        <Film
                          size={14}
                          aria-hidden
                          className="shrink-0 text-fg-muted"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {fileName(path)}
                        </span>
                        <span className="shrink-0 text-xs text-fg-muted">
                          imports on save
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingPaths((prev) =>
                              prev.filter((p) => p !== path),
                            )
                          }
                          title="Remove"
                          aria-label={`Remove ${fileName(path)}`}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                        >
                          <X size={13} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void addFootage()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
                  >
                    <Upload size={14} aria-hidden />
                    Add footage files…
                  </button>
                  <button
                    type="button"
                    onClick={() => setObsRecordOpen((v) => !v)}
                    aria-pressed={obsRecordOpen}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                      obsRecordOpen
                        ? 'border-accent bg-accent/10 text-fg'
                        : 'border-edge bg-surface text-fg hover:bg-surface-hover',
                    )}
                  >
                    <MonitorPlay size={14} aria-hidden />
                    Record from OBS
                  </button>
                </div>
                {obsRecordOpen && (
                  <div className="mt-2">
                    <ObsRecordPanel
                      onRecorded={(path) =>
                        setPendingPaths((prev) =>
                          prev.includes(path) ? prev : [...prev, path],
                        )
                      }
                    />
                  </div>
                )}
                <p className="mt-1.5 text-xs text-fg-muted">
                  Video files that never aired — screen captures, b-roll, phone
                  clips, or a fresh recording straight from OBS. They&apos;re
                  copied into the plan&apos;s edit workspace next to the
                  downloaded broadcasts.
                </p>
              </>
            )}
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
      )}
    </div>
  )
}

import clsx from 'clsx'
import {Check, Film, MonitorPlay, Trash2, Upload} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  EnsureVideoPlanWorkspace,
  GetPastStreams,
  ImportVideoPlanFootage,
  PickFootageFiles,
  RemoveVideoPlanFootage,
  SaveVideoPlan,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {formatDate} from '../lib/format'
import {ObsRecordPanel} from '../obs/ObsRecordPanel'
import {EpisodeThumb} from './EpisodeThumb'
import {Modal} from './Modal'

/** Where added content comes from — the same split as the plan wizard. */
type ContentMode = 'streams' | 'footage'

/**
 * The video-plan page's "Add Content" dialog: source additional past
 * broadcasts or bring in new footage — picked files or a fresh OBS recording
 * landed in the plan's sources folder — the same choices the "Plan a video"
 * wizard's content step offers, applied to an existing plan immediately.
 */
export function AddContentModal({
  open,
  onClose,
  plan,
  onUpdated,
}: {
  open: boolean
  onClose: () => void
  plan: main.VideoPlan
  /** Receives the stored plan after each change lands. */
  onUpdated: (plan: main.VideoPlan) => void
}) {
  const [mode, setMode] = useState<ContentMode>('streams')
  const [pastStreams, setPastStreams] = useState<main.PastStream[]>([])
  const [streamsLoaded, setStreamsLoaded] = useState(false)
  const [sources, setSources] = useState<main.VideoPlanStream[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [sourcesDir, setSourcesDir] = useState('')
  const [obsOpen, setObsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Adopt the plan's current content each time the dialog opens —
  // synchronously during render, so the pickers mount with the right state.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSources((plan.streams ?? []).map((s) => ({...s})))
      setFiles(plan.files ?? [])
      setMode('streams')
      setObsOpen(false)
      setError('')
    }
  }

  // The pickers' data: past streams for the grid, and the plan's workspace
  // (with its sources folder) so a recording has somewhere to land.
  useEffect(() => {
    if (!open) return
    GetPastStreams(false)
      .then((s) => setPastStreams(s ?? []))
      .catch(() => {})
      .finally(() => setStreamsLoaded(true))
    EnsureVideoPlanWorkspace(plan.id)
      .then((d) => setSourcesDir(d.sources))
      .catch(() => {})
  }, [open, plan.id])

  const isSelected = (startedAt: string) =>
    sources.some((src) => src.startedAt === startedAt)

  const toggleStream = (s: main.PastStream) => {
    setSources((prev) =>
      isSelected(s.startedAt)
        ? prev.filter((src) => src.startedAt !== s.startedAt)
        : [
            ...prev,
            {
              startedAt: s.startedAt,
              title: s.title || `Stream ${formatDate(s.startedAt)}`,
            },
          ],
    )
  }

  const dirtySources =
    sources.length !== (plan.streams ?? []).length ||
    sources.some(
      (src) => !(plan.streams ?? []).some((p) => p.startedAt === src.startedAt),
    )

  // Persist the stream selection onto the plan; everything else passes
  // through unchanged (the backend preserves files/status/shares itself).
  const saveSources = async () => {
    setSaving(true)
    setError('')
    try {
      const saved = await SaveVideoPlan(
        main.VideoPlan.createFrom({
          id: plan.id,
          title: plan.title,
          format: plan.format,
          tags: plan.tags ?? [],
          streams: sources,
          description: plan.description ?? '',
          thumbnailFile: plan.thumbnailFile ?? '',
          createdAt: plan.createdAt ?? '',
        }),
      )
      onUpdated(saved)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The sources could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  // Footage lands on the plan immediately — files picked from disk, or an
  // OBS recording already sitting in the plan's sources folder.
  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) return
    setError('')
    try {
      const updated = await ImportVideoPlanFootage(plan.id, paths)
      setFiles(updated.files ?? [])
      onUpdated(updated)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The footage could not be imported.',
      )
    }
  }

  const addFiles = async () => {
    setError('')
    try {
      const paths = await PickFootageFiles()
      await importPaths(paths ?? [])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The files could not be picked.',
      )
    }
  }

  const removeFile = async (name: string) => {
    setError('')
    try {
      const updated = await RemoveVideoPlanFootage(plan.id, name)
      setFiles(updated.files ?? [])
      onUpdated(updated)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The footage could not be removed.',
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add content"
      icon={<Film size={18} aria-hidden className="text-fg-muted" />}
      maxWidthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label="Content source"
          className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
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
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m.id
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'streams' ? (
          <>
            {!streamsLoaded ? (
              <p className="text-sm text-fg-muted">Loading past streams…</p>
            ) : pastStreams.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No past streams available yet.
              </p>
            ) : (
              <ul
                aria-label="Pick source streams"
                className="grid max-h-80 select-none grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-edge bg-bg p-2 sm:grid-cols-3"
              >
                {pastStreams.map((s) => {
                  const selected = isSelected(s.startedAt)
                  return (
                    <li key={s.startedAt}>
                      <button
                        type="button"
                        onClick={() => toggleStream(s)}
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
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveSources()}
                disabled={saving || !dirtySources}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save sources'}
              </button>
              <p className="text-xs text-fg-muted">
                The past streams this video draws footage from.
              </p>
            </div>
          </>
        ) : (
          <>
            {files.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {files.map((name) => (
                  <li
                    key={name}
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
                      onClick={() => void removeFile(name)}
                      title="Remove footage"
                      aria-label={`Remove ${name}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void addFiles()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                <Upload size={14} aria-hidden />
                Add footage files…
              </button>
              <button
                type="button"
                onClick={() => setObsOpen((v) => !v)}
                aria-pressed={obsOpen}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  obsOpen
                    ? 'border-accent bg-accent/10 text-fg'
                    : 'border-edge bg-surface text-fg hover:bg-surface-hover',
                )}
              >
                <MonitorPlay size={14} aria-hidden />
                Record from OBS
              </button>
            </div>
            {obsOpen && (
              <ObsRecordPanel
                recordDir={sourcesDir}
                planId={plan.id}
                onRecorded={(path) => void importPaths([path])}
              />
            )}
            <p className="text-xs text-fg-muted">
              Video files that never aired — screen captures, b-roll, phone
              clips, or a fresh recording straight from OBS. They land in the
              plan&apos;s workspace immediately.
            </p>
          </>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </Modal>
  )
}

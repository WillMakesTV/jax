import clsx from 'clsx'
import {
  AlertTriangle,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  CreateVideoStyle,
  DeleteVideoStyle,
  EditVideoStyle,
  GetVideoStyles,
  RebuildVideoStyle,
  SaveVideoStyle,
  SuggestVideoStyleTakeaways,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {Modal} from '../components/Modal'
import {PageHeader} from '../components/PageHeader'
import {useDataChanged} from '../lib/dataChanged'
import {useVideoStyleJobs} from '../style/VideoStyleProvider'
import {inspirationError} from './Inspiration'

/**
 * Video Style: the styles our videos are made to, each one written by the AI
 * runner out of the takeaways the Inspiration library lifted from other
 * people's videos.
 *
 * A build runs in the backend, not here: the style itself carries its state,
 * so navigating away and coming back — or clicking the status bar's chip —
 * shows exactly the progress the page was showing before.
 */
export function VideoStyle({styleId}: {styleId?: string}) {
  const [styles, setStyles] = useState<main.VideoStyle[]>([])
  const [openId, setOpenId] = useState(styleId ?? '')
  const [addOpen, setAddOpen] = useState(false)
  const {jobs} = useVideoStyleJobs()

  const load = useCallback(() => {
    GetVideoStyles()
      .then((s) => setStyles(s ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  // The build writes each step to the style, so the page follows a run it did
  // not start (and one that started before it was opened).
  useDataChanged(['video_styles'], load)
  useEffect(load, [jobs, load])

  // Arriving from the status bar opens that style.
  useEffect(() => {
    if (styleId) setOpenId(styleId)
  }, [styleId])

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        description="How our videos are made — written from what the Inspiration library learned."
        actions={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            New style
          </button>
        }
      />

      {styles.length === 0 ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover sm:w-2/3"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            <Palette size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              Build your first style
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              Name a style and Jax gathers the takeaways that bear on it, then
              writes the rules your videos are held to.
            </p>
          </div>
        </button>
      ) : (
        <ul className="flex flex-col gap-4">
          {styles.map((s) => (
            <StyleCard
              key={s.id}
              style={s}
              open={openId === s.id}
              onToggle={() => setOpenId((id) => (id === s.id ? '' : s.id))}
              onChanged={load}
            />
          ))}
        </ul>
      )}

      <StyleBuilderModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onBuilding={(id) => {
          setOpenId(id)
          load()
        }}
      />
    </div>
  )
}

/** A style's build state as a pill. */
function StatusPill({style}: {style: main.VideoStyle}) {
  const building = style.status === 'building'
  const failed = style.status === 'error'
  return (
    <span
      title={style.statusDetail || undefined}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        building && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        failed && 'bg-red-500/15 text-red-600 dark:text-red-400',
        !building && !failed && 'bg-accent/15 text-accent',
      )}
    >
      {building && <Loader2 size={11} aria-hidden className="animate-spin" />}
      {failed && <AlertTriangle size={11} aria-hidden />}
      {!building && !failed && <Sparkles size={11} aria-hidden />}
      {building
        ? style.statusDetail || 'Building'
        : failed
          ? 'Failed'
          : 'Ready'}
    </span>
  )
}

/** One style: its state, and the document itself once it is open. */
function StyleCard({
  style,
  open,
  onToggle,
  onChanged,
}: {
  style: main.VideoStyle
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const building = style.status === 'building'

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      onChanged()
    } catch (err) {
      setError(inspirationError(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-edge bg-surface">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-semibold text-fg">
            {style.name}
          </span>
          <span className="mt-0.5 block text-xs text-fg-muted">
            {style.sources.length}{' '}
            {style.sources.length === 1 ? 'takeaway' : 'takeaways'}
            {style.status === 'error' && style.statusDetail
              ? ` · ${style.statusDetail}`
              : ''}
          </span>
        </button>
        <StatusPill style={style} />
        <button
          type="button"
          onClick={() =>
            void run(
              () => RebuildVideoStyle(style.id),
              'That style could not be rebuilt.',
            )
          }
          disabled={busy || building}
          title="Write this style again from the library's current takeaways"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <RefreshCw size={13} aria-hidden />
          Rebuild
        </button>
        <button
          type="button"
          onClick={() =>
            void run(
              () => DeleteVideoStyle(style.id),
              'That style could not be removed.',
            )
          }
          disabled={busy}
          title="Remove this style"
          aria-label="Remove this style"
          className="text-fg-muted transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      {error && (
        <p className="px-4 pb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {open && (
        <div className="border-t border-edge px-4 py-4">
          {building ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Loader2 size={14} aria-hidden className="animate-spin" />
              {style.statusDetail || 'Building the style…'}
            </p>
          ) : style.body ? (
            <StyleBody style={style} onSaved={onChanged} />
          ) : (
            <p className="text-sm text-fg-muted">
              Nothing was written — rebuild the style to try again.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The written style, in the markdown editor: edits are typed straight into it
 * and saved on Done, or asked for in words — the model rewrites the document
 * against the takeaways it was built from, and the result lands in the same
 * field to accept or keep editing.
 */
function StyleBody({
  style,
  onSaved,
}: {
  style: main.VideoStyle
  onSaved: () => void
}) {
  const [body, setBody] = useState(style.body)
  const [editOpen, setEditOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'edit'>('')
  const [error, setError] = useState('')

  // A rebuild replaces the document behind the page; follow it unless there
  // are unsaved keystrokes in the field.
  useEffect(() => {
    setBody((current) => (current === '' ? style.body : current))
  }, [style.body])

  const save = async (next: string) => {
    setBusy('save')
    setError('')
    try {
      await SaveVideoStyle({...style, body: next} as main.VideoStyle)
      onSaved()
    } catch (err) {
      setError(inspirationError(err, 'That style could not be saved.'))
    } finally {
      setBusy('')
    }
  }

  const applyEdit = async () => {
    if (!instruction.trim()) {
      setError('Describe the edit you want.')
      return
    }
    setBusy('edit')
    setError('')
    try {
      const next = await EditVideoStyle(style.id, body, instruction.trim())
      setBody(next)
      setInstruction('')
      setEditOpen(false)
      await save(next)
    } catch (err) {
      setError(inspirationError(err, 'Could not apply the edit.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <MarkdownField
        id={`video-style-${style.id}`}
        value={body}
        onChange={setBody}
        onDone={() => void save(body)}
        placeholder="The style, in markdown."
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setEditOpen((o) => !o)
            setError('')
          }}
          disabled={busy !== ''}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <WandSparkles size={12} aria-hidden />
          Request edits
        </button>
        {busy === 'save' && (
          <span className="text-xs text-fg-muted">Saving…</span>
        )}
      </div>

      {editOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-bg p-3">
          <p className="text-xs text-fg-muted">
            The style as it stands and the {style.sources.length} takeaways it
            was built from are both sent, so an edit can reach back to the
            original advice.
          </p>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. cut the rules about music and say more about pacing"
            className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void applyEdit()}
              disabled={busy !== ''}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'edit' && (
                <Loader2 size={12} aria-hidden className="animate-spin" />
              )}
              {busy === 'edit' ? 'Applying…' : 'Apply edit'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditOpen(false)
                setInstruction('')
                setError('')
              }}
              disabled={busy !== ''}
              className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

/**
 * The builder: name the style, then review the takeaways Jax gathered for it
 * before the writing starts. Submitting closes the dialog — the run reports
 * itself in the status bar and on the page behind.
 */
function StyleBuilderModal({
  open,
  onClose,
  onBuilding,
}: {
  open: boolean
  onClose: () => void
  onBuilding: (styleId: string) => void
}) {
  const [step, setStep] = useState<'name' | 'takeaways'>('name')
  const [name, setName] = useState('')
  const [sources, setSources] = useState<main.VideoStyleSource[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setStep('name')
    setName('')
    setSources([])
    setPicked(new Set())
    setError('')
  }, [open])

  // Naming the style is the whole query: the takeaways that speak to it are
  // gathered here, and every one is included unless it is unticked.
  const next = async () => {
    const value = name.trim()
    if (!value) {
      setError('Name the style first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const found = await SuggestVideoStyleTakeaways(value)
      const list = found ?? []
      if (list.length === 0) {
        setError(
          'There are no takeaways to build from yet — study an inspiration video first.',
        )
        return
      }
      setSources(list)
      setPicked(new Set(list.map((_, i) => i)))
      setStep('takeaways')
    } catch (err) {
      setError(inspirationError(err, 'Those takeaways could not be gathered.'))
    } finally {
      setBusy(false)
    }
  }

  const build = async () => {
    const chosen = sources.filter((_, i) => picked.has(i))
    if (chosen.length === 0) {
      setError('Keep at least one takeaway — the style is written from them.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const style = await CreateVideoStyle(name.trim(), chosen)
      onBuilding(style.id)
      onClose()
    } catch (err) {
      setError(inspirationError(err, 'That style could not be started.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === 'name' ? 'New style' : `Takeaways for ${name.trim()}`}
      icon={<Palette size={18} aria-hidden className="text-accent" />}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void (step === 'name' ? next() : build())
        }}
        className="flex flex-col gap-4"
      >
        {step === 'name' ? (
          <div>
            <label
              htmlFor="video-style-name"
              className="mb-1.5 block text-sm font-medium text-fg"
            >
              Style name
            </label>
            <input
              id="video-style-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fast-cut tutorials"
              autoFocus
              className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
            <p className="mt-1.5 text-xs text-fg-muted">
              The name is the brief: Jax gathers the takeaways that speak to it,
              then writes the style from their advice.
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm text-fg-muted">
              {picked.size} of {sources.length} takeaways included. Untick
              anything that does not belong in this style.
            </p>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
              {sources.map((s, i) => (
                <li key={`${s.videoId}-${i}`}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-edge bg-bg p-3 transition-colors hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      onChange={() =>
                        setPicked((prev) => {
                          const nextSet = new Set(prev)
                          if (nextSet.has(i)) nextSet.delete(i)
                          else nextSet.add(i)
                          return nextSet
                        })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">
                        {s.title}
                      </span>
                      {s.detail && (
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {s.detail}
                        </span>
                      )}
                      {s.videoTitle && (
                        <span className="mt-0.5 block truncate text-xs text-fg-muted">
                          From {s.videoTitle}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} aria-hidden className="animate-spin" />}
            {step === 'name' ? 'Next' : 'Build style'}
          </button>
          <button
            type="button"
            onClick={step === 'name' ? onClose : () => setStep('name')}
            className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            {step === 'name' ? 'Cancel' : 'Back'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

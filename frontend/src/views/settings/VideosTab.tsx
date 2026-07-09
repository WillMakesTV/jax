import {Check, Folder, FolderInput, FolderOpen, MoveRight} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  DefaultEditWorkspaceDir,
  MoveEditWorkspaceFolder,
  SelectDirectory,
} from '../../../wailsjs/go/main/App'
import {Modal} from '../../components/Modal'
import {SETTING_KEYS, loadSetting, saveSetting} from '../../lib/settings'

/** Settings → Videos: where video production work lives on disk. */
export function VideosTab() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <WorkspacesSection />
    </div>
  )
}

/**
 * The edit-workspace folder: every video plan's Editor tab assembles its
 * source footage, transcripts, and rendered outputs in a per-plan subfolder
 * of this directory. Mirrors the download-folder controls in Streams.
 */
function WorkspacesSection() {
  const [dir, setDir] = useState('') // '' = use the default
  const [defaultDir, setDefaultDir] = useState('')
  // Move-folder flow: the picked target opens the confirmation, moving marks
  // the backend call in flight, and moveNote/moveError report how it went.
  const [moveTarget, setMoveTarget] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [moveNote, setMoveNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [stored, def] = await Promise.all([
        loadSetting(SETTING_KEYS.editWorkspaceDir),
        DefaultEditWorkspaceDir().catch(() => ''),
      ])
      if (cancelled) return
      setDir(stored ?? '')
      setDefaultDir(def)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const chooseFolder = async () => {
    try {
      const chosen = await SelectDirectory('Choose a workspace folder')
      if (chosen) {
        setDir(chosen)
        saveSetting(SETTING_KEYS.editWorkspaceDir, chosen)
      }
    } catch {
      // Dialog unavailable (e.g. plain Vite dev); ignore.
    }
  }

  const useDefault = () => {
    setDir('')
    saveSetting(SETTING_KEYS.editWorkspaceDir, '')
  }

  const effective = dir || defaultDir

  const pickMoveTarget = async () => {
    try {
      const chosen = await SelectDirectory('Move workspaces to…')
      if (chosen) {
        setMoveError('')
        setMoveNote('')
        setMoveTarget(chosen)
      }
    } catch {
      // Dialog unavailable (e.g. plain Vite dev); ignore.
    }
  }

  const confirmMove = async () => {
    setMoving(true)
    setMoveError('')
    try {
      const count = await MoveEditWorkspaceFolder(moveTarget)
      setDir(moveTarget)
      setMoveNote(
        count === 0
          ? 'Folder moved; there were no workspaces to carry over.'
          : `Moved ${count} workspace${count === 1 ? '' : 's'} to the new folder.`,
      )
      setMoveTarget('')
    } catch (err) {
      setMoveError(
        err instanceof Error && err.message
          ? err.message
          : String(err) || 'Could not move the workspace folder.',
      )
    } finally {
      setMoving(false)
    }
  }

  return (
    <section
      aria-labelledby="edit-workspaces-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <h2 id="edit-workspaces-heading" className="text-base font-semibold text-fg">
        Edit workspaces
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Each video plan&apos;s Editor works in its own folder here — the source
        footage, transcripts, session notes, and rendered videos of that plan.
        Choose where those workspaces live, or leave it to default to a{' '}
        <span className="font-mono text-xs">jax edits</span> folder in your
        Videos directory.
      </p>

      <div className="mt-5">
        <p className="mb-1.5 text-sm font-medium text-fg">Workspace folder</p>
        <div className="flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-2">
          <Folder size={16} aria-hidden className="shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
            {effective || 'Videos/jax edits'}
          </span>
          {!dir && (
            <span className="shrink-0 rounded-full border border-edge bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
              Default
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void chooseFolder()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <FolderOpen size={14} aria-hidden />
            Choose folder
          </button>
          <button
            type="button"
            onClick={() => void pickMoveTarget()}
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            <FolderInput size={14} aria-hidden />
            Move folder…
          </button>
          {dir && (
            <button
              type="button"
              onClick={useDefault}
              className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              Use default
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-fg-muted">
          &ldquo;Choose folder&rdquo; only changes where new workspaces are
          created; &ldquo;Move folder&rdquo; also relocates the workspaces you
          already have, and everything keeps working from the new location.
        </p>
        {moveNote && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <Check size={14} aria-hidden />
            {moveNote}
          </p>
        )}
        {moveError && !moveTarget && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            {moveError}
          </p>
        )}
      </div>

      <Modal
        open={Boolean(moveTarget)}
        onClose={() => {
          if (!moving) setMoveTarget('')
        }}
        title="Move the workspace folder?"
        icon={<FolderInput size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          Your edit workspaces will be moved to the new folder and the app will
          use it from now on — source links, transcripts, and rendered videos
          follow automatically.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-2">
            <Folder size={14} aria-hidden className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
              {effective}
            </span>
          </div>
          <MoveRight size={14} aria-hidden className="ml-3 text-fg-muted" />
          <div className="flex items-center gap-2 rounded-lg border border-edge bg-bg px-3 py-2">
            <Folder size={14} aria-hidden className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
              {moveTarget}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          Moving between drives copies the files, which can take a while for
          large footage. Edit sessions can&apos;t run while the move is in
          progress.
        </p>
        {moveError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {moveError}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setMoveTarget('')}
            disabled={moving}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirmMove()}
            disabled={moving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {moving ? 'Moving…' : 'Move workspaces'}
          </button>
        </div>
      </Modal>
    </section>
  )
}

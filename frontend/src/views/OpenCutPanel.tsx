import {Check, ExternalLink, FolderOpen, Pencil, Scissors} from 'lucide-react'
import {useEffect, useState} from 'react'
import {GetEditWorkspace} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {openExternal} from '../lib/browser'
import {SETTING_KEYS, loadSetting, saveSetting} from '../lib/settings'

/** The hosted OpenCut app, used when the producer hasn't pointed at their own. */
const DEFAULT_OPENCUT_URL = 'https://opencut.app'

/**
 * The OpenCut editor panel: the OpenCut web app embedded beside the plan, as a
 * manual timeline editor alongside the AI edit pipeline on the Editor tab.
 *
 * OpenCut is a standalone app with no line into the plan's workspace, so the
 * panel points the producer at where the plan's footage lives on disk to
 * import from, and offers OpenCut in a real browser window when the embed is
 * not enough. The instance is configurable — a self-hosted or bundled build —
 * so it can run offline; unset, it loads the hosted app.
 */
export function OpenCutPanel({plan}: {plan: main.VideoPlan}) {
  const [url, setUrl] = useState(DEFAULT_OPENCUT_URL)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dir, setDir] = useState('')

  useEffect(() => {
    loadSetting(SETTING_KEYS.openCutUrl)
      .then((v) => setUrl(v?.trim() || DEFAULT_OPENCUT_URL))
      .catch(() => {})
  }, [])

  useEffect(() => {
    GetEditWorkspace(plan.id)
      .then((ws) => setDir(ws.dir ?? ''))
      .catch(() => {})
  }, [plan.id])

  const saveUrl = () => {
    const next = draft.trim() || DEFAULT_OPENCUT_URL
    setUrl(next)
    // Store the empty string for the default, so "reset to hosted" is a real
    // stored state rather than a magic URL.
    saveSetting(
      SETTING_KEYS.openCutUrl,
      next === DEFAULT_OPENCUT_URL ? '' : next,
    )
    setEditing(false)
  }

  return (
    <section className="flex flex-1 flex-col" aria-label="OpenCut editor">
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            <Scissors size={13} aria-hidden />
            OpenCut
          </h2>
          <span className="text-xs text-fg-muted">
            a manual timeline editor, alongside the AI pipeline
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {dir && (
              <button
                type="button"
                onClick={() => openExternal('file://' + dir)}
                title="Open the plan's workspace folder — import this footage into OpenCut"
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                <FolderOpen size={13} aria-hidden />
                Footage folder
              </button>
            )}
            <button
              type="button"
              onClick={() => openExternal(url)}
              title="Open OpenCut in a browser window"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              <ExternalLink size={13} aria-hidden />
              Open in browser
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(url === DEFAULT_OPENCUT_URL ? '' : url)
                setEditing((v) => !v)
              }}
              aria-pressed={editing}
              title="Point the panel at a self-hosted or bundled OpenCut"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              <Pencil size={13} aria-hidden />
              Instance
            </button>
          </div>
        </div>

        {editing && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface p-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={DEFAULT_OPENCUT_URL}
              aria-label="OpenCut instance URL"
              className="min-w-56 flex-1 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={saveUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Check size={13} aria-hidden />
              Use this
            </button>
            <p className="w-full text-xs text-fg-muted">
              Blank uses the hosted app ({DEFAULT_OPENCUT_URL}). A local build
              lets OpenCut run offline.
            </p>
          </div>
        )}
      </div>

      <iframe
        key={url}
        src={url}
        title="OpenCut editor"
        className="min-h-[36rem] w-full flex-1 rounded-xl border border-edge bg-black"
        allow="clipboard-read; clipboard-write; camera; microphone; fullscreen"
      />

      <p className="mt-2 text-xs text-fg-muted">
        OpenCut is a separate editor — it doesn&apos;t read the plan&apos;s
        workspace. Use{' '}
        <span className="font-medium text-fg">Footage folder</span> to find this
        plan&apos;s clips and import them into OpenCut, then export your cut
        back to that folder.
      </p>
    </section>
  )
}

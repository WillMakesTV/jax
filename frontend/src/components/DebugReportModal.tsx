import {Bug} from 'lucide-react'
import {useEffect, useState} from 'react'
import {SaveDebugReport} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {DictationButton} from './DictationButton'
import {MarkdownField} from './markdown/MarkdownField'
import {Modal} from './Modal'

/** Append a dictated utterance to a field's current text. */
const appendUtterance = (current: string, text: string) =>
  current ? `${current.trimEnd()} ${text.trim()}` : text.trim()

interface DebugReportModalProps {
  open: boolean
  onClose: () => void
  /** Existing report to edit; omit to file a new one. */
  report?: main.DebugReport | null
  /** Prefill for the route field when filing a new report. */
  defaultRoute?: string
  /** Called with the stored report after a successful save. */
  onSaved?: (report: main.DebugReport) => void
}

/**
 * File or edit an AI debug report: a bug description tied to the page it was
 * seen on (or marked global). Reports land in the dev_ai_debug queue that an
 * AI client works over MCP — see Settings → Development.
 */
export function DebugReportModal({
  open,
  onClose,
  report,
  defaultRoute = '',
  onSaved,
}: DebugReportModalProps) {
  const [description, setDescription] = useState('')
  const [route, setRoute] = useState('')
  const [global, setGlobal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Reload the fields each time the dialog opens (fresh file or edit target).
  useEffect(() => {
    if (!open) return
    setDescription(report?.description ?? '')
    setRoute(report?.route ?? defaultRoute)
    setGlobal(report?.global ?? false)
    setError('')
  }, [open, report, defaultRoute])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const stored = await SaveDebugReport(
        main.DebugReport.createFrom({
          id: report?.id ?? 0,
          // The description is the report; there's no separate title field.
          title: report?.title ?? '',
          description,
          route,
          global,
          createdAt: report?.createdAt ?? '',
          updatedAt: report?.updatedAt ?? '',
        }),
      )
      onSaved?.(stored)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={report ? 'Edit debug report' : 'Report a bug'}
      icon={<Bug size={18} aria-hidden className="text-fg-muted" />}
      maxWidthClass="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Description</span>
          <MarkdownField
            id="debug-report-description"
            value={description}
            onChange={setDescription}
            placeholder="What happens, what you expected, and how to reproduce it."
            actions={
              <DictationButton
                fieldLabel="description"
                onText={(text) =>
                  setDescription((d) => appendUtterance(d, text))
                }
              />
            }
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Page</span>
          <input
            type="text"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            disabled={global}
            placeholder="App view the bug appears on"
            className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-50"
          />
        </label>

        <label className="flex items-center gap-2.5 text-sm text-fg">
          <input
            type="checkbox"
            checked={global}
            onChange={(e) => setGlobal(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Global — applies across the whole app, not just one page
        </label>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !description.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : report ? 'Save changes' : 'File report'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

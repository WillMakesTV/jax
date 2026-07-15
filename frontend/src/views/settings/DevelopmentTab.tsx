import clsx from 'clsx'
import {Bug, ChevronDown, ChevronRight, Pencil, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {DeleteDebugReport, ListDebugReports} from '../../../wailsjs/go/main/App'
import {main} from '../../../wailsjs/go/models'
import {DebugReportModal} from '../../components/DebugReportModal'
import {useDataChanged} from '../../lib/dataChanged'
import {SETTING_KEYS, loadSetting, saveSetting} from '../../lib/settings'

/**
 * Settings → Development: the AI debugging feature. Debug reports filed from
 * the top bar's bug button queue up here (and in the dev_ai_debug table); an
 * AI client connected over MCP works each report and deletes it once
 * resolved. The toggle publishes the optional "AI Debugging" Application
 * Skill that teaches that workflow.
 */
export function DevelopmentTab() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SkillToggleSection />
      <DebugReportsSection />
    </div>
  )
}

/** The AI Debugging Application Skill on/off switch. */
function SkillToggleSection() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadSetting(SETTING_KEYS.devDebugSkill).then((v) => {
      if (!cancelled) setEnabled(v === 'true')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    saveSetting(SETTING_KEYS.devDebugSkill, next ? 'true' : '')
  }

  return (
    <section
      aria-labelledby="ai-debugging-skill-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="ai-debugging-skill-heading"
            className="text-base font-semibold text-fg"
          >
            AI Debugging skill
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Publish the optional “AI Debugging” Application Skill. While
            enabled, Claude clients connected over MCP see the skill (in{' '}
            <span className="font-medium">Settings → Skills</span> and via{' '}
            <code className="text-xs">list_skills</code>) and learn to check
            the debug-report queue, work each report to resolution, and delete
            it once the fix is verified.
          </p>
        </div>
        {/* Toggle switch. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable the AI Debugging skill"
          onClick={toggle}
          className={clsx(
            'relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
            enabled ? 'bg-accent' : 'bg-surface-hover',
          )}
        >
          <span
            className={clsx(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>
    </section>
  )
}

/** The open debug reports: expandable descriptions, edit, and delete. */
function DebugReportsSection() {
  const [reports, setReports] = useState<main.DebugReport[] | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  // The report being edited, or undefined when the modal is closed.
  const [editing, setEditing] = useState<main.DebugReport | undefined>()
  const [modalOpen, setModalOpen] = useState(false)
  // Delete asks for a second click; holds the armed report id.
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null)

  const reload = () => {
    ListDebugReports()
      .then(setReports)
      .catch((err) => setError(String(err)))
  }

  useEffect(reload, [])
  // Reports come and go behind this page's back — filed from the top-bar
  // debug button, resolved by an AI client over MCP — so track the queue.
  useDataChanged(['dev_ai_debug'], reload)

  const remove = async (id: number) => {
    try {
      await DeleteDebugReport(id)
      setDeleteArmed(null)
      setError('')
      reload()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <section
      aria-labelledby="debug-reports-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="debug-reports-heading"
            className="text-base font-semibold text-fg"
          >
            Debug reports
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Bugs filed from the <Bug size={13} aria-hidden className="inline" />{' '}
            button in the top bar. Each stays in the queue until an AI client
            (or you) resolves and removes it — an empty list means nothing is
            known to be broken.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(undefined)
            setModalOpen(true)
          }}
          className="shrink-0 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          New report
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {reports && reports.length === 0 && (
        <p className="mt-4 text-sm text-fg-muted">No open reports.</p>
      )}

      {reports && reports.length > 0 && (
        <ul className="mt-4 flex flex-col divide-y divide-edge">
          {reports.map((r) => {
            const open = expanded === r.id
            return (
              <li key={r.id} className="py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : r.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {open ? (
                      <ChevronDown size={16} aria-hidden className="shrink-0 text-fg-muted" />
                    ) : (
                      <ChevronRight size={16} aria-hidden className="shrink-0 text-fg-muted" />
                    )}
                    <span className="truncate text-sm font-medium text-fg">
                      {r.title || r.description}
                    </span>
                    {r.global ? (
                      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        Global
                      </span>
                    ) : (
                      r.route && (
                        <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
                          {r.route}
                        </span>
                      )
                    )}
                    <span className="ml-auto shrink-0 text-xs text-fg-muted">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(r)
                      setModalOpen(true)
                    }}
                    aria-label={`Edit report ${r.title || r.id}`}
                    title="Edit"
                    className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    <Pencil size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      deleteArmed === r.id
                        ? void remove(r.id)
                        : setDeleteArmed(r.id)
                    }
                    onBlur={() => setDeleteArmed(null)}
                    aria-label={`Delete report ${r.title || r.id}`}
                    title={deleteArmed === r.id ? 'Click again to delete' : 'Delete'}
                    className={clsx(
                      'rounded-lg p-1.5 transition-colors',
                      deleteArmed === r.id
                        ? 'bg-red-600 text-white hover:bg-red-500'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-red-600 dark:hover:text-red-400',
                    )}
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
                {open && (
                  <p className="mt-2 ml-6 whitespace-pre-wrap text-sm text-fg-muted">
                    {r.description}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <DebugReportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        report={editing}
        onSaved={reload}
      />
    </section>
  )
}

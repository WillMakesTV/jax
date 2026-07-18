import clsx from 'clsx'
import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react'
import {useEffect, useRef, useState, type FormEvent} from 'react'
import {
  DeleteDebugReport,
  DisconnectGitHub,
  GetGitHubConnection,
  ListDebugReports,
  ListResolvedReports,
  PollGitHubDeviceAuth,
  SetGitHubRepo,
  StartGitHubDeviceAuth,
} from '../../../wailsjs/go/main/App'
import {main} from '../../../wailsjs/go/models'
import {GitHubIcon} from '../../components/brand/BrandIcons'
import {DebugReportModal} from '../../components/DebugReportModal'
import {openExternal} from '../../lib/browser'
import {useDataChanged} from '../../lib/dataChanged'
import {SETTING_KEYS, loadSetting, saveSetting} from '../../lib/settings'

/**
 * Settings → Development: the AI debugging feature. Debug reports filed from
 * the top bar's bug button queue up here (and in the dev_ai_debug table); an
 * AI client connected over MCP works each report and deletes it once
 * resolved. The toggle publishes the optional "AI Debugging" Application
 * Skill that teaches that workflow; while it's on, the GitHub connection the
 * workflow files issues and pushes fixes through is set up here too.
 */
export function DevelopmentTab() {
  const [skillEnabled, setSkillEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadSetting(SETTING_KEYS.devDebugSkill).then((v) => {
      if (!cancelled) setSkillEnabled(v === 'true')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleSkill = () => {
    const next = !skillEnabled
    setSkillEnabled(next)
    saveSetting(SETTING_KEYS.devDebugSkill, next ? 'true' : '')
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SkillToggleSection enabled={skillEnabled} onToggle={toggleSkill} />
      {skillEnabled && <GitHubSection />}
      <DebugReportsSection />
    </div>
  )
}

/** The AI Debugging Application Skill on/off switch. */
function SkillToggleSection({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
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
            <code className="text-xs">list_skills</code>) and learn to check the
            debug-report queue, work each report to resolution, and delete it
            once the fix is verified.
          </p>
        </div>
        {/* Toggle switch. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable the AI Debugging skill"
          onClick={onToggle}
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

/**
 * The GitHub link the AI-debugging workflow uses: an OAuth Device Flow
 * connection (the same user-code + poll UX as the streaming services) plus
 * the owner/repo the agents file issues and push fixes against.
 */
function GitHubSection() {
  const [conn, setConn] = useState<main.GitHubConnection | null>(null)
  const [clientId, setClientId] = useState('')
  const [repo, setRepo] = useState('')
  const [repoSaved, setRepoSaved] = useState(false)
  const [phase, setPhase] = useState<'config' | 'awaiting'>('config')
  const [info, setInfo] = useState<main.DeviceCodeInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // A standing connection renders as a compact one-liner; the details
  // (account, disconnect, repository) only show while expanded. Completing
  // a connect expands so the repository can be set right away.
  const [expanded, setExpanded] = useState(false)

  const poller = useRef<{cancelled: boolean; timer: number | undefined}>({
    cancelled: false,
    timer: undefined,
  })

  useEffect(() => {
    let cancelled = false
    GetGitHubConnection()
      .then((c) => {
        if (cancelled) return
        setConn(c)
        setRepo(c.repo)
      })
      .catch(() => {})
    void loadSetting(SETTING_KEYS.githubClientId).then((v) => {
      if (!cancelled && v) setClientId(v)
    })
    const ref = poller.current
    return () => {
      cancelled = true
      ref.cancelled = true
      if (ref.timer) window.clearTimeout(ref.timer)
    }
  }, [])

  const schedulePoll = (
    deviceCode: string,
    id: string,
    intervalSec: number,
    deadline: number,
  ) => {
    poller.current.timer = window.setTimeout(async () => {
      if (poller.current.cancelled) return
      if (Date.now() > deadline) {
        setError('The code expired before authorization. Please try again.')
        setPhase('config')
        return
      }
      try {
        const result = await PollGitHubDeviceAuth(id, deviceCode)
        if (poller.current.cancelled) return
        if (result.status === 'complete') {
          setPhase('config')
          setConn(await GetGitHubConnection())
          setExpanded(true)
        } else if (result.status === 'error') {
          setError(result.message || 'Authorization failed.')
          setPhase('config')
        } else {
          const next =
            result.message === 'slow_down' ? intervalSec + 5 : intervalSec
          schedulePoll(deviceCode, id, next, deadline)
        }
      } catch (err) {
        if (poller.current.cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('config')
      }
    }, intervalSec * 1000)
  }

  const connect = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    saveSetting(SETTING_KEYS.githubClientId, clientId.trim())
    try {
      const deviceInfo = await StartGitHubDeviceAuth(clientId.trim())
      setInfo(deviceInfo)
      setPhase('awaiting')
      poller.current.cancelled = false
      const interval = deviceInfo.interval > 0 ? deviceInfo.interval : 5
      const ttl = deviceInfo.expiresIn > 0 ? deviceInfo.expiresIn : 900
      schedulePoll(
        deviceInfo.deviceCode,
        clientId.trim(),
        interval,
        Date.now() + ttl * 1000,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    try {
      await DisconnectGitHub()
      setConn(await GetGitHubConnection())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveRepo = async () => {
    setError('')
    setRepoSaved(false)
    try {
      await SetGitHubRepo(repo.trim())
      setRepo(repo.trim())
      setRepoSaved(true)
      window.setTimeout(() => setRepoSaved(false), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const inputCls =
    'rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'

  // Connected and collapsed: a compact one-liner; the details are a click
  // away.
  if (conn?.connected && !expanded) {
    return (
      <section
        aria-labelledby="github-connection-heading"
        className="rounded-xl border border-edge bg-surface px-6 py-4"
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="flex w-full items-center gap-3 text-left"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg"
          >
            <GitHubIcon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              id="github-connection-heading"
              className="block text-sm font-semibold text-fg"
            >
              GitHub
            </span>
            <span className="block truncate text-xs text-fg-muted">
              Connected as {conn.account}
              {repo ? ` · ${repo}` : ''}
            </span>
          </span>
          <ChevronRight
            size={16}
            aria-hidden
            className="shrink-0 text-fg-muted"
          />
        </button>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="github-connection-heading"
      className="rounded-xl border border-edge bg-surface p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg"
        >
          <GitHubIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="github-connection-heading"
                className="text-base font-semibold text-fg"
              >
                Connect GitHub
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                The repository the AI-debugging workflow works against: agents
                open an issue per debug report, push the fix citing it, and
                close it on resolution.
              </p>
            </div>
            {conn?.connected && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-expanded
                aria-label="Collapse the GitHub section"
                title="Collapse"
                className="shrink-0 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <ChevronDown size={16} aria-hidden />
              </button>
            )}
          </div>

          {conn?.connected ? (
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-bg px-3 py-2">
                <p className="text-sm text-fg">
                  Connected as{' '}
                  <span className="font-semibold">{conn.account}</span>
                </p>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
                >
                  Disconnect
                </button>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">Repository</span>
                <span className="flex items-center gap-2">
                  <input
                    type="text"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="owner/repo"
                    className={clsx(inputCls, 'flex-1')}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => void saveRepo()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
                  >
                    {repoSaved ? (
                      <>
                        <Check
                          size={14}
                          aria-hidden
                          className="text-emerald-500"
                        />
                        Saved
                      </>
                    ) : (
                      'Save'
                    )}
                  </button>
                </span>
                <span className="text-xs text-fg-muted">
                  The owner/repo issues are filed on (e.g. octocat/hello-world).
                </span>
              </label>
            </div>
          ) : phase === 'awaiting' && info ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-fg-muted">
                A browser window has opened to authorize GitHub. If prompted,
                enter this code:
              </p>
              <div className="rounded-lg border border-edge bg-bg px-4 py-3 text-center">
                <span className="select-all font-mono text-2xl font-bold tracking-[0.3em] text-fg">
                  {info.userCode}
                </span>
              </div>
              <a
                href={info.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-accent underline"
              >
                <ExternalLink size={14} aria-hidden />
                Open the authorization page
              </a>
              <p className="text-sm text-fg-muted">
                Waiting for you to approve access…
              </p>
            </div>
          ) : (
            <form
              onSubmit={(e) => void connect(e)}
              className="mt-4 flex flex-col gap-3"
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">Client ID</span>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Your GitHub OAuth app's Client ID"
                  className={inputCls}
                  autoComplete="off"
                />
                <span className="text-xs text-fg-muted">
                  Create an OAuth app under GitHub Settings → Developer settings
                  and enable Device Flow; only the Client ID is needed here.
                </span>
              </label>
              <button
                type="submit"
                disabled={busy || !clientId.trim()}
                className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Connect GitHub'}
              </button>
            </form>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * The debug reports, in two tabs: Open (expandable descriptions, edit, and
 * delete) and Resolved — the permanent history of fixed reports with their
 * GitHub issue references.
 */
function DebugReportsSection() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [reports, setReports] = useState<main.DebugReport[] | null>(null)
  const [history, setHistory] = useState<main.FixNotice[]>([])
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
    ListResolvedReports()
      .then((h) => setHistory(h ?? []))
      .catch(() => {})
  }

  useEffect(reload, [])
  // Reports come and go behind this page's back — filed from the top-bar
  // debug button, resolved by an AI client over MCP — so track both the
  // queue and the history it feeds.
  useDataChanged(['dev_ai_debug', 'dev_ai_debug_fixed'], reload)

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
            {tab === 'open' ? (
              <>
                Bugs filed from the{' '}
                <Bug size={13} aria-hidden className="inline" /> button in the
                top bar. Each stays in the queue until an AI client (or you)
                resolves and removes it — an empty list means nothing is known
                to be broken.
              </>
            ) : (
              <>
                Every report the AI workflow has fixed, with the GitHub issue
                that tracked it and when the fix landed.
              </>
            )}
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

      <div
        role="tablist"
        aria-label="Debug report lists"
        className="ml-auto mt-4 flex w-fit items-center gap-1 rounded-lg border border-edge bg-bg p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'open'}
          onClick={() => setTab('open')}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'open'
              ? 'bg-accent text-accent-fg'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <Bug size={14} aria-hidden />
          Open{reports && reports.length > 0 ? ` (${reports.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'resolved'}
          onClick={() => setTab('resolved')}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'resolved'
              ? 'bg-accent text-accent-fg'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <Check size={14} aria-hidden />
          Resolved{history.length > 0 ? ` (${history.length})` : ''}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {tab === 'open' && reports && reports.length === 0 && (
        <p className="mt-4 text-sm text-fg-muted">No open reports.</p>
      )}

      {tab === 'resolved' && history.length === 0 && (
        <p className="mt-4 text-sm text-fg-muted">Nothing resolved yet.</p>
      )}

      {tab === 'resolved' && history.length > 0 && (
        <ResolvedReportsList history={history} />
      )}

      {tab === 'open' && reports && reports.length > 0 && (
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
                      <ChevronDown
                        size={16}
                        aria-hidden
                        className="shrink-0 text-fg-muted"
                      />
                    ) : (
                      <ChevronRight
                        size={16}
                        aria-hidden
                        className="shrink-0 text-fg-muted"
                      />
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
                  {r.issueUrl && (
                    <button
                      type="button"
                      onClick={() => openExternal(r.issueUrl)}
                      title={r.issueUrl}
                      className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
                    >
                      {r.issueNumber ? `#${r.issueNumber}` : 'issue'}
                    </button>
                  )}
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
                    title={
                      deleteArmed === r.id ? 'Click again to delete' : 'Delete'
                    }
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

/**
 * The resolution history rows: every report resolved over MCP, kept for good
 * with its GitHub issue reference and when the fix landed. Shown under the
 * Debug reports section's Resolved tab; the bug-fixed notice in the status
 * bar links here.
 */
/** How many resolved reports one page shows. */
const RESOLVED_PAGE_SIZE = 25

function ResolvedReportsList({history}: {history: main.FixNotice[]}) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [page, setPage] = useState(0)

  // New resolutions shift the pages; clamp rather than strand the view.
  const pages = Math.max(1, Math.ceil(history.length / RESOLVED_PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const start = current * RESOLVED_PAGE_SIZE
  const visible = history.slice(start, start + RESOLVED_PAGE_SIZE)

  return (
    <>
      <ul className="mt-4 flex flex-col divide-y divide-edge">
        {visible.map((n) => {
          const open = expanded === n.id
          return (
            <li key={n.id} className="py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : n.id)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {open ? (
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className="shrink-0 text-fg-muted"
                    />
                  ) : (
                    <ChevronRight
                      size={16}
                      aria-hidden
                      className="shrink-0 text-fg-muted"
                    />
                  )}
                  <Check
                    size={14}
                    aria-hidden
                    className="shrink-0 text-green-600 dark:text-green-400"
                  />
                  <span className="truncate text-sm font-medium text-fg">
                    {n.title || n.description}
                  </span>
                  {n.route && (
                    <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
                      {n.route}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-fg-muted">
                    {new Date(n.resolvedAt).toLocaleDateString()}
                  </span>
                </button>
                {n.issueUrl && (
                  <button
                    type="button"
                    onClick={() => openExternal(n.issueUrl)}
                    title={n.issueUrl}
                    className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
                  >
                    {n.issueNumber ? `#${n.issueNumber}` : 'issue'}
                  </button>
                )}
              </div>
              {open && (
                <p className="mt-2 ml-6 whitespace-pre-wrap text-sm text-fg-muted">
                  {n.description || 'No description was recorded.'}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-fg-muted">
            {start + 1}–{Math.min(start + RESOLVED_PAGE_SIZE, history.length)}{' '}
            of {history.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, current - 1))}
              disabled={current === 0}
              className="rounded-lg border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(pages - 1, current + 1))}
              disabled={current >= pages - 1}
              className="rounded-lg border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  )
}

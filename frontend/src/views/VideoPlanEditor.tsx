import {
  Check,
  Download,
  FolderCog,
  Loader2,
  Play,
  Radio,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  CancelEditRun,
  GetEditWorkspace,
  GetEditorTools,
  GetTranscribeJobs,
  InstallEditorTools,
  PrepareEditWorkspace,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'
import {useDownloadStatus} from '../downloads/DownloadProvider'
import {formatBytes, formatDate} from '../lib/format'

/**
 * The Editor tab of a video plan: produces the actual video from the plan's
 * downloaded source footage. The engine is the vendored video-use library
 * driven by a headless Claude Code session in a per-plan workspace; the app
 * pre-seeds the workspace with the source videos, locally produced
 * transcripts (in video-use's cached format, so nothing re-transcribes), and
 * the plan's metadata as session memory.
 */
export function VideoPlanEditor({
  plan,
  onOpenSource,
  onPlay,
  onComposeDirections,
  sourceThumbs = {},
}: {
  plan: main.VideoPlan
  /** Open a source stream's details page (where Download/Transcribe live). */
  onOpenSource: (startedAt: string) => void
  /** Play a rendered output in the page's video modal. */
  onPlay: (title: string, url: string) => void
  /** Open the session-directions page (the AI note builder). */
  onComposeDirections: () => void
  /** Past-stream thumbnail URLs keyed by startedAt, for the source rows. */
  sourceThumbs?: Record<string, string>
}) {
  const [tools, setTools] = useState<main.EditorTools | null>(null)
  const [installing, setInstalling] = useState(false)
  // Progress lines from the library install (the backend's editor:setup
  // events), shown inside the setup card while it works.
  const [setupLog, setSetupLog] = useState<string[]>([])
  const [ws, setWs] = useState<main.EditWorkspaceInfo | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [note, setNote] = useState('')

  // In-flight work on the plan's sources: the app-wide download status (one
  // download runs at a time, keyed by the stream's startedAt) and the
  // transcription queue (keyed by download subfolder).
  const downloadStatus = useDownloadStatus()
  const [transcribeJobs, setTranscribeJobs] = useState<main.TranscribeJob[]>([])

  const refreshWorkspace = useCallback(() => {
    GetEditWorkspace(plan.id)
      .then((w) => {
        setWs(w)
        setRunning(w.running)
      })
      .catch(() => {})
  }, [plan.id])

  useEffect(() => {
    GetEditorTools().then(setTools).catch(() => {})
    GetTranscribeJobs()
      .then((jobs) => setTranscribeJobs(jobs ?? []))
      .catch(() => {})
    refreshWorkspace()
  }, [refreshWorkspace])

  // Append a line to the log, keeping it bounded.
  const push = useCallback((...lines: string[]) => {
    if (lines.length === 0) return
    setLog((prev) => [...prev, ...lines].slice(-400))
  }, [])

  // Setup progress (library install) and run progress (the Claude session's
  // stream-json lines, digested to the readable parts).
  useEffect(() => {
    const offSetup = EventsOn('editor:setup', (line: string) =>
      setSetupLog((prev) => [...prev, line].slice(-150)),
    )
    const offLine = EventsOn('editor:line', (planId: string, line: string) => {
      if (planId === plan.id) push(...digestStreamJSON(line))
    })
    const offExit = EventsOn('editor:exit', (planId: string, detail: string) => {
      if (planId !== plan.id) return
      setRunning(false)
      setNote(detail || '')
      push(detail ? `✗ ${detail}` : '✓ Edit session finished.')
      refreshWorkspace()
    })
    // Source work finishing elsewhere in the app: keep the queue mirror
    // current and recheck the workspace when a download or transcription
    // lands, so the source rows flip to green by themselves.
    const offQueue = EventsOn('vodtranscribe:queue', (jobs: main.TranscribeJob[]) =>
      setTranscribeJobs(jobs ?? []),
    )
    const offVodExit = EventsOn('vodtranscribe:exit', () => refreshWorkspace())
    const offDlExit = EventsOn('download:exit', (detail: string) => {
      if (!detail) refreshWorkspace()
    })
    return () => {
      offSetup()
      offLine()
      offExit()
      offQueue()
      offVodExit()
      offDlExit()
    }
  }, [plan.id, push, refreshWorkspace])

  // Keep the logs scrolled to the newest line.
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
  const setupLogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = setupLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [setupLog])

  const install = () => {
    setInstalling(true)
    setSetupLog(['Starting the editor library install…'])
    setNote('')
    InstallEditorTools()
      .then((t) => {
        // Recheck the whole page: dependency card (which hides itself once
        // everything is ready) and the workspace's source/output state.
        setTools(t)
        refreshWorkspace()
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setNote(msg)
        setSetupLog((prev) => [...prev, `✗ ${msg}`])
        // The install may have partially succeeded (e.g. clone ok, pip
        // failed) — recheck what is there now.
        GetEditorTools().then(setTools).catch(() => {})
      })
      .finally(() => setInstalling(false))
  }

  const prepare = () => {
    setPreparing(true)
    setNote('')
    PrepareEditWorkspace(plan.id)
      .then(setWs)
      .catch((err) => setNote(err instanceof Error ? err.message : String(err)))
      .finally(() => setPreparing(false))
  }

  const cancel = () => {
    void CancelEditRun()
    setRunning(false)
    push('Edit session cancelled.')
    refreshWorkspace()
  }

  const sources = ws?.sources ?? []
  const outputs = ws?.outputs ?? []
  const readySources = sources.filter((s) => s.file || s.downloaded)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* The tab's primary actions. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={prepare}
          disabled={preparing || !tools?.videoUse}
          title="Link the downloaded videos and transcripts into the plan's edit workspace"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <FolderCog size={14} aria-hidden />
          {preparing
            ? 'Preparing…'
            : ws?.prepared
              ? 'Refresh workspace'
              : 'Prepare workspace'}
        </button>
        {running ? (
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Square size={14} aria-hidden />
            Stop session
          </button>
        ) : (
          <button
            type="button"
            onClick={onComposeDirections}
            disabled={!tools?.ready || readySources.length === 0}
            title={
              !tools?.ready
                ? 'Finish the editor setup below first'
                : readySources.length === 0
                  ? 'No source stream has a downloaded video yet'
                  : 'Compose the session directions and start editing'
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wand2 size={14} aria-hidden />
            Start edit session
          </button>
        )}
        {running && (
          <span className="text-xs text-fg-muted">
            Editing… progress streams below.
          </span>
        )}
      </div>

      {/* Dependency / library status. */}
      {tools && !tools.ready && (
        <section
          aria-label="Editor setup"
          className="rounded-xl border border-edge bg-surface p-4"
        >
          <p className="text-sm font-semibold text-fg">Set up the editor</p>
          <p className="mt-1 text-sm text-fg-muted">
            The editor drives the open-source video-use library (with
            HyperFrames for overlays) through Claude Code, working on this
            plan&apos;s downloaded footage and transcripts.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            <ToolCheck ok={tools.ffmpeg} label="ffmpeg" />
            <ToolCheck ok={tools.python} label="Python 3.11" />
            <ToolCheck ok={tools.claude} label="Claude Code" />
            <ToolCheck ok={tools.videoUse} label="video-use library" />
            <ToolCheck
              ok={Boolean(tools.node)}
              label={tools.node ? `Node ${tools.node}` : 'Node 22+ (overlays)'}
              optional
            />
            <ToolCheck ok={tools.git} label="git (to install)" optional />
          </ul>
          <button
            type="button"
            onClick={install}
            disabled={installing || !tools.git}
            title={
              tools.git
                ? 'Fetch the video-use library and install its Python dependencies'
                : 'Install git first — it fetches the library'
            }
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Download size={14} aria-hidden />
            {installing
              ? 'Installing…'
              : tools.videoUse
                ? 'Update editor library'
                : 'Install editor library'}
          </button>
          {/* Live install status; the card re-checks itself (and disappears)
              once everything is ready. */}
          {(installing || setupLog.length > 0) && (
            <div
              ref={setupLogRef}
              aria-live="polite"
              className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-edge bg-bg p-3 font-mono text-xs leading-relaxed text-fg-muted"
            >
              {setupLog.map((line, i) => (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {line}
                </p>
              ))}
              {installing && (
                <p className="animate-pulse text-fg">Working…</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* The plan's source footage as the workspace sees it. */}
      <section aria-labelledby="editor-sources-heading">
        <h2
          id="editor-sources-heading"
          className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          Source footage
        </h2>
        {sources.length === 0 ? (
          <p className="text-sm text-fg-muted">
            The plan references no source streams yet — pick them on the edit
            page.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sources.map((s) => {
              // In-flight work on this source, surfaced as a spinner state.
              const downloading =
                !s.downloaded &&
                downloadStatus.state === 'running' &&
                downloadStatus.startedAt === s.startedAt
              const transcribeJob =
                !s.hasTranscript && s.subfolder
                  ? transcribeJobs.find((j) => j.subfolder === s.subfolder)
                  : undefined
              return (
                <li key={s.startedAt}>
                  <button
                    type="button"
                    onClick={() => onOpenSource(s.startedAt)}
                    title="Open the stream's page (download and transcription live there)"
                    className="flex w-full items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                  >
                    {sourceThumbs[s.startedAt] ? (
                      <img
                        src={sourceThumbs[s.startedAt]}
                        alt=""
                        aria-hidden
                        className="h-10 w-[71px] shrink-0 rounded-md border border-edge object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-10 w-[71px] shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted"
                      >
                        <Radio size={14} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">
                        {s.episodeNumber > 0 && (
                          <span className="font-semibold">
                            EP {s.episodeNumber} ·{' '}
                          </span>
                        )}
                        {s.title || 'Untitled stream'}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {formatDate(s.startedAt)}
                      </span>
                    </span>
                    {/* Constant labels keep the columns aligned; the icon
                        alone carries the status (check, X, or throbber while
                        the work runs — clicking the row opens the stream's
                        page, where that work lives). */}
                    <SourceCheck
                      state={
                        s.downloaded ? 'ok' : downloading ? 'busy' : 'missing'
                      }
                      label="download"
                      title={
                        downloading
                          ? downloadStatus.detail || 'Downloading…'
                          : undefined
                      }
                    />
                    <SourceCheck
                      state={
                        s.hasTranscript
                          ? 'ok'
                          : transcribeJob
                            ? 'busy'
                            : 'missing'
                      }
                      label="transcript"
                      title={
                        transcribeJob
                          ? transcribeJob.state === 'queued'
                            ? 'Queued for transcription'
                            : 'Transcribing…'
                          : undefined
                      }
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {sources.some((s) => !s.downloaded || !s.hasTranscript) && (
          <p className="mt-1.5 text-xs text-fg-muted">
            Missing footage or transcripts? Open the stream and use its
            Download / Transcribe actions — this list follows their progress
            and updates itself when they finish.
          </p>
        )}
        {ws?.dir && (
          <p
            className="mt-1.5 truncate text-xs text-fg-muted"
            title={ws.dir}
          >
            Workspace: <span className="font-mono">{ws.dir}</span> — change
            where workspaces live in Settings → Videos.
          </p>
        )}
      </section>

      {/* The running/last session's status and progress. */}
      {(note || log.length > 0) && (
        <section aria-labelledby="editor-run-heading">
          <h2
            id="editor-run-heading"
            className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            Edit session
          </h2>
          {note && (
            <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">
              {note}
            </p>
          )}
          {log.length > 0 && (
            <div
              ref={logRef}
              className="max-h-64 overflow-y-auto rounded-lg border border-edge bg-bg p-3 font-mono text-xs leading-relaxed text-fg-muted"
            >
              {log.map((line, i) => (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {line}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Rendered artifacts. */}
      {outputs.length > 0 && (
        <section aria-labelledby="editor-outputs-heading">
          <h2
            id="editor-outputs-heading"
            className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            Rendered videos
          </h2>
          <ul className="flex flex-col gap-2">
            {outputs.map((o) => (
              <li
                key={o.name}
                className="flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => onPlay(`${plan.title} — ${o.name}`, o.mediaUrl)}
                  aria-label={`Play ${o.name}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity hover:opacity-90"
                >
                  <Play size={14} aria-hidden className="ml-0.5" />
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg">
                    {o.name}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {formatBytes(o.sizeBytes)} · rendered{' '}
                    {formatDate(o.modifiedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  )
}

/** One dependency line in the setup checklist. */
function ToolCheck({
  ok,
  label,
  optional = false,
}: {
  ok: boolean
  label: string
  optional?: boolean
}) {
  return (
    <li
      className={clsx(
        'inline-flex items-center gap-1.5 text-xs',
        ok ? 'text-fg' : optional ? 'text-fg-muted' : 'text-amber-600 dark:text-amber-400',
      )}
    >
      {ok ? (
        <Check size={13} aria-hidden className="text-green-600 dark:text-green-400" />
      ) : (
        <X size={13} aria-hidden />
      )}
      {label}
    </li>
  )
}

/**
 * One readiness item on a source row — the word preceded by a green check,
 * a red X, or a spinner while the download/transcription is in flight.
 */
function SourceCheck({
  state,
  label,
  title,
}: {
  state: 'ok' | 'missing' | 'busy'
  label: string
  title?: string
}) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-fg-muted"
    >
      {state === 'ok' ? (
        <Check
          size={13}
          aria-hidden
          className="text-green-600 dark:text-green-400"
        />
      ) : state === 'busy' ? (
        <Loader2
          size={13}
          aria-hidden
          className="animate-spin text-accent"
        />
      ) : (
        <X size={13} aria-hidden className="text-red-600 dark:text-red-400" />
      )}
      {label}
    </span>
  )
}

/**
 * Reduce one Claude Code stream-json line to the human-readable bits: the
 * assistant's text, tool invocations, and the final result.
 */
function digestStreamJSON(line: string): string[] {
  try {
    const j = JSON.parse(line)
    if (j.type === 'assistant') {
      const parts: string[] = []
      for (const c of j.message?.content ?? []) {
        if (c.type === 'text' && c.text?.trim()) {
          parts.push(c.text.trim())
        } else if (c.type === 'tool_use') {
          const input = c.input ?? {}
          const detail =
            input.description || input.command || input.file_path || ''
          parts.push(
            `▸ ${c.name}${detail ? `: ${String(detail).slice(0, 140)}` : ''}`,
          )
        }
      }
      return parts
    }
    if (j.type === 'result') {
      return [
        j.subtype === 'success'
          ? '✓ Session finished.'
          : `✗ Session ended: ${j.subtype || 'unknown'}`,
      ]
    }
    return []
  } catch {
    return []
  }
}

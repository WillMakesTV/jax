import {
  Check,
  ChevronDown,
  Download,
  GitBranch,
  GraduationCap,
  History,
  Loader2,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Timer,
  Wand2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  ApplyChangesToSkill,
  GetEditRuns,
  GetEditScript,
  GetEditVersions,
  GetEditWorkspace,
  GetEditorTools,
  GetPlanChanges,
  InstallEditorTools,
  RestoreEditVersion,
  SaveEditScript,
  StopEditRun,
  SummarizePlanChanges,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'
import {Markdown} from '../components/markdown/Markdown'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {useEditSession} from '../editor/EditSessionProvider'
import {formatBytes, formatDate, formatDurationMs} from '../lib/format'
import {useServices} from '../services/ServicesProvider'
import {VideoPlanTimeline} from './VideoPlanTimeline'

/** Wails rejects bound-method promises with the Go error string. */
const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

/**
 * The Editor tab of a video plan: produces the actual video from the plan's
 * downloaded source footage, in the order the work actually happens.
 *
 * "Generate with AI" reviews every source's transcript and outline and writes
 * the video's script — sized to the plan's format (30–60s short, 8–15min long)
 * — which saves itself against the plan. "Process video in background" then
 * runs the edit session: the vendored video-use library driven by a headless
 * Claude Code session in a per-plan workspace, its progress mirrored in the
 * status bar so the producer can leave the page.
 *
 * When the video comes back it plays right here, with two ways forward:
 * request edits (a text box whose feedback goes back to the AI for another
 * cut) or edit the timeline by hand (the panel below the player). Every
 * previous cut stays playable and restorable.
 */
export function VideoPlanEditor({
  plan,
  onPlay,
  onPublish,
}: {
  plan: main.VideoPlan
  /** Play a past cut in the page's video modal. */
  onPlay: (title: string, url: string) => void
  /** Jump to the Publish tab (the timeline's Publish action). */
  onPublish: () => void
}) {
  const {statuses} = useServices()
  const aiConnected =
    Boolean(statuses.anthropic?.connected) ||
    Boolean(statuses.openai?.connected)

  const [tools, setTools] = useState<main.EditorTools | null>(null)
  const [installing, setInstalling] = useState(false)
  // Progress lines from the library install (the backend's editor:setup
  // events), shown inside the setup card while it works.
  const [setupLog, setSetupLog] = useState<string[]>([])
  const [ws, setWs] = useState<main.EditWorkspaceInfo | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // The script: AI-written from the sources, saved against the plan, and
  // hand-editable. It is what the session executes.
  const [script, setScript] = useState('')
  const [scriptLoaded, setScriptLoaded] = useState(false)
  // Bumped per AI draft: remounts the markdown field so a fresh draft opens in
  // rendered view (its edit/view mode is internal, set at mount).
  const [draftRound, setDraftRound] = useState(0)
  // The script shows abridged; it expands to full height on demand.
  const [scriptOpen, setScriptOpen] = useState(false)

  // The "Request edits" box under the rendered video.
  const [requesting, setRequesting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [starting, setStarting] = useState(false)

  // Both long-running AI jobs — writing the script and cutting the video —
  // live in the app-wide provider (which also drives their status-bar chips),
  // so they survive leaving and returning to this tab.
  const {
    session,
    start: startSession,
    cancel: cancelSession,
    scriptJob,
    scriptResult,
    generateScript,
  } = useEditSession()
  const activeSession = session && session.planId === plan.id ? session : null
  const running = activeSession?.running ?? ws?.running ?? false
  // Another plan's session blocks starting one here (one edit at a time).
  const busyElsewhere = Boolean(session?.running && session.planId !== plan.id)
  const log = activeSession?.log ?? []

  const generating = Boolean(scriptJob?.running && scriptJob.planId === plan.id)
  const scriptBusyElsewhere = Boolean(
    scriptJob?.running && scriptJob.planId !== plan.id,
  )

  // Past cuts (every session files the renders it replaces).
  const [versions, setVersions] = useState<main.EditVersion[]>([])
  const [restoring, setRestoring] = useState('')
  // Every processing session's start/end clock (see edit_runs.go), so each
  // revision's render time is on the record.
  const [runs, setRuns] = useState<main.EditRun[]>([])

  // Every edit asked for on this video, and the rolling summary of them — the
  // thing that can be taught back to the skill (see edits.go).
  const [changes, setChanges] = useState<main.PlanChanges | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [teaching, setTeaching] = useState(false)
  const [taught, setTaught] = useState('')
  const formatLabel = plan.format === 'short' ? 'short-form' : 'long-form'

  const refreshChanges = useCallback(() => {
    GetPlanChanges(plan.id)
      .then(setChanges)
      .catch(() => {})
  }, [plan.id])

  const refreshWorkspace = useCallback(() => {
    GetEditWorkspace(plan.id)
      .then(setWs)
      .catch(() => {})
    GetEditVersions(plan.id)
      .then((v) => setVersions(v ?? []))
      .catch(() => {})
    GetEditRuns(plan.id)
      .then((r) => setRuns(r ?? []))
      .catch(() => {})
  }, [plan.id])

  useEffect(() => {
    GetEditorTools()
      .then(setTools)
      .catch(() => {})
    refreshWorkspace()
    refreshChanges()
  }, [refreshWorkspace, refreshChanges])

  // A finished edit pass is a new correction on the record.
  const prevRunningChanges = useRef(running)
  useEffect(() => {
    if (prevRunningChanges.current && !running) refreshChanges()
    prevRunningChanges.current = running
  }, [running, refreshChanges])

  // The saved script (written by the last Generate with AI, or by hand).
  useEffect(() => {
    setScriptLoaded(false)
    GetEditScript(plan.id)
      .then((s) => setScript(s ?? ''))
      .catch(() => {})
      .finally(() => setScriptLoaded(true))
  }, [plan.id])

  // Persist hand edits to the script (debounced) once the stored one is in.
  useEffect(() => {
    if (!scriptLoaded) return
    const id = window.setTimeout(() => {
      void SaveEditScript(plan.id, script).catch(() => {})
    }, 800)
    return () => window.clearTimeout(id)
  }, [plan.id, script, scriptLoaded])

  // A finished generation lands here — whether this tab was open the whole
  // time or the producer walked away and came back. Rounds are tracked so the
  // result is applied exactly once: re-applying an old one would silently
  // overwrite hand edits made after it.
  const appliedRound = useRef(scriptResult?.round ?? 0)
  useEffect(() => {
    if (!scriptResult || scriptResult.planId !== plan.id) return
    if (scriptResult.round === appliedRound.current) return
    appliedRound.current = scriptResult.round
    setScript(scriptResult.script)
    setDraftRound((n) => n + 1)
    setNote('Script saved. Process the video when it reads right.')
  }, [scriptResult, plan.id])

  // Setup progress (library install). The edit run's own progress arrives
  // through the session provider.
  useEffect(() => {
    const offSetup = EventsOn('editor:setup', (line: string) =>
      setSetupLog((prev) => [...prev, line].slice(-150)),
    )
    // A download or transcription landing elsewhere in the app changes what
    // the editor has to work with, so recheck the workspace: the readiness
    // note clears itself and the Generate/Process buttons unlock.
    const offVodExit = EventsOn('vodtranscribe:exit', () => refreshWorkspace())
    const offDlExit = EventsOn('download:exit', (detail: string) => {
      if (!detail) refreshWorkspace()
    })
    return () => {
      offSetup()
      offVodExit()
      offDlExit()
    }
  }, [refreshWorkspace])

  // Re-render periodically while a session runs so the time-since-activity
  // hint stays fresh (long renders emit nothing for minutes).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000)
    return () => window.clearInterval(id)
  }, [running])
  const quietMin = activeSession?.lastAt
    ? Math.floor((Date.now() - activeSession.lastAt) / 60_000)
    : 0

  // When this plan's session stops (finished, failed, or cancelled), recheck
  // the workspace so the freshly rendered video appears.
  const prevRunning = useRef(running)
  useEffect(() => {
    if (prevRunning.current && !running) refreshWorkspace()
    prevRunning.current = running
  }, [running, refreshWorkspace])

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
    setError('')
    InstallEditorTools()
      .then((t) => {
        // Recheck the whole page: dependency card (which hides itself once
        // everything is ready) and the workspace's source/output state.
        setTools(t)
        refreshWorkspace()
      })
      .catch((err) => {
        const msg = messageOf(err, 'The editor library could not be installed.')
        setError(msg)
        setSetupLog((prev) => [...prev, `✗ ${msg}`])
        // The install may have partially succeeded (e.g. clone ok, pip
        // failed) — recheck what is there now.
        GetEditorTools()
          .then(setTools)
          .catch(() => {})
      })
      .finally(() => setInstalling(false))
  }

  // Write (or rewrite) the script from the sources' transcripts and outlines.
  // The provider owns the job — it keeps running (and saves itself) if the
  // producer navigates away, and the status bar follows it.
  const generate = () => {
    setError('')
    setNote('')
    generateScript(plan.id, plan.title, script).catch((err) =>
      setError(messageOf(err, 'The script could not be generated.')),
    )
  }

  // Run the edit session in the background. Instruction is empty for the first
  // cut (the session executes the saved script) and carries the requested
  // changes for a revision.
  const process = (instruction: string) => {
    setStarting(true)
    setError('')
    setNote('')
    // The session reads the script from storage, so flush hand edits the
    // debounced autosave hasn't written yet — otherwise a tweak made seconds
    // before pressing this would be cut from the video.
    SaveEditScript(plan.id, script)
      .catch(() => {})
      .then(() => startSession(plan.id, plan.title, instruction))
      .then(() => {
        setRequesting(false)
        setFeedback('')
      })
      .catch((err) =>
        setError(messageOf(err, 'The edit session could not be started.')),
      )
      .finally(() => setStarting(false))
  }

  const cancel = () => {
    cancelSession()
    refreshWorkspace()
  }

  // Rewrite the rolling Changes summary from every edit asked for so far.
  const summarize = () => {
    setSummarizing(true)
    setError('')
    setTaught('')
    SummarizePlanChanges(plan.id)
      .then(setChanges)
      .catch((err) =>
        setError(messageOf(err, 'The changes could not be summarized.')),
      )
      .finally(() => setSummarizing(false))
  }

  // Fold the summary into the format's editing-preference skill, so the next
  // video of this kind starts closer to right.
  const teachSkill = () => {
    setTeaching(true)
    setError('')
    setTaught('')
    ApplyChangesToSkill(plan.id)
      .then((skill) => {
        setTaught(
          `“${skill.title}” updated — the next ${formatLabel} video is cut with these preferences built in. Review or undo it in Settings → Skills.`,
        )
        refreshChanges()
      })
      .catch((err) =>
        setError(messageOf(err, 'The skill could not be updated.')),
      )
      .finally(() => setTeaching(false))
  }

  // Make a past cut the current video again (the cut it replaces is archived
  // first, so flipping back and forth loses nothing).
  const restore = (name: string) => {
    setRestoring(name)
    setError('')
    RestoreEditVersion(plan.id, name)
      .then((w) => {
        setWs(w)
        setNote(`Restored ${name} as the current video.`)
        return GetEditVersions(plan.id)
      })
      .then((v) => setVersions(v ?? []))
      .catch((err) =>
        setError(messageOf(err, 'That version could not be restored.')),
      )
      .finally(() => setRestoring(''))
  }

  const sources = ws?.sources ?? []
  const outputs = ws?.outputs ?? []
  const readySources = sources.filter((s) => s.file || s.downloaded)
  // Imported footage (no startedAt) never has a broadcast to download or
  // transcribe, so it can't count as a not-ready source stream.
  const notReady = sources.filter(
    (s) => s.startedAt && (!s.downloaded || !s.hasTranscript),
  )
  // The video the producer reviews: the session's final cut, else whatever it
  // rendered.
  const current =
    outputs.find((o) => o.name === 'final.mp4') ?? outputs[0] ?? null
  const hasScript = script.trim() !== ''
  const canProcess =
    Boolean(tools?.ready) && readySources.length > 0 && !busyElsewhere

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Dependency / library status — the tab can't do anything until this
          is satisfied, so it leads. */}
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
              {installing && <p className="animate-pulse text-fg">Working…</p>}
            </div>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------
          The script: written by AI from the sources, saved automatically,
          then handed to the background session.
          --------------------------------------------------------------- */}
      <section aria-labelledby="editor-script-heading">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2
            id="editor-script-heading"
            className="text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            Script
          </h2>
          <button
            type="button"
            onClick={generate}
            disabled={
              generating ||
              running ||
              scriptBusyElsewhere ||
              !aiConnected ||
              readySources.length === 0
            }
            title={
              !aiConnected
                ? 'Connect Anthropic or OpenAI in Settings → AI to write the script'
                : readySources.length === 0
                  ? 'No source stream has a downloaded video yet'
                  : scriptBusyElsewhere
                    ? `A script is already being written — ${scriptJob?.title || 'another plan'}`
                    : `Review every source's transcript and outline and write the ${
                        plan.format === 'short' ? '30–60 second' : '8–15 minute'
                      } script for this video. It keeps running — and saves itself — if you navigate away. The style guide is Settings → Skills → Video edit script.`
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={14} aria-hidden className="animate-spin" />
            ) : (
              <Sparkles size={14} aria-hidden />
            )}
            {generating
              ? 'Generating…'
              : hasScript
                ? 'Regenerate with AI'
                : 'Generate with AI'}
          </button>
        </div>

        {hasScript || generating ? (
          <>
            {/* The script is long — a full 8–15 minute brief pushes the video
                itself off the screen. It sits abridged, fading out at the fold,
                and expands to its full height on demand. */}
            <div
              className={clsx(
                'relative overflow-hidden transition-[max-height] duration-500 ease-in-out',
                scriptOpen ? 'max-h-[2000px]' : 'max-h-56',
                generating && 'pointer-events-none opacity-60',
              )}
              aria-busy={generating}
            >
              <MarkdownField
                key={draftRound}
                id="editor-script"
                value={script}
                onChange={setScript}
                placeholder="The script the edit session executes."
              />
              {/* The fade tells you there is more without stealing the clicks
                  of the editor underneath it. */}
              {!scriptOpen && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg to-transparent"
                />
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs text-fg-muted">
                {generating
                  ? 'Reviewing the source streams’ outlines and transcripts — this can take a minute. You can leave this page; it saves itself, and the status bar follows it.'
                  : 'Saved automatically. Edit freely — this exact text is what the edit session executes.'}
              </p>
              <button
                type="button"
                onClick={() => setScriptOpen((open) => !open)}
                aria-expanded={scriptOpen}
                aria-controls="editor-script"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent transition-colors hover:underline"
              >
                <ChevronDown
                  size={13}
                  aria-hidden
                  className={clsx(
                    'transition-transform duration-300',
                    scriptOpen && 'rotate-180',
                  )}
                />
                {scriptOpen ? 'Show less' : 'Show the full script'}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            Generate the script and the AI reviews every source stream&apos;s
            transcript and outline, then writes the{' '}
            {plan.format === 'short'
              ? 'short-form script (30–60 seconds)'
              : 'long-form script (8–15 minutes)'}{' '}
            for this video. It saves itself, and you can edit it before
            processing.
          </p>
        )}
      </section>

      {/* The primary action: run the edit in the background. */}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Square size={14} aria-hidden />
            Stop processing
          </button>
        ) : (
          <button
            type="button"
            onClick={() => process('')}
            disabled={starting || !hasScript || !canProcess}
            title={
              !tools?.ready
                ? 'Finish the editor setup above first'
                : readySources.length === 0
                  ? 'No source stream has a downloaded video yet'
                  : busyElsewhere
                    ? `An edit session is already running — ${session?.title || 'another plan'}`
                    : !hasScript
                      ? 'Generate the script first'
                      : current
                        ? 'Re-cut the video from the current script, in the background'
                        : 'Cut the video from the script, in the background. It keeps running while you work elsewhere.'
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <Loader2 size={14} aria-hidden className="animate-spin" />
            ) : (
              <Wand2 size={14} aria-hidden />
            )}
            {starting
              ? 'Starting…'
              : current
                ? 'Reprocess video'
                : 'Process video'}
          </button>
        )}
        {running && (
          <span
            className={clsx(
              'text-xs',
              quietMin >= 12
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-fg-muted',
            )}
          >
            {quietMin < 2
              ? 'Processing — you can leave this page; the status bar follows it.'
              : `Processing… no output for ${quietMin}m — renders can be quiet for a while.`}
            {quietMin >= 12 &&
              ' If it stays silent much longer, stopping is safe: the render is killed with the session and every previous cut stays archived.'}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {note && !error && (
        <p className="text-sm text-green-600 dark:text-green-400">{note}</p>
      )}

      {/* ---------------------------------------------------------------
          The video, and the two ways forward from it. It stands open beneath
          the script the moment a cut is saved — the player and the timeline
          are the same panel (one video, scrubbed by the playhead the cutting
          tools work against), and Request edits sends the cut back to the AI
          for another pass. Before the first render it plays the downloaded
          source footage instead, so a fresh plan (long form especially, where
          cutting the broadcast by hand is normal) is never left without a
          player. */}
      {(current || readySources.length > 0) && !running && (
        <section
          aria-labelledby="editor-video-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="editor-video-heading"
              className="text-sm font-semibold uppercase tracking-wide text-fg-muted"
            >
              The video
            </h2>
            {current ? (
              <p className="text-xs text-fg-muted">
                {current.name} · {formatBytes(current.sizeBytes)} · rendered{' '}
                {formatDate(current.modifiedAt)}
              </p>
            ) : (
              <p className="text-xs text-fg-muted">
                No cut rendered yet — playing the source footage.
              </p>
            )}
          </div>

          {/* Player on top, timeline beneath: split, delete, reorder, and
              expand segments into their source footage, then reprocess.
              Publish leads to the Publish tab. */}
          <VideoPlanTimeline
            plan={plan}
            onReprocessed={() => {
              refreshWorkspace()
              // Reprocessing records the manual pass and re-summarizes the
              // record; the summary lands a moment later, so read it back
              // once the backend has had time to write it.
              refreshChanges()
              window.setTimeout(refreshChanges, 6_000)
            }}
            onPublish={onPublish}
          />

          {/* Or hand it back to the AI: the feedback is the brief for another
              cut of the video. Only meaningful once a cut exists. */}
          {current && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRequesting((open) => !open)}
                disabled={!canProcess}
                title="Describe what should change and the AI makes another cut for review"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MessageSquarePlus size={14} aria-hidden />
                Request edits
              </button>
              <span className="text-xs text-fg-muted">
                Rather have the AI redo it than cut it yourself? Describe the
                changes and it makes another pass.
              </span>
            </div>
          )}

          {current && requesting && (
            <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
              <label
                htmlFor="editor-feedback"
                className="text-sm font-medium text-fg"
              >
                What should change about this cut?
              </label>
              <textarea
                id="editor-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                autoFocus
                placeholder='e.g. Tighten the intro to 10 seconds; cut the tangent about the keyboard; change the title card to "Season Finale"; add captions to the second half.'
                className="w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => process(feedback)}
                  disabled={starting || !feedback.trim()}
                  title={
                    feedback.trim()
                      ? 'Run another cut in the background with these changes'
                      : 'Describe the changes first'
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {starting ? (
                    <Loader2 size={14} aria-hidden className="animate-spin" />
                  ) : (
                    <Send size={14} aria-hidden />
                  )}
                  {starting ? 'Starting…' : 'Send to the editor'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRequesting(false)
                    setFeedback('')
                  }}
                  disabled={starting}
                  className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-fg-muted">
                The current cut stays available — every pass archives the video
                it replaces.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------
          Everything asked for on this video, and the chance to stop asking:
          the corrections fold back into the format's skill, so the next video
          is cut this way from the start.
          --------------------------------------------------------------- */}
      {(changes?.requests ?? []).length > 0 && !running && (
        <section
          aria-labelledby="editor-changes-heading"
          className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="editor-changes-heading"
              className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
            >
              <GitBranch size={13} aria-hidden />
              Changes ({changes?.requests.length})
            </h2>
            <button
              type="button"
              onClick={summarize}
              disabled={!aiConnected || summarizing || teaching}
              title="Rewrite the summary from every edit you've asked for on this video"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {summarizing ? (
                <Loader2 size={12} aria-hidden className="animate-spin" />
              ) : (
                <Sparkles size={12} aria-hidden />
              )}
              {summarizing
                ? 'Summarizing…'
                : changes?.summary
                  ? 'Resummarize'
                  : 'Summarize the changes'}
            </button>
          </div>

          {changes?.summary ? (
            <div className="rounded-lg border border-edge bg-bg p-3 text-sm">
              <Markdown>{changes.summary}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">
              Every edit you ask for is kept — typed here, or read from a
              timeline pass you made by hand. Summarize them into the standing
              difference between what the editor produced and what you actually
              wanted.
            </p>
          )}

          {/* The individual rounds, for checking the summary against. */}
          <details className="text-xs">
            <summary className="cursor-pointer text-fg-muted hover:text-fg">
              Every edit asked for, in order
            </summary>
            <ol className="mt-2 flex flex-col gap-2">
              {(changes?.requests ?? []).map((r, i) => (
                <li
                  key={`${r.at}-${i}`}
                  className="rounded-lg border border-edge bg-bg p-2.5"
                >
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                    {r.kind === 'timeline' ? 'Timeline pass' : 'You asked for'}{' '}
                    · {formatDate(r.at)}
                  </p>
                  <p className="whitespace-pre-wrap text-fg">{r.text}</p>
                </li>
              ))}
            </ol>
          </details>

          {/* The point of the whole record. */}
          {changes?.summary && (
            <div className="flex flex-col gap-2 border-t border-edge pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={teachSkill}
                  disabled={!aiConnected || teaching || summarizing}
                  title={`Fold these corrections into the ${formatLabel} editing skill, so the next ${formatLabel} video is cut this way from the start. The skill stays editable in Settings → Skills.`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {teaching ? (
                    <Loader2 size={14} aria-hidden className="animate-spin" />
                  ) : (
                    <GraduationCap size={14} aria-hidden />
                  )}
                  {teaching
                    ? 'Updating the skill…'
                    : `Update the ${formatLabel} video skill with these changes`}
                </button>
                {changes.appliedAt && (
                  <span className="text-xs text-fg-muted">
                    Last taught {formatDate(changes.appliedAt)}
                  </span>
                )}
              </div>
              <p className="text-xs text-fg-muted">
                The corrections stop being this video&apos;s problem and become
                how the editor works. Nothing is lost — the skill is saved as an
                override you can review, edit, or reset in Settings → Skills.
              </p>
            </div>
          )}

          {taught && (
            <p className="text-sm text-green-600 dark:text-green-400">
              {taught}
            </p>
          )}
        </section>
      )}

      {/* The running/last session's status and progress. */}
      {log.length > 0 && (
        <section aria-labelledby="editor-run-heading">
          <h2
            id="editor-run-heading"
            className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            Edit session
          </h2>
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
        </section>
      )}

      {/* Past cuts: play one to compare, restore to bring it back as the
          current video. */}
      {versions.length > 0 && (
        <section aria-labelledby="editor-versions-heading">
          <h2
            id="editor-versions-heading"
            className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            <History size={13} aria-hidden />
            Past videos ({versions.length})
          </h2>
          <p className="mb-2 text-xs text-fg-muted">
            Every pass — AI or timeline — files the cut it replaces in its own
            folder, with the segment map that says where the cut came from. Play
            one to review it again; restore makes it the current video (the cut
            it replaces is archived too, so nothing is lost).
          </p>
          <ul className="flex flex-col gap-2">
            {versions.map((v) => {
              const label = `Revision — ${formatDate(v.modifiedAt)}`
              return (
                <li
                  key={v.name}
                  className="flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2 opacity-90"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onPlay(`${plan.title} — ${label}`, v.mediaUrl)
                    }
                    aria-label={`Play ${label}`}
                    title="Play this past cut"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-fg transition-colors hover:bg-accent hover:text-accent-fg"
                  >
                    <Play size={14} aria-hidden className="ml-0.5" />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {label}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {formatBytes(v.sizeBytes)}
                      {v.hasCuts
                        ? ' · timeline restores with it'
                        : v.legacy
                          ? ' · archived before segment maps'
                          : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => restore(v.name)}
                    disabled={running || restoring !== ''}
                    title={
                      running
                        ? 'Wait for the edit session to finish before restoring a cut'
                        : 'Make this the current video again'
                    }
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                  >
                    {restoring === v.name ? (
                      <Loader2 size={12} aria-hidden className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} aria-hidden />
                    )}
                    Restore
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Every processing session's clock: when it started and how long the
          revision took to render. Newest first; failures say so. */}
      {runs.length > 0 && (
        <section aria-labelledby="editor-runs-heading">
          <h2
            id="editor-runs-heading"
            className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            <Timer size={13} aria-hidden />
            Processing times ({runs.length})
          </h2>
          <ul className="flex flex-col gap-1">
            {[...runs].reverse().map((r) => (
              <li
                key={r.startedAt}
                className="flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-fg">
                  {formatDate(r.startedAt)}
                </span>
                {r.endedAt === '' ? (
                  <>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-fg-muted">
                      <Loader2 size={12} aria-hidden className="animate-spin" />
                      running…
                    </span>
                    {/* Kill a stuck run: the live session's process tree, or
                        just closing out a row orphaned by an app restart. */}
                    <button
                      type="button"
                      onClick={() => {
                        void StopEditRun(plan.id).finally(() =>
                          refreshWorkspace(),
                        )
                      }}
                      title="Stop this run — kills the session's processes if it is still alive, or clears a row left behind by a crash/restart"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-edge px-2 py-1 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-hover hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Square size={10} aria-hidden fill="currentColor" />
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    <span className="shrink-0 font-medium text-fg">
                      {formatDurationMs(r.durationSecs * 1000)}
                    </span>
                    {r.error ? (
                      <span
                        title={r.error}
                        className="shrink-0 text-red-600 dark:text-red-400"
                      >
                        failed
                      </span>
                    ) : (
                      <Check
                        size={13}
                        aria-hidden
                        className="shrink-0 text-green-600 dark:text-green-400"
                      />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The tab depends on the plan's footage being on disk; the Content tab
          is where that work lives, so this only speaks up when something is
          actually missing. */}
      {notReady.length > 0 && (
        <p className="border-t border-edge pt-5 text-sm text-fg-muted">
          {notReady.length} of this plan&apos;s {sources.length} source stream
          {sources.length === 1 ? '' : 's'}{' '}
          {notReady.length === 1 ? 'is' : 'are'} missing footage or a transcript
          — the Content tab has the Download and Transcribe actions. The editor
          works with whatever is ready.
        </p>
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
        ok
          ? 'text-fg'
          : optional
            ? 'text-fg-muted'
            : 'text-amber-600 dark:text-amber-400',
      )}
    >
      {ok ? (
        <Check
          size={13}
          aria-hidden
          className="text-green-600 dark:text-green-400"
        />
      ) : (
        <X size={13} aria-hidden />
      )}
      {label}
    </li>
  )
}

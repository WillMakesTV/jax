import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  CancelEditRun,
  GenerateEditScript,
  SaveEditScript,
  StartEditRun,
} from '../../wailsjs/go/main/App'
import {EventsOn} from '../../wailsjs/runtime/runtime'

/**
 * The (single) video-plan edit session, owned app-wide so its progress — and
 * the status-bar chip pointing back at it — survives navigating away from the
 * plan's Editor tab. The backend runs one edit at a time and reports it via
 * "editor:line" (stream-json progress) and "editor:exit" events; this
 * provider is their only subscriber and keeps the digested log for whoever
 * renders it.
 */
export interface EditSessionState {
  /** The video plan the session is editing. */
  planId: string
  /** Plan title for status copy ('' when unknown). */
  title: string
  running: boolean
  /** Digested, human-readable progress lines (bounded). */
  log: string[]
  /** The most recent progress line, for compact status copy. */
  lastLine: string
  /** When the last progress line arrived (ms epoch) — long renders are
   *  silent, so the UI shows time-since-activity instead of looking hung. */
  lastAt: number
}

/** Short-lived end-of-run message for the status bar. */
export interface EditSessionNotice {
  state: 'done' | 'error'
  detail: string
  planId: string
}

/**
 * A script being written by AI. Like the edit session, it is owned here rather
 * than by the Editor tab: writing a script means reading every source's
 * transcript and outline, which takes a while, and the producer should be able
 * to walk away from the page while it happens.
 */
export interface ScriptJobState {
  planId: string
  /** Plan title for status copy ('' when unknown). */
  title: string
  running: boolean
}

/** Short-lived end-of-job message for the status bar. */
export interface ScriptNotice {
  state: 'done' | 'error'
  detail: string
  planId: string
}

/**
 * The script a finished job produced. The Editor tab picks it up by round, so
 * a producer who navigated away mid-generation still sees the result when they
 * come back — and a stale result never overwrites later hand edits.
 */
export interface ScriptResult {
  planId: string
  script: string
  round: number
}

interface EditSessionContextValue {
  /** The current (or most recently finished) session; null before any run. */
  session: EditSessionState | null
  notice: EditSessionNotice | null
  /**
   * Start an edit session for a plan. Rejects when one is already running
   * (the backend enforces a single session).
   */
  start: (planId: string, title: string, instruction: string) => Promise<void>
  /** Stop the in-progress session, if any. */
  cancel: () => void

  /** The script generation in flight (or the last one); null before any. */
  scriptJob: ScriptJobState | null
  scriptNotice: ScriptNotice | null
  scriptResult: ScriptResult | null
  /**
   * Write the plan's script with AI and save it. Current is the script as the
   * form has it — flushed first, so hand edits the autosave hasn't written yet
   * are folded into the rewrite instead of being ignored. Notes carry the
   * producer's requested edits for a revision pass ('' for a first draft).
   */
  generateScript: (
    planId: string,
    title: string,
    current: string,
    notes?: string,
  ) => Promise<void>
}

const EditSessionContext = createContext<EditSessionContextValue | undefined>(
  undefined,
)

const NOTICE_MS = 10_000
const LOG_LIMIT = 400

export function EditSessionProvider({children}: {children: ReactNode}) {
  const [session, setSession] = useState<EditSessionState | null>(null)
  const [notice, setNotice] = useState<EditSessionNotice | null>(null)
  const noticeTimer = useRef<number>()

  const [scriptJob, setScriptJob] = useState<ScriptJobState | null>(null)
  const [scriptNotice, setScriptNotice] = useState<ScriptNotice | null>(null)
  const [scriptResult, setScriptResult] = useState<ScriptResult | null>(null)
  const scriptNoticeTimer = useRef<number>()
  const scriptRound = useRef(0)

  // The event handlers below are subscribed once; they read the live session
  // through this ref rather than a stale closure.
  const sessionRef = useRef<EditSessionState | null>(null)
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const showNotice = useCallback((n: EditSessionNotice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(n)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  useEffect(() => {
    const offLine = EventsOn('editor:line', (planId: string, line: string) => {
      const parts = digestStreamJSON(line)
      if (parts.length === 0) return
      setSession((prev) => {
        // A line for a session this provider didn't start (shouldn't happen,
        // but e.g. a dev reload) still gets tracked, just without a title.
        const base =
          prev && prev.planId === planId
            ? prev
            : {planId, title: '', running: true, log: [], lastLine: '', lastAt: 0}
        return {
          ...base,
          running: true,
          log: [...base.log, ...parts].slice(-LOG_LIMIT),
          lastLine: parts[parts.length - 1],
          lastAt: Date.now(),
        }
      })
    })
    const offExit = EventsOn('editor:exit', (planId: string, detail: string) => {
      const title =
        sessionRef.current?.planId === planId ? sessionRef.current.title : ''
      const line = detail ? `✗ ${detail}` : '✓ The video is ready.'
      setSession((prev) => {
        if (!prev || prev.planId !== planId) return prev
        return {
          ...prev,
          running: false,
          log: [...prev.log, line].slice(-LOG_LIMIT),
          lastLine: line,
          lastAt: Date.now(),
        }
      })
      showNotice(
        detail
          ? {
              state: 'error',
              detail: `Video generation failed — ${title || 'video plan'}`,
              planId,
            }
          : {
              state: 'done',
              detail: `Video ready — ${title || 'video plan'}`,
              planId,
            },
      )
    })
    return () => {
      offLine()
      offExit()
    }
  }, [showNotice])

  const start = useCallback(
    async (planId: string, title: string, instruction: string) => {
      await StartEditRun(planId, instruction)
      window.clearTimeout(noticeTimer.current)
      setNotice(null)
      setSession({
        planId,
        title,
        running: true,
        log: ['Generating the video…'],
        lastLine: 'Generating the video…',
        lastAt: Date.now(),
      })
    },
    [],
  )

  // Cancelling kills the backend process without an editor:exit event (the
  // backend only reports exits it didn't initiate), so the log line and the
  // running flag are handled here.
  const cancel = useCallback(() => {
    void CancelEditRun()
    setSession((prev) =>
      prev && prev.running
        ? {
            ...prev,
            running: false,
            log: [...prev.log, 'Video generation cancelled.'].slice(-LOG_LIMIT),
            lastLine: 'Video generation cancelled.',
            lastAt: Date.now(),
          }
        : prev,
    )
  }, [])

  // Write the plan's script. The backend saves it as part of the call, so a
  // producer who navigates away — or closes the page — still gets the script;
  // the Editor tab reads it back from the result (or from storage on mount).
  const generateScript = useCallback(
    async (planId: string, title: string, current: string, notes = '') => {
      setScriptJob({planId, title, running: true})
      window.clearTimeout(scriptNoticeTimer.current)
      setScriptNotice(null)
      const finish = (n: ScriptNotice) => {
        window.clearTimeout(scriptNoticeTimer.current)
        setScriptNotice(n)
        scriptNoticeTimer.current = window.setTimeout(
          () => setScriptNotice(null),
          NOTICE_MS,
        )
      }
      try {
        // The rewrite folds in the script as it stands, which the backend reads
        // from storage — so flush the form's copy first.
        await SaveEditScript(planId, current).catch(() => {})
        const text = await GenerateEditScript(planId, notes)
        scriptRound.current += 1
        setScriptResult({planId, script: text, round: scriptRound.current})
        setScriptJob({planId, title, running: false})
        finish({
          state: 'done',
          detail: `Script ready — ${title || 'video plan'}`,
          planId,
        })
      } catch (err) {
        setScriptJob(null)
        const detail = err instanceof Error ? err.message : String(err)
        finish({
          state: 'error',
          detail: detail || `The script could not be written — ${title || 'video plan'}`,
          planId,
        })
        throw err
      }
    },
    [],
  )

  const value = useMemo<EditSessionContextValue>(
    () => ({
      session,
      notice,
      start,
      cancel,
      scriptJob,
      scriptNotice,
      scriptResult,
      generateScript,
    }),
    [
      session,
      notice,
      start,
      cancel,
      scriptJob,
      scriptNotice,
      scriptResult,
      generateScript,
    ],
  )

  return (
    <EditSessionContext.Provider value={value}>
      {children}
    </EditSessionContext.Provider>
  )
}

export function useEditSession(): EditSessionContextValue {
  const context = useContext(EditSessionContext)
  if (!context) {
    throw new Error('useEditSession must be used within an EditSessionProvider')
  }
  return context
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

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** What the AI is producing for the plan. */
export type PlanAiKind = 'thumbnail' | 'listing'

/** One AI generation in flight for a video plan. */
export interface PlanAiJob {
  planId: string
  kind: PlanAiKind
  /** Plan title for status-bar copy. */
  title: string
}

/** End-of-run message shown after a run finishes. */
export interface PlanAiNotice {
  state: 'done' | 'error'
  detail: string
  planId: string
}

interface PlanAiContextValue {
  jobs: PlanAiJob[]
  notice: PlanAiNotice | null
  /**
   * Run one AI generation for a plan. Owned here (not by the page) so the
   * run — and its status-bar chip — survives navigating away; the work
   * function must persist its own result for the same reason. Rejects when
   * a run of the same kind for the plan is already in flight.
   */
  run: <T>(
    kind: PlanAiKind,
    planId: string,
    title: string,
    work: () => Promise<T>,
  ) => Promise<T>
}

const PlanAiContext = createContext<PlanAiContextValue | undefined>(undefined)

const KIND_LABEL: Record<PlanAiKind, {doing: string; done: string}> = {
  thumbnail: {doing: 'thumbnail', done: 'Thumbnail ready'},
  listing: {doing: 'listing', done: 'Listing drafted'},
}

/**
 * How long the done/error notice lingers: generation often finishes while
 * the producer is elsewhere, so the green chip stays around long enough to
 * be seen and clicked (like the post-stream wrap-up chip).
 */
const NOTICE_MS = 600_000

export function PlanAiProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<PlanAiJob[]>([])
  const [notice, setNotice] = useState<PlanAiNotice | null>(null)
  const noticeTimer = useRef<number>()

  const showNotice = useCallback((n: PlanAiNotice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(n)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  const run = useCallback(
    async <T,>(
      kind: PlanAiKind,
      planId: string,
      title: string,
      work: () => Promise<T>,
    ): Promise<T> => {
      let added = false
      setJobs((prev) => {
        if (prev.some((j) => j.planId === planId && j.kind === kind)) {
          return prev
        }
        added = true
        return [...prev, {planId, kind, title}]
      })
      if (!added) {
        throw new Error(
          `a ${KIND_LABEL[kind].doing} is already being generated for this video`,
        )
      }
      // A fresh run supersedes the previous run's lingering notice.
      window.clearTimeout(noticeTimer.current)
      setNotice(null)
      try {
        const result = await work()
        showNotice({
          state: 'done',
          detail: `${KIND_LABEL[kind].done} — ${title || 'video plan'}`,
          planId,
        })
        return result
      } catch (err) {
        const message =
          err instanceof Error ? err.message : typeof err === 'string' ? err : ''
        showNotice({
          state: 'error',
          detail: message
            ? `The ${KIND_LABEL[kind].doing} failed — ${message}`
            : `The ${KIND_LABEL[kind].doing} failed — ${title || 'video plan'}`,
          planId,
        })
        throw err
      } finally {
        setJobs((prev) =>
          prev.filter((j) => !(j.planId === planId && j.kind === kind)),
        )
      }
    },
    [showNotice],
  )

  const value = useMemo<PlanAiContextValue>(
    () => ({jobs, notice, run}),
    [jobs, notice, run],
  )

  return <PlanAiContext.Provider value={value}>{children}</PlanAiContext.Provider>
}

export function usePlanAi(): PlanAiContextValue {
  const context = useContext(PlanAiContext)
  if (!context) {
    throw new Error('usePlanAi must be used within a PlanAiProvider')
  }
  return context
}

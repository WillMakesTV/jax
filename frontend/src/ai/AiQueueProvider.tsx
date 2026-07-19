import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * What kind of content an AI job produces. The kind drives the status-bar
 * copy and, in App.tsx, which page a click on the job returns to.
 */
export type AiJobKind =
  | 'clip-ideas'
  | 'plan-thumbnail'
  | 'plan-listing'
  | 'project-image'
  | 'sponsor-research'
  | 'widget-image'
  | 'widget-sound'
  | 'widget-template'

/** One AI generation, queued or running. */
export interface AiJob {
  id: number
  kind: AiJobKind
  /** The subject's identity for click-through (startedAt / planId / …). */
  targetId: string
  /** Distinguishes parallel variants on one target (e.g. clip format). */
  dedupe: string
  /** The subject's title, for pages deriving busy-state copy. */
  title: string
  /** Status-bar copy while queued/running. */
  label: string
  state: 'queued' | 'running'
}

/** End-of-run message, lingering until read or timed out. */
export interface AiQueueNotice {
  id: number
  kind: AiJobKind
  targetId: string
  state: 'done' | 'error'
  detail: string
}

interface EnqueueInput<T> {
  kind: AiJobKind
  targetId: string
  /** Distinguishes parallel variants on one target; '' when N/A. */
  dedupe?: string
  title: string
  label: string
  doneDetail: string
  /** Failure copy; the error message is appended when there is one. */
  failDetail: string
  /** Error thrown when the same kind+target+dedupe is already in the queue. */
  busyError: string
  /**
   * The generation itself. It must persist its own result: by the time it
   * runs — let alone finishes — the page that enqueued it may be long gone.
   */
  work: () => Promise<T>
}

interface AiQueueContextValue {
  /** Running job first, then the queue in FIFO order. */
  jobs: AiJob[]
  /** Unread end-of-run notices, oldest first. */
  notices: AiQueueNotice[]
  /**
   * Add a generation to the queue. Jobs run strictly one at a time, in the
   * order they were enqueued; the returned promise settles when this job's
   * turn completes. Rejects immediately when an identical job is already
   * queued or running.
   */
  enqueue: <T>(input: EnqueueInput<T>) => Promise<T>
  /** Clear one notice — clicking it counts as read. */
  dismissNotice: (id: number) => void
}

const AiQueueContext = createContext<AiQueueContextValue | undefined>(undefined)

/**
 * How long a done/error notice lingers: generation often finishes while the
 * producer is elsewhere, so notices stay around long enough to be seen and
 * clicked (like the post-stream wrap-up chip).
 */
const NOTICE_MS = 600_000

/**
 * The app-wide AI generation queue. Every "generate with AI" feature —
 * clip-script ideas, video-plan thumbnails and listings, project cover
 * images, sponsor research — enqueues here, so the work survives navigating
 * away, runs one job at a time, and reports through a single status-bar
 * chip whose popover shows the whole queue.
 */
export function AiQueueProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<AiJob[]>([])
  const [notices, setNotices] = useState<AiQueueNotice[]>([])
  const seq = useRef(0)
  // The runner: each enqueued job chains onto the previous one's completion,
  // which is what makes execution strictly sequential.
  const chain = useRef<Promise<void>>(Promise.resolve())
  const noticeTimers = useRef(new Map<number, number>())

  const pushNotice = useCallback(
    (notice: Omit<AiQueueNotice, 'id'>) => {
      const id = ++seq.current
      setNotices((prev) => [...prev, {...notice, id}])
      noticeTimers.current.set(
        id,
        window.setTimeout(() => {
          noticeTimers.current.delete(id)
          setNotices((prev) => prev.filter((n) => n.id !== id))
        }, NOTICE_MS),
      )
    },
    [],
  )

  const dismissNotice = useCallback((id: number) => {
    const timer = noticeTimers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    noticeTimers.current.delete(id)
    setNotices((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const enqueue = useCallback(
    async <T,>(input: EnqueueInput<T>): Promise<T> => {
      const dedupe = input.dedupe ?? ''
      const id = ++seq.current
      let added = false
      setJobs((prev) => {
        if (
          prev.some(
            (j) =>
              j.kind === input.kind &&
              j.targetId === input.targetId &&
              j.dedupe === dedupe,
          )
        ) {
          return prev
        }
        added = true
        return [
          ...prev,
          {
            id,
            kind: input.kind,
            targetId: input.targetId,
            dedupe,
            title: input.title,
            label: input.label,
            state: 'queued',
          },
        ]
      })
      if (!added) {
        throw new Error(input.busyError)
      }

      return new Promise<T>((resolve, reject) => {
        chain.current = chain.current.then(async () => {
          setJobs((prev) =>
            prev.map((j) => (j.id === id ? {...j, state: 'running'} : j)),
          )
          try {
            const value = await input.work()
            pushNotice({
              kind: input.kind,
              targetId: input.targetId,
              state: 'done',
              detail: input.doneDetail,
            })
            resolve(value)
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : typeof err === 'string'
                  ? err
                  : ''
            pushNotice({
              kind: input.kind,
              targetId: input.targetId,
              state: 'error',
              detail: message
                ? `${input.failDetail} — ${message}`
                : input.failDetail,
            })
            reject(err)
          } finally {
            setJobs((prev) => prev.filter((j) => j.id !== id))
          }
        })
      })
    },
    [pushNotice],
  )

  const value = useMemo<AiQueueContextValue>(
    () => ({jobs, notices, enqueue, dismissNotice}),
    [jobs, notices, enqueue, dismissNotice],
  )

  return (
    <AiQueueContext.Provider value={value}>{children}</AiQueueContext.Provider>
  )
}

export function useAiQueue(): AiQueueContextValue {
  const context = useContext(AiQueueContext)
  if (!context) {
    throw new Error('useAiQueue must be used within an AiQueueProvider')
  }
  return context
}

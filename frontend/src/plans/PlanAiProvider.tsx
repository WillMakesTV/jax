import {createContext, useCallback, useContext, useMemo, type ReactNode} from 'react'
import {useAiQueue} from '../ai/AiQueueProvider'

/** What the AI is producing for the plan. */
export type PlanAiKind = 'thumbnail' | 'listing'

/** One AI generation for a video plan, queued or in flight. */
export interface PlanAiJob {
  planId: string
  kind: PlanAiKind
  /** Plan title for busy-state copy. */
  title: string
}

interface PlanAiContextValue {
  jobs: PlanAiJob[]
  /**
   * Run one AI generation for a plan. The run lives in the app-wide AI
   * queue (see AiQueueProvider), so it survives navigating away and reports
   * through the status bar; the work function must persist its own result
   * for the same reason. Rejects when a run of the same kind for the plan
   * is already queued or in flight.
   */
  run: <T>(
    kind: PlanAiKind,
    planId: string,
    title: string,
    work: () => Promise<T>,
  ) => Promise<T>
}

const PlanAiContext = createContext<PlanAiContextValue | undefined>(undefined)

const KIND_COPY: Record<
  PlanAiKind,
  {doing: string; done: string; failed: string}
> = {
  thumbnail: {
    doing: 'Generating thumbnail',
    done: 'Thumbnail ready',
    failed: 'The thumbnail failed',
  },
  listing: {
    doing: 'Drafting listing',
    done: 'Listing drafted',
    failed: 'The listing failed',
  },
}

export function PlanAiProvider({children}: {children: ReactNode}) {
  const queue = useAiQueue()

  const jobs = useMemo<PlanAiJob[]>(
    () =>
      queue.jobs
        .filter((j) => j.kind === 'plan-thumbnail' || j.kind === 'plan-listing')
        .map((j) => ({
          planId: j.targetId,
          kind: (j.kind === 'plan-thumbnail'
            ? 'thumbnail'
            : 'listing') as PlanAiKind,
          title: j.title,
        })),
    [queue.jobs],
  )

  const run = useCallback(
    <T,>(
      kind: PlanAiKind,
      planId: string,
      title: string,
      work: () => Promise<T>,
    ) => {
      const copy = KIND_COPY[kind]
      return queue.enqueue({
        kind: kind === 'thumbnail' ? 'plan-thumbnail' : 'plan-listing',
        targetId: planId,
        title,
        label: `${copy.doing} — ${title || 'video plan'}`,
        doneDetail: `${copy.done} — ${title || 'video plan'}`,
        failDetail: copy.failed,
        busyError: `a ${kind} is already being generated for this video`,
        work,
      })
    },
    [queue],
  )

  const value = useMemo<PlanAiContextValue>(() => ({jobs, run}), [jobs, run])

  return <PlanAiContext.Provider value={value}>{children}</PlanAiContext.Provider>
}

export function usePlanAi(): PlanAiContextValue {
  const context = useContext(PlanAiContext)
  if (!context) {
    throw new Error('usePlanAi must be used within a PlanAiProvider')
  }
  return context
}

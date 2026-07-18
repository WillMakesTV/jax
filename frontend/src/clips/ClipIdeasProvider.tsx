import {createContext, useCallback, useContext, useMemo, type ReactNode} from 'react'
import {GenerateClipIdeas} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useAiQueue} from '../ai/AiQueueProvider'

/** One clip-script generation, queued or in flight. */
export interface ClipIdeasJob {
  /** The source stream's start time — its identity throughout the app. */
  startedAt: string
  /** "short" | "long" — one run per stream + format. */
  format: string
  /** Stream title for busy-state copy. */
  title: string
}

interface ClipIdeasContextValue {
  jobs: ClipIdeasJob[]
  /**
   * Pitch three clip scripts for a stream + format. The run lives in the
   * app-wide AI queue (see AiQueueProvider), so it survives navigating away
   * and reports through the status bar. Rejects when a run for the stream +
   * format is already queued or in flight.
   */
  generate: (
    startedAt: string,
    title: string,
    format: string,
  ) => Promise<main.ClipIdeaSet>
}

const ClipIdeasContext = createContext<ClipIdeasContextValue | undefined>(
  undefined,
)

export function ClipIdeasProvider({children}: {children: ReactNode}) {
  const queue = useAiQueue()

  const jobs = useMemo<ClipIdeasJob[]>(
    () =>
      queue.jobs
        .filter((j) => j.kind === 'clip-ideas')
        .map((j) => ({startedAt: j.targetId, format: j.dedupe, title: j.title})),
    [queue.jobs],
  )

  const generate = useCallback(
    (startedAt: string, title: string, format: string) =>
      queue.enqueue({
        kind: 'clip-ideas',
        targetId: startedAt,
        dedupe: format,
        title,
        label: `Pitching script ideas — ${title || 'stream'}`,
        doneDetail: `Script ideas ready — ${title || 'stream'}`,
        failDetail: 'Script ideas failed',
        busyError: 'script ideas are already being generated for this stream',
        work: () => GenerateClipIdeas(startedAt, title, format),
      }),
    [queue],
  )

  const value = useMemo<ClipIdeasContextValue>(
    () => ({jobs, generate}),
    [jobs, generate],
  )

  return (
    <ClipIdeasContext.Provider value={value}>
      {children}
    </ClipIdeasContext.Provider>
  )
}

export function useClipIdeas(): ClipIdeasContextValue {
  const context = useContext(ClipIdeasContext)
  if (!context) {
    throw new Error('useClipIdeas must be used within a ClipIdeasProvider')
  }
  return context
}

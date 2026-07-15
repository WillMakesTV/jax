import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {GenerateClipIdeas} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'

/** One clip-script generation in flight. */
export interface ClipIdeasJob {
  /** The source stream's start time — its identity throughout the app. */
  startedAt: string
  /** "short" | "long" — one run per stream + format. */
  format: string
  /** Stream title for status-bar copy. */
  title: string
}

/** End-of-run message shown after a run finishes. */
export interface ClipIdeasNotice {
  state: 'done' | 'error'
  detail: string
  startedAt: string
}

interface ClipIdeasContextValue {
  jobs: ClipIdeasJob[]
  notice: ClipIdeasNotice | null
  /**
   * Pitch three clip scripts for a stream + format. Owned here (not by the
   * Clips tab) so the run — and its status-bar chip — survives navigating
   * away. Rejects when a run for the stream + format is already in flight.
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

/**
 * How long the done/error notice lingers. Generation takes minutes and often
 * finishes while the producer is elsewhere, so the green chip stays around
 * long enough to be seen and clicked (like the post-stream wrap-up chip).
 */
const NOTICE_MS = 600_000

export function ClipIdeasProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<ClipIdeasJob[]>([])
  const [notice, setNotice] = useState<ClipIdeasNotice | null>(null)
  const noticeTimer = useRef<number>()

  const showNotice = useCallback((n: ClipIdeasNotice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(n)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  const generate = useCallback(
    async (startedAt: string, title: string, format: string) => {
      let added = false
      setJobs((prev) => {
        if (
          prev.some((j) => j.startedAt === startedAt && j.format === format)
        ) {
          return prev
        }
        added = true
        return [...prev, {startedAt, format, title}]
      })
      if (!added) {
        throw new Error(
          'script ideas are already being generated for this stream',
        )
      }
      // A fresh run supersedes the previous run's lingering notice.
      window.clearTimeout(noticeTimer.current)
      setNotice(null)
      try {
        const result = await GenerateClipIdeas(startedAt, title, format)
        showNotice({
          state: 'done',
          detail: `Script ideas ready — ${title || 'stream'}`,
          startedAt,
        })
        return result
      } catch (err) {
        const message =
          err instanceof Error ? err.message : typeof err === 'string' ? err : ''
        showNotice({
          state: 'error',
          detail: message
            ? `Script ideas failed — ${message}`
            : `Script ideas failed — ${title || 'stream'}`,
          startedAt,
        })
        throw err
      } finally {
        setJobs((prev) =>
          prev.filter(
            (j) => !(j.startedAt === startedAt && j.format === format),
          ),
        )
      }
    },
    [showNotice],
  )

  const value = useMemo<ClipIdeasContextValue>(
    () => ({jobs, notice, generate}),
    [jobs, notice, generate],
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

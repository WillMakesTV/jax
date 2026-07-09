import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {GenerateStreamOutline} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'

/** One outline generation in flight. */
export interface OutlineJob {
  /** The stream's start time — its identity throughout the app. */
  startedAt: string
  /** Stream title for status-bar copy. */
  title: string
}

/** Short-lived end-of-run message shown after the last job finishes. */
export interface OutlineNotice {
  state: 'done' | 'error'
  detail: string
  startedAt: string
}

interface OutlineContextValue {
  jobs: OutlineJob[]
  notice: OutlineNotice | null
  /**
   * Generate a stream's outline. Owned here (not by the page) so the run —
   * and its status-bar chip — survives navigating away. Rejects when a run
   * for the stream is already in flight.
   */
  generate: (
    startedAt: string,
    durationSecs: number,
    title: string,
  ) => Promise<main.StreamOutline>
}

const OutlineContext = createContext<OutlineContextValue | undefined>(
  undefined,
)

const NOTICE_MS = 10_000

export function OutlineProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<OutlineJob[]>([])
  const [notice, setNotice] = useState<OutlineNotice | null>(null)
  const noticeTimer = useRef<number>()

  const showNotice = useCallback((n: OutlineNotice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(n)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  const generate = useCallback(
    async (startedAt: string, durationSecs: number, title: string) => {
      let added = false
      setJobs((prev) => {
        if (prev.some((j) => j.startedAt === startedAt)) return prev
        added = true
        return [...prev, {startedAt, title}]
      })
      if (!added) {
        throw new Error(
          'an outline is already being generated for this stream',
        )
      }
      try {
        const result = await GenerateStreamOutline(startedAt, durationSecs)
        showNotice({
          state: 'done',
          detail: `Outline ready — ${title}`,
          startedAt,
        })
        return result
      } catch (err) {
        const message =
          err instanceof Error ? err.message : typeof err === 'string' ? err : ''
        showNotice({
          state: 'error',
          detail: message
            ? `Outline failed — ${message}`
            : `Outline failed — ${title}`,
          startedAt,
        })
        throw err
      } finally {
        setJobs((prev) => prev.filter((j) => j.startedAt !== startedAt))
      }
    },
    [showNotice],
  )

  const value = useMemo<OutlineContextValue>(
    () => ({jobs, notice, generate}),
    [jobs, notice, generate],
  )

  return (
    <OutlineContext.Provider value={value}>{children}</OutlineContext.Provider>
  )
}

export function useOutlineJobs(): OutlineContextValue {
  const context = useContext(OutlineContext)
  if (!context) {
    throw new Error('useOutlineJobs must be used within an OutlineProvider')
  }
  return context
}

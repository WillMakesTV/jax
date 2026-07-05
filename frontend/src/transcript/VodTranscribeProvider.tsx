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
  CancelTranscribeDownload,
  GetTranscribeJobs,
  TranscribeDownload,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'

/** One entry in the transcription queue, enriched with live progress. */
export interface VodJob {
  subfolder: string
  state: 'queued' | 'running'
  /** Progress through the video, 0-100, when known. */
  percent: number | null
  detail: string
}

/** Transient end-of-run notice, for the status bar. */
export interface VodNotice {
  state: 'done' | 'error'
  detail: string
}

interface VodTranscribeContextValue {
  /** Queued and running jobs, oldest first. */
  jobs: VodJob[]
  notice: VodNotice | null
  /** Bumped when a run completes successfully — re-query transcripts on change. */
  version: number
  /** Queue a downloaded video for transcription (by its download subfolder). */
  start: (subfolder: string) => Promise<void>
  /** Remove a job from the queue; the stored transcript is left untouched. */
  cancel: (subfolder: string) => void
}

const VodTranscribeContext = createContext<VodTranscribeContextValue>({
  jobs: [],
  notice: null,
  version: 0,
  start: async () => {},
  cancel: () => {},
})

/** How long a finished/failed notice lingers in the status bar. */
const CLEAR_MS = 8_000

const defaultDetail = (state: string) =>
  state === 'queued' ? 'Waiting in the queue…' : 'Transcribing…'

/** Merge a backend queue snapshot with the progress already known locally. */
const mergeJobs = (list: main.TranscribeJob[], prev: VodJob[]): VodJob[] =>
  list.map((j) => {
    const old = prev.find((p) => p.subfolder === j.subfolder)
    return {
      subfolder: j.subfolder,
      state: j.state as VodJob['state'],
      percent: old?.percent ?? null,
      detail:
        old && old.state === j.state ? old.detail : defaultDetail(j.state),
    }
  })

/**
 * App-wide view of the downloaded-video transcription queue. The backend runs
 * up to the configured number of sidecars at once (Settings → Streams) and
 * queues the rest; this provider mirrors that queue from the
 * "vodtranscribe:queue" events, folds per-job progress in from
 * "vodtranscribe:line", and ticks `version` when an exit replaced a stored
 * transcript so open views re-query it.
 */
export function VodTranscribeProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<VodJob[]>([])
  const [notice, setNotice] = useState<VodNotice | null>(null)
  const [version, setVersion] = useState(0)
  const clearTimer = useRef<number | undefined>(undefined)

  const showNotice = useCallback((n: VodNotice) => {
    setNotice(n)
    window.clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(() => setNotice(null), CLEAR_MS)
  }, [])

  useEffect(() => {
    // Jobs may already be queued/running (started before this view mounted,
    // or the page reloaded); restore them.
    GetTranscribeJobs()
      .then((list) => setJobs((prev) => mergeJobs(list ?? [], prev)))
      .catch(() => {})

    const offQueue = EventsOn(
      'vodtranscribe:queue',
      (list: main.TranscribeJob[]) =>
        setJobs((prev) => mergeJobs(list ?? [], prev)),
    )

    const offLine = EventsOn(
      'vodtranscribe:line',
      (subfolder: string, raw: string) => {
        let m: {status?: string; percent?: number; error?: string; text?: string}
        try {
          m = JSON.parse(raw)
        } catch {
          return
        }
        const percent = typeof m.percent === 'number' ? m.percent : null
        setJobs((prev) =>
          prev.map((j) => {
            if (j.subfolder !== subfolder) return j
            if (m.error) {
              // Non-fatal segment errors also arrive here; keep running.
              return {...j, detail: m.error ?? j.detail}
            }
            if (m.status === 'downloading') {
              // One-time speech-model fetch; its percent is the download's,
              // not the video's, so it stays out of job.percent.
              return {
                ...j,
                state: 'running',
                detail:
                  percent !== null && percent >= 0
                    ? `Downloading the speech model — ${percent}%`
                    : 'Downloading the speech model…',
                percent: null,
              }
            }
            if (m.status === 'loading') {
              return {
                ...j,
                state: 'running',
                detail: 'Loading the speech model…',
                percent,
              }
            }
            if (m.status === 'transcribing' || m.text) {
              return {
                ...j,
                state: 'running',
                detail:
                  percent !== null
                    ? `Transcribing — ${percent}%`
                    : 'Transcribing…',
                percent: percent ?? j.percent,
              }
            }
            return j
          }),
        )
      },
    )

    const offExit = EventsOn(
      'vodtranscribe:exit',
      (subfolder: string, detail: string) => {
        setJobs((prev) => prev.filter((j) => j.subfolder !== subfolder))
        showNotice(
          detail
            ? {state: 'error', detail}
            : {state: 'done', detail: 'Transcript updated from the video.'},
        )
        if (!detail) setVersion((v) => v + 1)
      },
    )

    return () => {
      offQueue()
      offLine()
      offExit()
      window.clearTimeout(clearTimer.current)
    }
  }, [showNotice])

  const start = useCallback(
    async (subfolder: string) => {
      // Optimistic queue entry so the button flips immediately; the backend's
      // queue event reconciles the real state (and start position).
      setJobs((prev) =>
        prev.some((j) => j.subfolder === subfolder)
          ? prev
          : [
              ...prev,
              {
                subfolder,
                state: 'queued',
                percent: null,
                detail: defaultDetail('queued'),
              },
            ],
      )
      try {
        await TranscribeDownload(subfolder)
      } catch (err) {
        setJobs((prev) => prev.filter((j) => j.subfolder !== subfolder))
        showNotice({
          state: 'error',
          detail:
            err instanceof Error && err.message
              ? err.message
              : 'Could not queue the video for transcription.',
        })
      }
    },
    [showNotice],
  )

  const cancel = useCallback((subfolder: string) => {
    CancelTranscribeDownload(subfolder).catch(() => {})
    setJobs((prev) => prev.filter((j) => j.subfolder !== subfolder))
  }, [])

  const value = useMemo(
    () => ({jobs, notice, version, start, cancel}),
    [jobs, notice, version, start, cancel],
  )

  return (
    <VodTranscribeContext.Provider value={value}>
      {children}
    </VodTranscribeContext.Provider>
  )
}

export const useVodTranscribe = () => useContext(VodTranscribeContext)

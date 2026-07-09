import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {EventsOn} from '../../wailsjs/runtime/runtime'

export type DownloadState = 'idle' | 'running' | 'done' | 'error'

interface DownloadStatus {
  state: DownloadState
  detail: string
  /** startedAt of the past stream being downloaded ('' when unknown), so the
   *  status-bar chip can route back to that stream. */
  startedAt: string
}

interface DownloadContextValue extends DownloadStatus {
  /** Optimistically mark a download as starting (before the first event),
   *  recording which past stream (by startedAt) it belongs to. */
  markStarting: (startedAt: string) => void
  /** Report a synchronous start failure (StartDownload threw). */
  markError: (detail: string) => void
}

const DownloadContext = createContext<DownloadContextValue>({
  state: 'idle',
  detail: '',
  startedAt: '',
  markStarting: () => {},
  markError: () => {},
})

/** How long a finished/failed status lingers in the status bar before clearing. */
const CLEAR_MS = 8_000

/**
 * App-wide download status. Listens to the sidecar's "download:line" progress
 * and "download:exit" events and exposes the current state so the status bar
 * (and the download button) can reflect it from anywhere.
 */
export function DownloadProvider({children}: {children: ReactNode}) {
  const [status, setStatus] = useState<DownloadStatus>({
    state: 'idle',
    detail: '',
    startedAt: '',
  })
  const clearTimer = useRef<number | undefined>(undefined)

  const scheduleClear = () => {
    window.clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(
      () => setStatus({state: 'idle', detail: '', startedAt: ''}),
      CLEAR_MS,
    )
  }

  useEffect(() => {
    const offLine = EventsOn('download:line', (raw: string) => {
      let m: {
        status?: string
        error?: string
        part?: number
        total?: number
        percent?: number
      }
      try {
        m = JSON.parse(raw)
      } catch {
        return
      }
      window.clearTimeout(clearTimer.current)
      // Progress events keep the startedAt recorded when the download began.
      if (m.error) {
        setStatus((s) => ({...s, state: 'error', detail: m.error ?? ''}))
        scheduleClear()
      } else if (m.status === 'downloading') {
        setStatus((s) => ({
          ...s,
          state: 'running',
          detail:
            (m.total ?? 1) > 1
              ? `Downloading video ${m.part}/${m.total} — ${m.percent ?? 0}%`
              : `Downloading — ${m.percent ?? 0}%`,
        }))
      } else if (m.status === 'stitching') {
        setStatus((s) => ({
          ...s,
          state: 'running',
          detail: 'Stitching videos together…',
        }))
      } else if (m.status === 'start') {
        setStatus((s) => ({...s, state: 'running', detail: 'Starting…'}))
      }
    })
    const offExit = EventsOn('download:exit', (d: string) => {
      setStatus((s) =>
        d
          ? {...s, state: 'error', detail: d}
          : {...s, state: 'done', detail: 'Saved to your download folder.'},
      )
      scheduleClear()
    })
    return () => {
      offLine()
      offExit()
      window.clearTimeout(clearTimer.current)
    }
  }, [])

  const markStarting = (startedAt: string) => {
    window.clearTimeout(clearTimer.current)
    setStatus({state: 'running', detail: 'Starting…', startedAt})
  }

  const markError = (detail: string) => {
    setStatus((s) => ({...s, state: 'error', detail}))
    scheduleClear()
  }

  return (
    <DownloadContext.Provider value={{...status, markStarting, markError}}>
      {children}
    </DownloadContext.Provider>
  )
}

export const useDownloadStatus = () => useContext(DownloadContext)

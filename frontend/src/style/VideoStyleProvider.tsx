import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {VideoStylesInFlight} from '../../wailsjs/go/main/App'
import {EventsOn} from '../../wailsjs/runtime/runtime'

/** One style being written. */
export interface VideoStyleJob {
  id: string
  name: string
  /** building | ready | error */
  status: string
  detail: string
}

interface VideoStyleContextValue {
  /** Styles being built, plus any that just finished or failed. */
  jobs: VideoStyleJob[]
}

const VideoStyleContext = createContext<VideoStyleContextValue>({jobs: []})

/** How long a finished/failed entry lingers in the status bar before clearing. */
const CLEAR_MS = 10_000

/**
 * App-wide video style builds. The build runs in the backend and reports every
 * step as "videostyle:status", so the status bar can carry it from anywhere and
 * leaving the Video Style page never abandons a run — the page reads the same
 * state back off the style itself.
 */
export function VideoStyleProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<VideoStyleJob[]>([])
  const timers = useRef(new Map<string, number>())

  useEffect(() => {
    const off = EventsOn(
      'videostyle:status',
      (id: string, name: string, status: string, detail: string) => {
        if (!id) return
        setJobs((prev) => [
          ...prev.filter((j) => j.id !== id),
          {id, name: name || 'Video style', status, detail},
        ])
        window.clearTimeout(timers.current.get(id))
        if (status === 'ready' || status === 'error') {
          timers.current.set(
            id,
            window.setTimeout(() => {
              timers.current.delete(id)
              setJobs((prev) => prev.filter((j) => j.id !== id))
            }, CLEAR_MS),
          )
        }
      },
    )
    return () => {
      off()
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current.clear()
    }
  }, [])

  // A build started before this listener existed (a run still going from
  // before the window opened) is read back off the styles themselves.
  useEffect(() => {
    VideoStylesInFlight()
      .then((styles) => {
        setJobs((prev) => {
          const seen = new Set(prev.map((j) => j.id))
          const seeded = (styles ?? [])
            .filter((s) => !seen.has(s.id))
            .map((s) => ({
              id: s.id,
              name: s.name || 'Video style',
              status: s.status,
              detail: s.statusDetail,
            }))
          return seeded.length > 0 ? [...prev, ...seeded] : prev
        })
      })
      .catch(() => {})
  }, [])

  return (
    <VideoStyleContext.Provider value={{jobs}}>
      {children}
    </VideoStyleContext.Provider>
  )
}

export const useVideoStyleJobs = () => useContext(VideoStyleContext)

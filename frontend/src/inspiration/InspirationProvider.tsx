import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {InspirationInFlight} from '../../wailsjs/go/main/App'
import {EventsOn} from '../../wailsjs/runtime/runtime'

/** One inspiration video moving through the pipeline. */
export interface InspirationJob {
  id: string
  title: string
  /** downloading | transcribing | analyzing | ready | error */
  status: string
  detail: string
  /** Download percent, or transcript position in seconds, per status. */
  progress: number
}

interface InspirationContextValue {
  /** Videos currently being processed, plus any that just finished/failed. */
  jobs: InspirationJob[]
}

const InspirationContext = createContext<InspirationContextValue>({jobs: []})

/** How long a finished/failed entry lingers in the status bar before clearing. */
const CLEAR_MS = 8_000

/**
 * App-wide inspiration pipeline status. The backend reports every step of a
 * video's download → transcribe → study run as "inspiration:status"; this
 * keeps the in-flight set so the status bar can show it from anywhere (the
 * library pages read the stored library instead, which carries the same
 * state).
 */
export function InspirationProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<InspirationJob[]>([])
  const timers = useRef(new Map<string, number>())

  useEffect(() => {
    const off = EventsOn(
      'inspiration:status',
      (
        id: string,
        title: string,
        status: string,
        detail: string,
        progress: number,
      ) => {
        if (!id) return
        setJobs((prev) => {
          const next = prev.filter((j) => j.id !== id)
          return [
            ...next,
            {id, title: title || 'Inspiration video', status, detail, progress},
          ]
        })

        // A finished (or failed) run stays visible briefly, then clears.
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

  // A run that was interrupted by the app closing is put back in line at
  // startup (see resumeInspirationQueue), and those videos were queued before
  // this listener existed — so seed from what the pipeline is holding rather
  // than showing nothing until the next step lands.
  useEffect(() => {
    InspirationInFlight()
      .then((videos) => {
        setJobs((prev) => {
          const seen = new Set(prev.map((j) => j.id))
          const seeded = (videos ?? [])
            .filter((v) => !seen.has(v.id))
            .map((v) => ({
              id: v.id,
              title: v.title || 'Inspiration video',
              status: v.status,
              detail: v.statusDetail,
              progress: v.progress,
            }))
          return seeded.length > 0 ? [...prev, ...seeded] : prev
        })
      })
      .catch(() => {})
  }, [])

  return (
    <InspirationContext.Provider value={{jobs}}>
      {children}
    </InspirationContext.Provider>
  )
}

export const useInspirationJobs = () => useContext(InspirationContext)

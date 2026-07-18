import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {GenerateSponsorDescription} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'

/** One sponsor website-research run in flight. */
export interface SponsorAiJob {
  sponsorId: string
  /** Sponsor name for status-bar copy. */
  name: string
}

/** End-of-run message shown after a run finishes. */
export interface SponsorAiNotice {
  state: 'done' | 'error'
  detail: string
  sponsorId: string
}

interface SponsorAiContextValue {
  jobs: SponsorAiJob[]
  notice: SponsorAiNotice | null
  /**
   * Research a sponsor's website and write its description. Owned here — not
   * by the sponsor page — so the run and its status-bar chip survive
   * navigating away; the backend persists the description and branding
   * itself for the same reason. Rejects when a run for the sponsor is
   * already in flight.
   */
  generate: (sponsorId: string, name: string) => Promise<main.Sponsor>
  /** Clear the lingering done/error notice — clicking it counts as read. */
  dismissNotice: () => void
}

const SponsorAiContext = createContext<SponsorAiContextValue | undefined>(
  undefined,
)

/**
 * How long the done/error notice lingers: research often finishes while the
 * producer is elsewhere, so the green chip stays around long enough to be
 * seen and clicked (like the other AI status chips).
 */
const NOTICE_MS = 600_000

export function SponsorAiProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<SponsorAiJob[]>([])
  const [notice, setNotice] = useState<SponsorAiNotice | null>(null)
  const noticeTimer = useRef<number>()

  const showNotice = useCallback((n: SponsorAiNotice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(n)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  const generate = useCallback(
    async (sponsorId: string, name: string) => {
      let added = false
      setJobs((prev) => {
        if (prev.some((j) => j.sponsorId === sponsorId)) return prev
        added = true
        return [...prev, {sponsorId, name}]
      })
      if (!added) {
        throw new Error('this sponsor is already being researched')
      }
      // A fresh run supersedes the previous run's lingering notice.
      window.clearTimeout(noticeTimer.current)
      setNotice(null)
      try {
        // The backend persists the description and branding itself.
        const saved = await GenerateSponsorDescription(sponsorId)
        showNotice({
          state: 'done',
          detail: `Sponsor research ready — ${name || 'sponsor'}`,
          sponsorId,
        })
        return saved
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : ''
        showNotice({
          state: 'error',
          detail: message
            ? `Sponsor research failed — ${message}`
            : `Sponsor research failed — ${name || 'sponsor'}`,
          sponsorId,
        })
        throw err
      } finally {
        setJobs((prev) => prev.filter((j) => j.sponsorId !== sponsorId))
      }
    },
    [showNotice],
  )

  const dismissNotice = useCallback(() => {
    window.clearTimeout(noticeTimer.current)
    setNotice(null)
  }, [])

  const value = useMemo<SponsorAiContextValue>(
    () => ({jobs, notice, generate, dismissNotice}),
    [jobs, notice, generate, dismissNotice],
  )

  return (
    <SponsorAiContext.Provider value={value}>
      {children}
    </SponsorAiContext.Provider>
  )
}

export function useSponsorAi(): SponsorAiContextValue {
  const context = useContext(SponsorAiContext)
  if (!context) {
    throw new Error('useSponsorAi must be used within a SponsorAiProvider')
  }
  return context
}

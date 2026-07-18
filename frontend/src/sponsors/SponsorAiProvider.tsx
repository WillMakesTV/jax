import {createContext, useCallback, useContext, useMemo, type ReactNode} from 'react'
import {GenerateSponsorDescription} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useAiQueue} from '../ai/AiQueueProvider'

/** One sponsor website-research run, queued or in flight. */
export interface SponsorAiJob {
  sponsorId: string
  /** Sponsor name for busy-state copy. */
  name: string
}

interface SponsorAiContextValue {
  jobs: SponsorAiJob[]
  /**
   * Research a sponsor's website and write its description. The run lives
   * in the app-wide AI queue (see AiQueueProvider), so it survives
   * navigating away and reports through the status bar; the backend
   * persists the description and branding itself. Rejects when a run for
   * the sponsor is already queued or in flight.
   */
  generate: (sponsorId: string, name: string) => Promise<main.Sponsor>
}

const SponsorAiContext = createContext<SponsorAiContextValue | undefined>(
  undefined,
)

export function SponsorAiProvider({children}: {children: ReactNode}) {
  const queue = useAiQueue()

  const jobs = useMemo<SponsorAiJob[]>(
    () =>
      queue.jobs
        .filter((j) => j.kind === 'sponsor-research')
        .map((j) => ({sponsorId: j.targetId, name: j.title})),
    [queue.jobs],
  )

  const generate = useCallback(
    (sponsorId: string, name: string) =>
      queue.enqueue({
        kind: 'sponsor-research',
        targetId: sponsorId,
        title: name,
        label: `Researching sponsor — ${name || 'sponsor'}`,
        doneDetail: `Sponsor research ready — ${name || 'sponsor'}`,
        failDetail: 'Sponsor research failed',
        busyError: 'this sponsor is already being researched',
        // The backend persists the description and branding itself.
        work: () => GenerateSponsorDescription(sponsorId),
      }),
    [queue],
  )

  const value = useMemo<SponsorAiContextValue>(
    () => ({jobs, generate}),
    [jobs, generate],
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

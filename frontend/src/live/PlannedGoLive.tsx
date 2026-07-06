import {Radio} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  ApplyPlannedStream,
  GetContentSeries,
  GetPlannedStreams,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {START_ROUTINE, runStreamRoutine} from '../obs/routines'
import {platformName} from '../services/services'
import {useServices} from '../services/ServicesProvider'
import {useLiveData} from './LiveDataProvider'

/**
 * "Go Live with Planned Stream" — the Broadcast dashboard's top section.
 * Each planned stream can go live directly: its title, category, and tags
 * are pushed to the targeted channels, then the built-in Start Stream routine
 * runs, exactly like the Go live button. The list stays visible while on the
 * air (the next stream is often planned mid-broadcast) with Go Live disabled;
 * the section hides only when nothing is planned.
 */
export function PlannedGoLive() {
  const {statuses, obsRequest} = useServices()
  const {obs} = useLiveData()

  const obsConnected = statuses.obs.connected
  const channelConnected =
    statuses.twitch.connected || statuses.youtube.connected
  const streaming = Boolean(obs?.outputActive)

  const [plans, setPlans] = useState<main.PlannedStream[]>([])
  const [seriesTitles, setSeriesTitles] = useState<Record<string, string>>({})
  const [confirmingId, setConfirmingId] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})

  // Refresh whenever the section (re)mounts — returning from planning the
  // next stream remounts the dashboard — and when the live state flips.
  useEffect(() => {
    GetPlannedStreams()
      .then((p) => setPlans(p ?? []))
      .catch(() => {})
    GetContentSeries()
      .then((s) =>
        setSeriesTitles(
          Object.fromEntries((s ?? []).map((x) => [x.id, x.title])),
        ),
      )
      .catch(() => {})
  }, [streaming])

  // Going live (from a card or anywhere else) invalidates a pending confirm.
  useEffect(() => {
    if (streaming) setConfirmingId('')
  }, [streaming])

  if (plans.length === 0) return null

  // Plans stay listed while on the air — the next stream can be planned
  // mid-broadcast — but going live is only possible while off the air.
  const canGoLive = obsConnected && channelConnected && !streaming

  const goLive = async (plan: main.PlannedStream) => {
    setBusyId(plan.id)
    setNotes((n) => ({...n, [plan.id]: ''}))
    const warnings: string[] = []
    try {
      // Push the plan's stream info to the platforms first, so the broadcast
      // starts under the right title/category.
      warnings.push(...((await ApplyPlannedStream(plan.id)) ?? []))
    } catch (err) {
      warnings.push(
        err instanceof Error && err.message
          ? err.message
          : 'The plan could not be applied.',
      )
    }
    try {
      warnings.push(...(await runStreamRoutine(START_ROUTINE, obsRequest)))
    } catch (err) {
      warnings.push(
        err instanceof Error && err.message
          ? err.message
          : 'The stream could not be started.',
      )
    } finally {
      setNotes((n) => ({...n, [plan.id]: warnings.join(' · ')}))
      setBusyId('')
      setConfirmingId('')
    }
  }

  return (
    <section aria-label="Go live with a planned stream">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Go Live with Planned Stream
        </h2>
        <span className="text-xs text-fg-muted">
          Applies the plan&apos;s title, category, and tags, then starts the
          broadcast.
        </span>
      </div>

      {/* Cards mirror the Planning page's plan cards, with the Go Live CTA
          in the corner the Planning cards keep their delete button. */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {plans.map((plan) => (
          <li
            key={plan.id}
            className="flex flex-col rounded-xl border border-edge bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
                {plan.title}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {confirmingId === plan.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void goLive(plan)}
                      disabled={busyId !== ''}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {busyId === plan.id ? 'Working…' : 'Confirm go live'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId('')}
                      disabled={busyId !== ''}
                      className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(plan.id)}
                    disabled={!canGoLive || busyId !== ''}
                    title={
                      canGoLive
                        ? undefined
                        : streaming
                          ? 'Already live — end the current broadcast first.'
                          : 'Connect OBS and a channel in Settings → Services to go live.'
                    }
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity',
                      'bg-accent text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                  >
                    <Radio size={12} aria-hidden />
                    Go Live
                  </button>
                )}
              </div>
            </div>
            {plan.description && (
              <p className="mt-1 line-clamp-3 text-sm text-fg-muted">
                {plan.description}
              </p>
            )}
            {(seriesTitles[plan.seriesId] ||
              plan.episodeNumber > 0 ||
              plan.channels.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {seriesTitles[plan.seriesId] && (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                    {seriesTitles[plan.seriesId]}
                  </span>
                )}
                {plan.episodeNumber > 0 && (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                    Episode {plan.episodeNumber}
                  </span>
                )}
                {plan.channels.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted"
                  >
                    <BrandTile platform={c} size={14} />
                    {platformName(c)}
                  </span>
                ))}
              </div>
            )}
            {notes[plan.id] && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {notes[plan.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

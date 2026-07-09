import {useEffect, useState} from 'react'
import {GetContentSeries, GetPlannedStreams} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {platformName} from '../services/services'
import {useLiveData} from './LiveDataProvider'

/**
 * "Go Live with Planned Stream" — the Broadcast dashboard's top section.
 * Each plan card opens the plan's broadcast page (views/BroadcastPlan.tsx),
 * which carries the details and the Go Live / Update Stream Info / Conclude
 * actions. The list stays visible while on the air — the next stream is often
 * planned mid-broadcast — and hides only when nothing is planned.
 */
export function PlannedGoLive({
  onOpenPlan,
}: {
  /** Open a plan's broadcast page. */
  onOpenPlan: (plan: main.PlannedStream) => void
}) {
  const {obs} = useLiveData()
  const streaming = Boolean(obs?.outputActive)

  const [plans, setPlans] = useState<main.PlannedStream[]>([])
  const [seriesTitles, setSeriesTitles] = useState<Record<string, string>>({})

  // Refresh whenever the section (re)mounts — returning from a plan's page
  // remounts the dashboard — and when the live state flips.
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

  if (plans.length === 0) return null

  return (
    <section aria-label="Go live with a planned stream">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Go Live with Planned Stream
        </h2>
        <span className="text-xs text-fg-muted">
          Open a plan to update its channels&apos; stream info or go live.
        </span>
      </div>

      {/* Cards match the Planning page's plan cards (same eyebrow, title,
          description, and channel pills); clicking one opens the plan's
          broadcast page, where its actions live. */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {plans.map((plan) => {
          // Series + episode read as the card's own label — an eyebrow line
          // above the title, exactly like the Planning page's cards.
          const eyebrow = [
            seriesTitles[plan.seriesId] ?? '',
            plan.episodeNumber > 0 ? `Episode ${plan.episodeNumber}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <li key={plan.id}>
              <button
                type="button"
                onClick={() => onOpenPlan(plan)}
                className="flex w-full flex-col rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:bg-surface-hover"
              >
                {eyebrow && (
                  <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-accent">
                    {eyebrow}
                  </span>
                )}
                <span className="block text-sm font-semibold text-fg">
                  {plan.title}
                </span>
                {plan.description && (
                  <p className="mt-1 line-clamp-3 text-sm text-fg-muted">
                    {plan.description}
                  </p>
                )}
                {plan.channels.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

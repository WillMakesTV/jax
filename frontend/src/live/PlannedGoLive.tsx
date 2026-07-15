import {useCallback, useEffect, useState} from 'react'
import {
  GetContentSeries,
  GetPlanSessions,
  GetPlannedStreams,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {PlanStreamedActions} from '../components/PlanStreamedActions'
import {useDataChanged} from '../lib/dataChanged'
import {truncateText} from '../lib/format'
import {platformName} from '../services/services'
import {useLiveData} from './LiveDataProvider'

/**
 * "Go Live with Planned Stream" — the Broadcast dashboard's top section.
 * Each plan card opens the plan's broadcast page (views/BroadcastPlan.tsx),
 * which carries the details and the Go Live / Update Stream Info / Conclude
 * actions; a card whose plan has already been streamed also offers Conclude
 * and Reset in place. The list stays visible while on the air — the next
 * stream is often planned mid-broadcast — and hides only when nothing is
 * planned.
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
  // Each plan's latest broadcast session — how a card knows the plan has
  // already been streamed and can offer Conclude / Reset.
  const [sessions, setSessions] = useState<main.PlanSessionInfo[]>([])

  // Refresh whenever the section (re)mounts — returning from a plan's page
  // remounts the dashboard — when the live state flips, and when a plan is
  // saved behind this page's back (an MCP client, a generated thumbnail).
  const load = useCallback(() => {
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
    GetPlanSessions()
      .then((s) => setSessions(s ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [load, streaming])
  useDataChanged(['planned_streams', 'content_series'], load)

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
            <li
              key={plan.id}
              className="flex flex-col rounded-xl border border-edge bg-surface p-4"
            >
              <button
                type="button"
                onClick={() => onOpenPlan(plan)}
                className="flex w-full flex-col text-left"
              >
                <span className="flex w-full items-start gap-3">
                  {/* The plan's generated thumbnail, when it has one — small,
                      inline with the plan's title (matches the Planning
                      page's cards). */}
                  {plan.thumbnailUrl && (
                    <img
                      src={plan.thumbnailUrl}
                      alt=""
                      aria-hidden
                      className="aspect-video w-24 shrink-0 rounded-md border border-edge object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    {eyebrow && (
                      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-accent">
                        {eyebrow}
                      </span>
                    )}
                    <span className="block text-sm font-semibold text-fg hover:underline">
                      {plan.title}
                    </span>
                  </span>
                </span>
                {/* The description sits on its own line below, full width. */}
                {plan.description && (
                  <span className="mt-2 block text-sm text-fg-muted">
                    {truncateText(plan.description, 150)}
                  </span>
                )}
              </button>
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
              {/* Already gone live? The card wraps the episode up in place. */}
              <PlanStreamedActions
                planId={plan.id}
                session={sessions.find((s) => s.planId === plan.id) ?? null}
                onConcluded={() =>
                  setPlans((prev) => prev.filter((p) => p.id !== plan.id))
                }
                onReset={() =>
                  setSessions((prev) =>
                    prev.filter((s) => s.planId !== plan.id),
                  )
                }
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

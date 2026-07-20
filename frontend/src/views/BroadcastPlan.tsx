import {
  Check,
  CheckCircle2,
  Image as ImageIcon,
  Megaphone,
  Pencil,
  Radio,
  RotateCcw,
  Square,
  Tag,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  ApplyPlannedStream,
  ApplyStreamInfoForPlan,
  ConcludePlannedStream,
  GetContentSeries,
  GetPlanInfoStatus,
  GetPlanSessions,
  ResetPlannedStream,
  SavePlannedStream,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {Modal} from '../components/Modal'
import {
  PlanThumbnailEditor,
  zipThumbHistory,
} from '../components/PlanThumbnailEditor'
import {pushEpisodeText} from '../lib/smartSources'
import {END_ROUTINE, START_ROUTINE, runStreamRoutine} from '../obs/routines'
import {
  anyChannelConnected,
  platformName,
  type ServiceId,
} from '../services/services'
import {useServices} from '../services/ServicesProvider'
import {useLiveData} from '../live/LiveDataProvider'

/**
 * A planned stream's broadcast page, opened from the Broadcast dashboard's
 * plan cards. Shows the plan in full — series/episode front and centre, the
 * targeted channels, and its tags — and carries the broadcast actions:
 *
 *   - Go Live: pushes the plan's stream info, then runs the built-in Start
 *     Stream routine — exactly like the Go live button.
 *   - Update Stream Info: pushes the same info without going live (Twitch's
 *     channel info and YouTube's upcoming broadcast simply apply to the next
 *     stream), so the setup can be tested and verified off the air.
 *   - Conclude episode (available once the plan has gone live): attaches the
 *     plan's details to the finished stream and removes the plan.
 *   - Reset broadcast (same condition): a false start — forgets the plan was
 *     ever broadcast and keeps it for a future stream.
 */
export function BroadcastPlan({
  plan,
  onBack,
  onEdit,
}: {
  plan: main.PlannedStream
  onBack: () => void
  /** Open this plan's edit form (title, series, channels, description). */
  onEdit: (plan: main.PlannedStream) => void
}) {
  const {statuses, obsRequest} = useServices()
  const {obs, refreshObs, refreshPlatforms} = useLiveData()

  const obsConnected = statuses.obs.connected
  const channelConnected = anyChannelConnected(statuses)
  const streaming = Boolean(obs?.outputActive)

  const [seriesTitle, setSeriesTitle] = useState('')
  const [session, setSession] = useState<main.PlanSessionInfo | null>(null)
  // Each targeted channel's current stream info vs. this plan; null while
  // the check is in flight.
  const [infoStatus, setInfoStatus] = useState<main.PlanChannelInfo[] | null>(
    null,
  )
  const [busy, setBusy] = useState<
    '' | 'golive' | 'stop' | 'apply' | 'conclude' | 'reset'
  >('')
  const [confirmConclude, setConfirmConclude] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [note, setNote] = useState('')

  // The plan's thumbnail, editable in place (hover the image for the CTA):
  // changes persist onto the plan immediately.
  const [thumb, setThumb] = useState({
    file: plan.thumbnailFile ?? '',
    url: plan.thumbnailUrl ?? '',
  })
  const [thumbHistory, setThumbHistory] = useState(() =>
    zipThumbHistory(plan.thumbnailHistory, plan.thumbnailHistoryUrls),
  )
  const [editingThumb, setEditingThumb] = useState(false)

  const applyThumb = async (t: {file: string; url: string}) => {
    const stored = await SavePlannedStream(
      main.PlannedStream.createFrom({
        id: plan.id,
        title: plan.title,
        description: plan.description,
        channels: plan.channels ?? [],
        seriesId: plan.seriesId,
        episodeNumber: plan.episodeNumber,
        tags: plan.tags ?? [],
        thumbnailFile: t.file,
        createdAt: plan.createdAt,
      }),
    )
    setThumb(t)
    setThumbHistory(
      zipThumbHistory(stored.thumbnailHistory, stored.thumbnailHistoryUrls),
    )
  }

  // Reload the whole page state: series, the plan's broadcast session, and
  // every channel's current stream info. The info check drops back to
  // "checking" while it runs, so the primary action always reflects a fresh
  // verification.
  const reloadAll = useCallback(async () => {
    setInfoStatus(null)
    if (plan.seriesId) {
      GetContentSeries()
        .then((s) =>
          setSeriesTitle(
            (s ?? []).find((x) => x.id === plan.seriesId)?.title ?? '',
          ),
        )
        .catch(() => {})
    }
    GetPlanSessions()
      .then((s) =>
        setSession((s ?? []).find((x) => x.planId === plan.id) ?? null),
      )
      .catch(() => {})
    try {
      setInfoStatus((await GetPlanInfoStatus(plan.id)) ?? [])
    } catch {
      // Unknown state must not lock the page; treat as nothing to compare.
      setInfoStatus([])
    }
  }, [plan.id, plan.seriesId])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll, streaming])

  // A definite mismatch: the channel was read and its title differs from the
  // plan's. Unknown states (disconnected, no upcoming YouTube broadcast to
  // read) never block — going live creates/fixes those as it applies the
  // info.
  const mismatches = (infoStatus ?? []).filter(
    (s) => s.connected && !s.matches && !s.detail,
  )
  const checkingInfo = infoStatus === null
  const infoReady = !checkingInfo && mismatches.length === 0

  const canGoLive = obsConnected && channelConnected && !streaming && infoReady
  // This plan is the broadcast on the air: its session is still open while
  // OBS streams. The page's primary action is then Stop Stream.
  const liveWithThisPlan =
    streaming && Boolean(session && session.endedAt === '')
  // Concludable from the moment the plan has gone live (it has a stream
  // session) — usually used once the broadcast is over, but concluding while
  // still on the air just closes the session early; the confirm guards it.
  const canConclude = Boolean(session)

  const goLive = async () => {
    setBusy('golive')
    setNote('')
    const warnings: string[] = []
    try {
      // Push the plan's stream info first, so the broadcast starts under the
      // right title/category.
      warnings.push(...((await ApplyPlannedStream(plan.id)) ?? []))
    } catch (err) {
      warnings.push(
        err instanceof Error && err.message
          ? err.message
          : 'The plan could not be applied.',
      )
    }
    let started = true
    try {
      const routineWarnings = await runStreamRoutine(START_ROUTINE, obsRequest)
      warnings.push(...routineWarnings)
      started = !routineWarnings.some((w) => /could not start/i.test(w))
    } catch (err) {
      started = false
      warnings.push(
        err instanceof Error && err.message
          ? err.message
          : 'The stream could not be started.',
      )
    }
    setBusy('')
    if (started) {
      // On the air: nudge the pollers so the Broadcast nav item's live pulse
      // reflects it right away, and land on the Broadcast dashboard.
      refreshObs()
      refreshPlatforms()
      onBack()
      return
    }
    setNote(warnings.join(' · '))
  }

  // Stop Stream — the same built-in End Stream routine the dashboard's Stop
  // button runs (before-steps, the stream stops, after-steps, and the plan's
  // session closes).
  const stopStream = async () => {
    setBusy('stop')
    setNote('')
    try {
      const warnings = await runStreamRoutine(END_ROUTINE, obsRequest)
      setNote(warnings.join(' · '))
    } catch (err) {
      setNote(
        err instanceof Error && err.message
          ? err.message
          : 'The stream could not be stopped.',
      )
    } finally {
      setBusy('')
      refreshObs()
      refreshPlatforms()
      await reloadAll()
    }
  }

  // Apply the plan's info to every targeted channel without going live — the
  // easy way to test and verify the setup. OBS is part of the setup too: the
  // mapped episode text sources are rewritten with the plan's title and
  // "Episode N" (their whole text replaced), same as going live would.
  const applyInfo = async () => {
    setBusy('apply')
    setNote('')
    try {
      const warnings = (await ApplyStreamInfoForPlan(plan.id)) ?? []
      if (obsConnected) {
        try {
          const wrote = await pushEpisodeText(
            obsRequest,
            plan.title,
            plan.episodeNumber,
          )
          if (!wrote) {
            warnings.push(
              'OBS: no episode text sources are mapped — choose them on the series’ edit page.',
            )
          }
        } catch {
          warnings.push('OBS: the episode text sources could not be updated.')
        }
      } else {
        warnings.push(
          'OBS is not connected — its episode text sources were not updated.',
        )
      }
      setNote(
        warnings.length > 0
          ? warnings.join(' · ')
          : 'Stream info updated on every targeted channel and in OBS.',
      )
    } catch (err) {
      setNote(
        err instanceof Error && err.message
          ? err.message
          : 'The stream info could not be updated.',
      )
    } finally {
      setBusy('')
      // Full reload and re-verification: the page drops back to "checking",
      // re-reads every channel, and — when everything now matches — lands on
      // the Go Live button by itself.
      await reloadAll()
    }
  }

  const conclude = async () => {
    setBusy('conclude')
    setNote('')
    try {
      await ConcludePlannedStream(plan.id)
      // The episode is now a past stream; back to the Broadcast dashboard.
      onBack()
    } catch (err) {
      setNote(
        err instanceof Error && err.message
          ? err.message
          : 'The episode could not be concluded.',
      )
    } finally {
      setBusy('')
      setConfirmConclude(false)
    }
  }

  // Reset forgets the plan was ever broadcast — a false start: its sessions
  // and go-live assignments are cleared, and the plan stays for a future
  // stream.
  const resetStream = async () => {
    setBusy('reset')
    setNote('')
    try {
      await ResetPlannedStream(plan.id)
      setSession(null)
    } catch (err) {
      setNote(
        err instanceof Error && err.message
          ? err.message
          : 'Could not reset the broadcast.',
      )
    } finally {
      setBusy('')
      setConfirmReset(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => onEdit(plan)}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <Pencil size={14} aria-hidden />
          Edit plan
        </button>
      </div>

      <div className="flex max-w-3xl flex-col gap-6 xl:max-w-6xl">
        {/* The episode's identity on the left, the broadcast actions
            alongside on the right. */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <header className="min-w-0 flex-1">
              {seriesTitle && (
                <p className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                  {seriesTitle}
                </p>
              )}
              {plan.episodeNumber > 0 && (
                <p className="mt-1 text-4xl font-bold tracking-tight text-accent">
                  Episode {plan.episodeNumber}
                </p>
              )}
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
                {plan.title}
              </h1>
            </header>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {canConclude &&
                (confirmConclude ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void conclude()}
                      disabled={busy !== ''}
                      className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === 'conclude' ? 'Working…' : 'Confirm conclude'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmConclude(false)}
                      disabled={busy !== ''}
                      className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : confirmReset ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void resetStream()}
                      disabled={busy !== ''}
                      className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === 'reset' ? 'Resetting…' : 'Confirm reset'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      disabled={busy !== ''}
                      className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {/* A matched (session-less) broadcast has nothing to
                      reset; only Conclude applies. */}
                    {!session?.matched && (
                      <button
                        type="button"
                        onClick={() => setConfirmReset(true)}
                        disabled={busy !== ''}
                        title="False start? Forget this broadcast — sessions and go-live assignments are cleared, the plan stays for a future stream."
                        className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                      >
                        <RotateCcw size={14} aria-hidden />
                        Reset broadcast
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmConclude(true)}
                      disabled={busy !== ''}
                      title="Wrap this episode up: keep its details on the past stream and remove the plan."
                      className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-semibold text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                    >
                      <CheckCircle2 size={14} aria-hidden />
                      Conclude episode
                    </button>
                  </>
                ))}
              {/* One primary action at a time: on the air with this plan offers
                "Stop Stream"; out-of-date info offers only "Update Stream
                Info"; the post-update re-check swaps it for "Go Live" once
                every channel carries the plan's title. */}
              {liveWithThisPlan ? (
                <button
                  type="button"
                  onClick={() => void stopStream()}
                  disabled={!obsConnected || busy !== ''}
                  title="Run the End Stream routine and go off the air."
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Square size={14} aria-hidden />
                  {busy === 'stop' ? 'Stopping…' : 'Stop Stream'}
                </button>
              ) : checkingInfo ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-wait items-center gap-1.5 rounded-lg border border-edge bg-bg px-4 py-2 text-sm font-semibold text-fg-muted opacity-70"
                >
                  Checking stream info…
                </button>
              ) : mismatches.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void applyInfo()}
                  disabled={busy !== ''}
                  title="Push this plan’s title, description, category, and tags to its channels, then re-check them."
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Megaphone size={14} aria-hidden />
                  {busy === 'apply' ? 'Updating…' : 'Update Stream Info'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void goLive()}
                  disabled={!canGoLive || busy !== ''}
                  title={
                    canGoLive
                      ? 'Run the Start Stream routine and go on the air.'
                      : streaming
                        ? 'Already live — end the current broadcast first.'
                        : 'Connect OBS and a channel in Settings → Services to go live.'
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Radio size={14} aria-hidden />
                  {busy === 'golive' ? 'Going live…' : 'Go Live'}
                </button>
              )}
            </div>
          </div>
          {note && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{note}</p>
          )}
        </div>

        {/* The plan's artwork with the channel grid directly beneath it —
            the thumbnail and where the episode airs read as one block, with
            the description following in full width. Hovering the image
            offers the edit CTA (upload or AI-generate). */}
        <div className="flex flex-col gap-3">
          <div className="group relative w-72 max-w-full">
            {thumb.url ? (
              <img
                src={thumb.url}
                alt="Broadcast thumbnail"
                className="aspect-video w-full rounded-lg border border-edge object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-edge text-xs text-fg-muted">
                <ImageIcon size={16} aria-hidden className="mr-1.5" />
                No thumbnail yet
              </div>
            )}
            <button
              type="button"
              onClick={() => setEditingThumb(true)}
              className="absolute inset-0 hidden items-center justify-center gap-1.5 rounded-lg bg-black/40 text-xs font-semibold text-white focus-visible:flex group-hover:flex"
            >
              <Pencil size={13} aria-hidden />
              {thumb.url ? 'Update image' : 'Add thumbnail'}
            </button>
          </div>
          {plan.channels.length > 0 && (
            <section aria-labelledby="broadcast-channels-heading">
              <h2
                id="broadcast-channels-heading"
                className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted"
              >
                Broadcast channels
              </h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                {plan.channels.map((c) => {
                  const s = (infoStatus ?? []).find((x) => x.channel === c)
                  return (
                    <div
                      key={c}
                      className="rounded-lg border border-edge bg-surface px-3 py-2"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-fg">
                        <BrandTile platform={c} size={18} />
                        {platformName(c)}
                        {statuses[c as ServiceId]?.account && (
                          <span className="text-xs text-fg-muted">
                            {statuses[c as ServiceId].account}
                          </span>
                        )}
                      </div>
                      {/* The channel's current stream info vs. this plan. */}
                      {checkingInfo ? (
                        <p className="mt-1 text-xs text-fg-muted">
                          Checking stream info…
                        </p>
                      ) : s?.matches ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <Check size={12} aria-hidden />
                          Stream info matches
                        </p>
                      ) : s?.detail ? (
                        <p className="mt-1 text-xs text-fg-muted">{s.detail}</p>
                      ) : s ? (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          {s.currentTitle === s.wantTitle && s.thumbnailStale
                            ? 'Thumbnail out of date'
                            : s.currentTitle
                              ? `Currently “${s.currentTitle}”`
                              : 'No stream title set yet — Update Stream Info sets it.'}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        {plan.description && (
          <p className="whitespace-pre-wrap text-sm text-fg-muted">
            {plan.description}
          </p>
        )}

        <Modal
          open={editingThumb}
          onClose={() => setEditingThumb(false)}
          title="Broadcast thumbnail"
          maxWidthClass="max-w-lg"
        >
          <PlanThumbnailEditor
            planTitle={plan.title}
            planDescription={plan.description}
            file={thumb.file}
            url={thumb.url}
            history={thumbHistory}
            onApply={applyThumb}
          />
        </Modal>

        {(plan.tags ?? []).length > 0 && (
          <section aria-labelledby="broadcast-tags-heading">
            <h2
              id="broadcast-tags-heading"
              className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
            >
              <Tag size={13} aria-hidden />
              Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {(plan.tags ?? []).map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

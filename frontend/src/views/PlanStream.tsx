import {ArrowLeft, Check, Sparkles, WandSparkles} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  EditPlanDescription,
  GeneratePlanSuggestion,
  GetContentSeries,
  GetSeriesTypes,
  SavePlannedStream,
  UsedEpisodeNumbers,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {
  DEFAULT_YOUTUBE_LIVE_PREFIX,
  broadcastBaseTitle,
  loadYouTubeLivePrefix,
  platformBroadcastTitle,
} from '../lib/broadcastTitles'
import {SERVICES} from '../services/services'
import {useServices} from '../services/ServicesProvider'

/** The platforms a stream can be broadcast to. */
const BROADCAST_SERVICES = SERVICES.filter(
  (s) => s.id === 'twitch' || s.id === 'youtube',
)

/**
 * The stream-plan page: create a new plan, or view and edit an existing one
 * (each planned stream opens here from the Planning dashboard). A title,
 * description, series/episode, and the connected channels to broadcast to
 * (all connected ones checked by default on a new plan).
 */
export function PlanStream({
  plan,
  onBack,
  onSaved,
}: {
  /** The plan being viewed/edited, or null when creating a new one. */
  plan: main.PlannedStream | null
  onBack: () => void
  /** Called after a plan is saved. */
  onSaved: () => void
}) {
  const {statuses} = useServices()

  const [title, setTitle] = useState(plan?.title ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [tags, setTags] = useState((plan?.tags ?? []).join(', '))
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (plan) return new Set(plan.channels ?? [])
    const s = new Set<string>()
    for (const svc of BROADCAST_SERVICES) {
      if (statuses[svc.id]?.connected) s.add(svc.id)
    }
    return s
  })
  const [series, setSeries] = useState<main.ContentSeries[]>([])
  const [seriesId, setSeriesId] = useState(plan?.seriesId ?? '')
  // Series types are only loaded to infer behaviour (episodic or not) from
  // the chosen series — the plan itself carries no type; the series does.
  const [types, setTypes] = useState<main.SeriesType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // The description textarea's selection range, for scoped AI edits.
  const [descSelection, setDescSelection] = useState<[number, number]>([0, 0])
  // The configured "🔴 LIVE: " marker YouTube titles carry.
  const [ytPrefix, setYtPrefix] = useState(DEFAULT_YOUTUBE_LIVE_PREFIX)
  useEffect(() => {
    loadYouTubeLivePrefix().then(setYtPrefix)
  }, [])

  useEffect(() => {
    GetContentSeries()
      .then((s) => {
        const list = s ?? []
        setSeries(list)
        // A fresh plan starts on the default series, when one is set; never
        // override a choice the user already made or a saved plan's series.
        if (plan) return
        const def = list.find((x) => x.isDefault)
        if (def) setSeriesId((cur) => (cur === '' ? def.id : cur))
      })
      .catch(() => {})
    GetSeriesTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
  }, [plan])

  const activeSeries = series.find((s) => s.id === seriesId)

  // Planning a stream for an episodic series slots it into the sequence:
  // prefill one past the highest episode used anywhere in the series — past
  // streams, open plans, and the broadcast currently on the air.
  const [episode, setEpisode] = useState(
    plan?.episodeNumber ? String(plan.episodeNumber) : '',
  )
  const [usedEpisodes, setUsedEpisodes] = useState<number[]>([])
  const episodicPlan = Boolean(
    types.find((t) => t.id === activeSeries?.typeId)?.episodic,
  )
  useEffect(() => {
    if (!episodicPlan || !seriesId) {
      setEpisode('')
      setUsedEpisodes([])
      return
    }
    let cancelled = false
    UsedEpisodeNumbers(seriesId)
      .then((used) => {
        if (cancelled) return
        const list = used ?? []
        setUsedEpisodes(list)
        // An edited plan keeps its own number while it stays on its series;
        // a new plan (or a series switch) prefills the next in sequence.
        if (plan && seriesId === plan.seriesId) {
          setEpisode(plan.episodeNumber ? String(plan.episodeNumber) : '')
        } else {
          setEpisode(String((list[list.length - 1] ?? 0) + 1))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [episodicPlan, seriesId, plan])

  const episodeNum = Number(episode)
  const episodeValid =
    episode.trim() === '' || (Number.isInteger(episodeNum) && episodeNum >= 1)
  // The plan's own saved number is not a conflict with itself.
  const episodeTaken =
    episodicPlan &&
    episodeValid &&
    usedEpisodes.includes(episodeNum) &&
    !(plan && plan.seriesId === seriesId && plan.episodeNumber === episodeNum)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    if (!title.trim()) {
      setError('Give your stream a title.')
      return
    }
    if (episodicPlan && episode.trim() !== '') {
      if (!episodeValid) {
        setError('The episode number must be a whole number of 1 or more.')
        return
      }
      if (episodeTaken) {
        setError(
          `Episode ${episodeNum} is already used in this series — pick another number.`,
        )
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      await SavePlannedStream(
        main.PlannedStream.createFrom({
          id: plan?.id ?? '',
          title: title.trim(),
          description: description.trim(),
          channels: [...selected],
          seriesId,
          episodeNumber:
            episodicPlan && episode.trim() !== '' && episodeValid
              ? episodeNum
              : 0,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          createdAt: plan?.createdAt ?? '',
        }),
      )
      onSaved()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the plan.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Planning
      </button>

      <div className="max-w-2xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">
            {plan
              ? 'Review and adjust this planned broadcast.'
              : 'Outline your next broadcast and choose where it goes out.'}
          </p>
          <GeneratePlanButton
            title={title}
            seriesId={seriesId}
            episodeNumber={episodicPlan && episodeValid ? episodeNum : 0}
            hasDraft={Boolean(description.trim() || tags.trim())}
            onSuggestion={(s) => {
              if (s.title) setTitle(s.title)
              if (s.description) setDescription(s.description)
              if ((s.tags ?? []).length > 0) setTags((s.tags ?? []).join(', '))
              setDescSelection([0, 0])
            }}
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="flex flex-col gap-5"
        >
          <div>
            <label
              htmlFor="plan-title"
              className="mb-1.5 block text-sm font-medium text-fg"
            >
              Title
            </label>
            <input
              id="plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Building the planner"
              autoFocus
              className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          {series.length > 0 && (
            <div>
              {/* Series and episode share one row; the episode column only
                  appears for episodic series. */}
              <div className="flex flex-wrap gap-4">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="plan-series"
                    className="mb-1.5 block text-sm font-medium text-fg"
                  >
                    Content series{' '}
                    <span className="font-normal text-fg-muted">
                      (optional)
                    </span>
                  </label>
                  <select
                    id="plan-series"
                    value={seriesId}
                    onChange={(e) => setSeriesId(e.target.value)}
                    className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  >
                    <option value="">None</option>
                    {series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>

                {episodicPlan && (
                  <div className="w-28 shrink-0">
                    <label
                      htmlFor="plan-episode"
                      className="mb-1.5 block text-sm font-medium text-fg"
                    >
                      Episode
                    </label>
                    <input
                      id="plan-episode"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={episode}
                      onChange={(e) => setEpisode(e.target.value)}
                      aria-invalid={episodeTaken || !episodeValid}
                      className={clsx(
                        'w-full rounded-lg border bg-bg px-3 py-2 text-sm text-fg outline-none',
                        episodeTaken || !episodeValid
                          ? 'border-red-500/60 focus:border-red-500'
                          : 'border-edge focus:border-accent',
                      )}
                    />
                  </div>
                )}
              </div>

              {episodicPlan && (
                <p
                  className={clsx(
                    'mt-1.5 text-xs',
                    episodeTaken || !episodeValid
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-fg-muted',
                  )}
                >
                  {!episodeValid
                    ? 'Enter a whole number of 1 or more.'
                    : episodeTaken
                      ? `Episode ${episodeNum} is already used in this series (past stream, plan, or the current live stream).`
                      : "Prefilled with the next episode in this series' sequence."}
                </p>
              )}

              {activeSeries && (
                <div className="mt-2 rounded-lg border border-edge bg-surface p-3 text-sm">
                  {(activeSeries.twitchCategory?.id ||
                    activeSeries.youtubeCategory?.id) && (
                    <p className="text-xs font-medium text-fg-muted">
                      {[
                        activeSeries.twitchCategory?.id
                          ? `Twitch: ${activeSeries.twitchCategory.name}`
                          : '',
                        activeSeries.youtubeCategory?.id
                          ? `YouTube: ${activeSeries.youtubeCategory.name}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  {activeSeries.description && (
                    <p className="mt-1 text-fg-muted">
                      {activeSeries.description}
                    </p>
                  )}
                  {activeSeries.notes && (
                    <p className="mt-2 whitespace-pre-wrap text-fg">
                      {activeSeries.notes}
                    </p>
                  )}
                  {activeSeries.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activeSeries.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-md bg-surface-hover px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="plan-description"
              className="mb-1.5 block text-sm font-medium text-fg"
            >
              Description{' '}
              <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <MarkdownField
              id="plan-description"
              value={description}
              onChange={setDescription}
              placeholder="What's the plan for this stream?"
              onSelectionChange={(start, end) => setDescSelection([start, end])}
            />
            <DescriptionAiActions
              description={description}
              selection={descSelection}
              onDescription={(next) => {
                setDescription(next)
                setDescSelection([0, 0])
              }}
            />
          </div>

          <div>
            <label
              htmlFor="plan-tags"
              className="mb-1.5 block text-sm font-medium text-fg"
            >
              Tags{' '}
              <span className="font-normal text-fg-muted">
                (comma-separated — blank uses the series&apos; tags)
              </span>
            </label>
            <input
              id="plan-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={
                (activeSeries?.tags?.length ?? 0) > 0
                  ? activeSeries!.tags.join(', ')
                  : 'ai, coding, live'
              }
              className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-fg">
              Broadcast to
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {BROADCAST_SERVICES.map((svc) => {
                const connected = Boolean(statuses[svc.id]?.connected)
                const account = statuses[svc.id]?.account
                const checked = selected.has(svc.id)
                const Logo = svc.Icon
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => toggle(svc.id)}
                    disabled={!connected}
                    className={clsx(
                      'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      checked
                        ? 'border-accent/50 bg-accent/5'
                        : 'border-edge bg-surface hover:bg-surface-hover',
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{backgroundColor: svc.brand}}
                    >
                      <Logo size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">
                        {svc.name}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {connected
                          ? account || 'Connected'
                          : 'Not connected'}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className={clsx(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                        checked
                          ? 'border-accent bg-accent text-accent-fg'
                          : 'border-edge',
                      )}
                    >
                      {checked && <Check size={14} />}
                    </span>
                  </button>
                )
              })}
            </div>
            {/* Exactly what each selected channel's broadcast will carry when
                this plan goes live — title, category/tags, and description —
                shown in full for review. */}
            {selected.size > 0 && (
              <div className="mt-3 rounded-lg border border-edge bg-surface p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Broadcast preview
                </p>
                <ul className="mt-2 flex flex-col gap-3">
                  {BROADCAST_SERVICES.filter((svc) =>
                    selected.has(svc.id),
                  ).map((svc) => {
                    const streamTitle = platformBroadcastTitle(
                      svc.id,
                      broadcastBaseTitle(
                        title.trim() || 'Untitled stream',
                        episodicPlan && episodeValid ? episodeNum : 0,
                      ),
                      ytPrefix,
                    )
                    const category =
                      svc.id === 'twitch'
                        ? activeSeries?.twitchCategory?.name ?? ''
                        : activeSeries?.youtubeCategory?.name ?? ''
                    // The plan's own tags win; the series' are the fallback.
                    const planTags = tags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                    const effectiveTags =
                      planTags.length > 0 ? planTags : activeSeries?.tags ?? []
                    const meta = [
                      category && `Category: ${category}`,
                      svc.id === 'twitch' &&
                        effectiveTags.length > 0 &&
                        `Tags: ${effectiveTags.join(', ')}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                    const Logo = svc.Icon
                    return (
                      <li key={svc.id} className="flex items-start gap-2">
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-white"
                          style={{backgroundColor: svc.brand}}
                        >
                          <Logo size={11} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium text-fg">
                            {streamTitle}
                          </p>
                          {meta && (
                            <p className="mt-0.5 text-xs text-fg-muted">
                              {meta}
                            </p>
                          )}
                          {svc.id === 'youtube' && (
                            <p className="mt-0.5 whitespace-pre-wrap text-xs text-fg-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] overflow-hidden">
                              {description.trim() ||
                                'No description yet — it is written onto the YouTube broadcast when the stream info is applied.'}
                            </p>
                          )}
                          {svc.id === 'twitch' && (
                            <p className="mt-0.5 text-xs text-fg-muted/70">
                              Twitch streams carry no description — title,
                              category, and tags only.
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 text-xs text-fg-muted">
                  Applied when you go live with this plan. The YouTube live
                  marker is configured in Settings → Streams.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save plan'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * The "Request edits" AI helper under the description field: applies an
 * instruction to the description — scoped to the highlighted section when one
 * is selected, otherwise the whole text. (Generation lives in
 * GeneratePlanButton at the top of the form.)
 */
function DescriptionAiActions({
  description,
  selection,
  onDescription,
}: {
  description: string
  /** [start, end] selection in the description textarea. */
  selection: [number, number]
  onDescription: (next: string) => void
}) {
  const {statuses} = useServices()
  const aiConnected = statuses['anthropic']?.connected ?? false

  const [editOpen, setEditOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<'' | 'edit'>('')
  const [aiError, setAiError] = useState('')

  const [selStart, selEnd] = selection
  const snippet =
    selEnd > selStart ? description.slice(selStart, selEnd) : ''

  const applyEdit = async () => {
    if (!instruction.trim()) {
      setAiError('Describe the edit you want.')
      return
    }
    setBusy('edit')
    setAiError('')
    try {
      const result = await EditPlanDescription(
        description,
        snippet,
        instruction.trim(),
      )
      // With a highlighted section the model returns only its replacement;
      // splice it in. Otherwise it returns the full revised description.
      onDescription(
        snippet
          ? description.slice(0, selStart) + result + description.slice(selEnd)
          : result,
      )
      setInstruction('')
      setEditOpen(false)
    } catch (err) {
      setAiError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not apply the edit.',
      )
    } finally {
      setBusy('')
    }
  }

  const aiTitle = aiConnected
    ? undefined
    : 'Connect Anthropic in Settings → AI to use AI suggestions.'

  return (
    <div className="mt-1.5 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setEditOpen((open) => !open)
            setAiError('')
          }}
          disabled={!aiConnected || busy !== '' || !description.trim()}
          title={
            aiTitle ??
            (description.trim()
              ? undefined
              : 'Write or generate a description first.')
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <WandSparkles size={12} aria-hidden />
          Request edits
        </button>
        {!editOpen && description.trim() && (
          <span className="text-[11px] text-fg-muted">
            Tip: highlight part of the description to scope an edit.
          </span>
        )}
      </div>

      {editOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-3">
          <p className="text-xs text-fg-muted">
            {snippet ? (
              <>
                Editing the highlighted section:{' '}
                <span className="font-medium text-fg">
                  “{snippet.length > 80 ? snippet.slice(0, 80) + '…' : snippet}”
                </span>
              </>
            ) : (
              'Editing the whole description — highlight text in the field above to scope the edit to a section.'
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void applyEdit()
                }
              }}
              placeholder={
                snippet
                  ? 'e.g. make this punchier / mention the new overlay'
                  : 'e.g. shorten to two sentences and add a call to action'
              }
              className="min-w-48 flex-1 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void applyEdit()}
              disabled={busy !== ''}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'edit' ? 'Applying…' : 'Apply edit'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditOpen(false)
                setInstruction('')
                setAiError('')
              }}
              disabled={busy !== ''}
              className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {aiError && (
        <p className="text-xs text-red-600 dark:text-red-400">{aiError}</p>
      )}
    </div>
  )
}

/**
 * The form's top-right AI CTA: drafts the whole plan — title, description,
 * and tags — from the series context and the previous episodes' outlines.
 * A typed title is treated as the topic to refine; replacing an existing
 * description/tags draft asks first.
 */
function GeneratePlanButton({
  title,
  seriesId,
  episodeNumber,
  hasDraft,
  onSuggestion,
}: {
  title: string
  seriesId: string
  episodeNumber: number
  /** Whether generated fields would overwrite something the user wrote. */
  hasDraft: boolean
  onSuggestion: (s: main.PlanSuggestion) => void
}) {
  const {statuses} = useServices()
  const aiConnected = statuses['anthropic']?.connected ?? false

  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [aiError, setAiError] = useState('')

  const generate = async () => {
    setConfirming(false)
    setBusy(true)
    setAiError('')
    try {
      onSuggestion(
        await GeneratePlanSuggestion(title.trim(), seriesId, episodeNumber),
      )
    } catch (err) {
      setAiError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not generate a suggestion.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-fg-muted">
            Replace the current draft?
          </span>
          <button
            type="button"
            onClick={() => void generate()}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            Keep mine
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (hasDraft ? setConfirming(true) : void generate())}
          disabled={!aiConnected || busy}
          title={
            aiConnected
              ? 'Draft a title, description, and tags from this series’ previous episodes.'
              : 'Connect Anthropic in Settings → AI to use AI suggestions.'
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles size={13} aria-hidden />
          {busy ? 'Generating…' : 'Generate with AI'}
        </button>
      )}
      {aiError && (
        <p className="max-w-64 text-right text-xs text-red-600 dark:text-red-400">
          {aiError}
        </p>
      )}
    </div>
  )
}

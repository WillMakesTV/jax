import {ArrowLeft, Check} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  GetContentSeries,
  GetSeriesTypes,
  SavePlannedStream,
  UsedEpisodeNumbers,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {SERVICES} from '../services/services'
import {useServices} from '../services/ServicesProvider'

/** The platforms a stream can be broadcast to. */
const BROADCAST_SERVICES = SERVICES.filter(
  (s) => s.id === 'twitch' || s.id === 'youtube',
)

/**
 * The "Plan a stream" form on its own page: a title, description, and the
 * connected channels to broadcast to (all connected ones checked by default).
 */
export function PlanStream({
  onBack,
  onSaved,
}: {
  onBack: () => void
  /** Called after a plan is saved. */
  onSaved: () => void
}) {
  const {statuses} = useServices()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const svc of BROADCAST_SERVICES) {
      if (statuses[svc.id]?.connected) s.add(svc.id)
    }
    return s
  })
  const [series, setSeries] = useState<main.ContentSeries[]>([])
  const [seriesId, setSeriesId] = useState('')
  // Series types are only loaded to infer behaviour (episodic or not) from
  // the chosen series — the plan itself carries no type; the series does.
  const [types, setTypes] = useState<main.SeriesType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    GetContentSeries()
      .then((s) => {
        const list = s ?? []
        setSeries(list)
        // A fresh plan starts on the default series, when one is set; never
        // override a choice the user already made.
        const def = list.find((x) => x.isDefault)
        if (def) setSeriesId((cur) => (cur === '' ? def.id : cur))
      })
      .catch(() => {})
    GetSeriesTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
  }, [])

  const activeSeries = series.find((s) => s.id === seriesId)

  // Planning a stream for an episodic series slots it into the sequence:
  // prefill one past the highest episode used anywhere in the series — past
  // streams, open plans, and the broadcast currently on the air.
  const [episode, setEpisode] = useState('')
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
        setEpisode(String((list[list.length - 1] ?? 0) + 1))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [episodicPlan, seriesId])

  const episodeNum = Number(episode)
  const episodeValid =
    episode.trim() === '' || (Number.isInteger(episodeNum) && episodeNum >= 1)
  const episodeTaken =
    episodicPlan && episodeValid && usedEpisodes.includes(episodeNum)

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
          id: '',
          title: title.trim(),
          description: description.trim(),
          channels: [...selected],
          seriesId,
          episodeNumber:
            episodicPlan && episode.trim() !== '' && episodeValid
              ? episodeNum
              : 0,
          createdAt: '',
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
        Back to Broadcast
      </button>

      <div className="max-w-2xl">
        <p className="mb-6 text-sm text-fg-muted">
          Outline your next broadcast and choose where it goes out.
        </p>

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
            <textarea
              id="plan-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What's the plan for this stream?"
              className="w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
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

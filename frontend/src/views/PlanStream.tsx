import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Pencil,
  RotateCcw,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState, type ReactNode} from 'react'
import {
  ConcludePlannedStream,
  EditPlanDescription,
  GeneratePlanSuggestion,
  GetContentSeries,
  GetPlanSessions,
  GetSeriesTypes,
  ResetPlannedStream,
  SavePlannedStream,
  UsedEpisodeNumbers,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Modal} from '../components/Modal'
import {
  PlanThumbnailEditor,
  zipThumbHistory,
} from '../components/PlanThumbnailEditor'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {
  DEFAULT_YOUTUBE_LIVE_PREFIX,
  broadcastBaseTitle,
  loadYouTubeLivePrefix,
  platformBroadcastTitle,
} from '../lib/broadcastTitles'
import {
  twitchLabelName,
  YOUTUBE_MADE_FOR_KIDS_NAME,
} from '../lib/contentLabels'
import {SERVICES} from '../services/services'
import {useServices} from '../services/ServicesProvider'

/** The platforms a stream can be broadcast to. */
const BROADCAST_SERVICES = SERVICES.filter(
  (s) => s.category === 'channels',
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

  // The stored plan, kept current across per-field saves. null while the
  // plan is still being created (create mode: one classic editable form);
  // once it exists, every field is read-only with a hover Edit CTA and
  // saves itself — there is no whole-form Save.
  const [savedPlan, setSavedPlan] = useState<main.PlannedStream | null>(plan)
  const editMode = savedPlan !== null

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
  // The plan's latest broadcast session (if it has gone live), for the
  // "Conclude episode" action once that broadcast is over.
  const [session, setSession] = useState<main.PlanSessionInfo | null>(null)
  const [concluding, setConcluding] = useState(false)
  const [confirmConclude, setConfirmConclude] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!plan) return
    GetPlanSessions()
      .then((s) => setSession((s ?? []).find((x) => x.planId === plan.id) ?? null))
      .catch(() => {})
  }, [plan])
  // Offered from the moment the plan has gone live (it has a stream
  // session); concluding while still on the air closes the session early.
  const canConclude = Boolean(plan && session)

  const conclude = async () => {
    if (!plan) return
    setConcluding(true)
    setError('')
    try {
      await ConcludePlannedStream(plan.id)
      onSaved() // the plan is gone; return to the Planning lists
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The episode could not be concluded.',
      )
      setConcluding(false)
      setConfirmConclude(false)
    }
  }
  // The description textarea's selection range, for scoped AI edits.
  const [descSelection, setDescSelection] = useState<[number, number]>([0, 0])

  // Thumbnail: generated or uploaded via the shared PlanThumbnailEditor;
  // in edit mode every change persists onto the plan immediately.
  const [thumbFile, setThumbFile] = useState(plan?.thumbnailFile ?? '')
  const [thumbUrl, setThumbUrl] = useState(plan?.thumbnailUrl ?? '')
  const [thumbOpen, setThumbOpen] = useState(false)

  // Which field is being edited ('title' | 'series' | 'tags' | 'thumb'),
  // its in-flight save, its error, and a transient per-field "Saved" flash.
  const [editingField, setEditingField] = useState<string | null>(null)
  const [fieldSaving, setFieldSaving] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const flash = (field: string) => {
    setSavedFlash(field)
    window.setTimeout(
      () => setSavedFlash((cur) => (cur === field ? null : cur)),
      2000,
    )
  }
  const errMsg = (err: unknown, fallback: string) =>
    err instanceof Error && err.message
      ? err.message
      : typeof err === 'string' && err.trim()
        ? err
        : fallback

  const parseTags = (v: string) =>
    v
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

  /** Persist a patch on top of the stored plan (edit mode only). */
  const persist = async (patch: Partial<main.PlannedStream>) => {
    if (!savedPlan) return
    const stored = await SavePlannedStream(
      main.PlannedStream.createFrom({
        id: savedPlan.id,
        title: savedPlan.title,
        description: savedPlan.description,
        channels: savedPlan.channels ?? [],
        seriesId: savedPlan.seriesId,
        episodeNumber: savedPlan.episodeNumber,
        tags: savedPlan.tags ?? [],
        thumbnailFile: savedPlan.thumbnailFile ?? '',
        createdAt: savedPlan.createdAt,
        ...patch,
      }),
    )
    setSavedPlan(stored)
    return stored
  }

  const openField = (field: string) => {
    setEditingField(field)
    setFieldError('')
  }
  const closeField = () => {
    setEditingField(null)
    setFieldError('')
  }
  /** Save one field's patch, close its editor, and flash confirmation. */
  const saveField = async (field: string, patch: Partial<main.PlannedStream>) => {
    setFieldSaving(true)
    setFieldError('')
    try {
      await persist(patch)
      closeField()
      flash(field)
    } catch (err) {
      setFieldError(errMsg(err, 'Could not save the change.'))
    } finally {
      setFieldSaving(false)
    }
  }

  // Reflect (and in edit mode persist) a thumbnail change from the editor.
  const applyThumb = async (t: {file: string; url: string}) => {
    setThumbFile(t.file)
    setThumbUrl(t.url)
    if (savedPlan) {
      await persist({thumbnailFile: t.file})
      flash('thumb')
    }
  }

  // Resetting forgets the plan was ever broadcast: sessions and the go-live
  // assignments go away, the plan stays for a future stream.
  const resetStream = async () => {
    if (!savedPlan) return
    setResetting(true)
    setError('')
    try {
      await ResetPlannedStream(savedPlan.id)
      setSession(null)
      setConfirmReset(false)
    } catch (err) {
      setError(errMsg(err, 'Could not reset the broadcast.'))
    } finally {
      setResetting(false)
    }
  }

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
        if (savedPlan && seriesId === savedPlan.seriesId) {
          setEpisode(
            savedPlan.episodeNumber ? String(savedPlan.episodeNumber) : '',
          )
        } else {
          setEpisode(String((list[list.length - 1] ?? 0) + 1))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [episodicPlan, seriesId, savedPlan])

  const episodeNum = Number(episode)
  const episodeValid =
    episode.trim() === '' || (Number.isInteger(episodeNum) && episodeNum >= 1)
  // A number already used elsewhere in the series is worth flagging, but it
  // never blocks saving — past streams and planning can legitimately drift
  // (imported history, renumbered seasons), and the user decides what's
  // right. The plan's own saved number is not a collision with itself.
  const episodeTaken =
    episodicPlan &&
    episodeValid &&
    usedEpisodes.includes(episodeNum) &&
    !(
      savedPlan &&
      savedPlan.seriesId === seriesId &&
      savedPlan.episodeNumber === episodeNum
    )

  // Channel toggles apply (and, in edit mode, save) immediately — no edit
  // state needed for what is already a single click.
  const toggleChannel = async (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
    if (!savedPlan) return
    try {
      await persist({channels: [...next]})
      flash('channels')
    } catch (err) {
      setSelected(new Set(savedPlan.channels ?? []))
      setError(errMsg(err, 'Could not save the channel selection.'))
    }
  }

  const save = async () => {
    if (!title.trim()) {
      setError('Give your stream a title.')
      return
    }
    if (episodicPlan && episode.trim() !== '' && !episodeValid) {
      setError('The episode number must be a whole number of 1 or more.')
      return
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
          thumbnailFile: thumbFile,
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

      <div className="max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">
            {editMode
              ? 'Review this planned broadcast — hover a field and choose Edit; changes save as you finish each one.'
              : 'Outline your next broadcast and choose where it goes out.'}
          </p>
          <GeneratePlanButton
            title={title}
            seriesId={seriesId}
            episodeNumber={episodicPlan && episodeValid ? episodeNum : 0}
            hasDraft={Boolean(description.trim() || tags.trim())}
            onSuggestion={(s) => {
              const nextTitle = s.title || title
              const nextDescription = s.description || description
              const nextTags =
                (s.tags ?? []).length > 0 ? (s.tags ?? []) : parseTags(tags)
              setTitle(nextTitle)
              setDescription(nextDescription)
              setTags(nextTags.join(', '))
              setDescSelection([0, 0])
              if (savedPlan) {
                persist({
                  title: nextTitle.trim(),
                  description: nextDescription.trim(),
                  tags: nextTags,
                })
                  .then(() => flash('plan'))
                  .catch((err) =>
                    setError(errMsg(err, 'Could not save the suggestion.')),
                  )
              }
            }}
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!editMode) void save()
          }}
          className="flex flex-col gap-5"
        >
          {/* Hero: identity (title + series) on the left, thumbnail on the
              right; the description spans full width below. */}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex flex-col gap-5">
          {/* The hero echoes the broadcast page: series kicker, the accent
              episode number, then the title — each editable on hover. */}
          <EditableField
            label="Title"
            editMode={editMode}
            editing={editingField === 'title'}
            saved={savedFlash === 'title'}
            saving={fieldSaving}
            error={editingField === 'title' ? fieldError : ''}
            frameless
            className="order-2"
            onEdit={() => openField('title')}
            onCancel={() => {
              setTitle(savedPlan?.title ?? '')
              closeField()
            }}
            onSave={() => {
              if (!title.trim()) {
                setFieldError('Give your stream a title.')
                return
              }
              void saveField('title', {title: title.trim()})
            }}
            view={
              <h1 className="pr-16 text-2xl font-semibold tracking-tight text-fg">
                {savedPlan?.title}
              </h1>
            }
          >
            <input
              id="plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (editMode && e.key === 'Enter') {
                  e.preventDefault()
                  if (title.trim()) void saveField('title', {title: title.trim()})
                }
              }}
              placeholder="e.g. Building the planner"
              autoFocus
              className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </EditableField>

          {series.length > 0 && (
            <EditableField
              label="Content series"
              labelExtra="(optional)"
              editMode={editMode}
              editing={editingField === 'series'}
              saved={savedFlash === 'series'}
              saving={fieldSaving}
              error={editingField === 'series' ? fieldError : ''}
              frameless
              className="order-1"
              onEdit={() => openField('series')}
              onCancel={() => {
                setSeriesId(savedPlan?.seriesId ?? '')
                closeField()
              }}
              onSave={() => {
                if (episodicPlan && episode.trim() !== '' && !episodeValid) {
                  setFieldError(
                    'The episode number must be a whole number of 1 or more.',
                  )
                  return
                }
                void saveField('series', {
                  seriesId,
                  episodeNumber:
                    episodicPlan && episode.trim() !== '' && episodeValid
                      ? episodeNum
                      : 0,
                })
              }}
              view={
                <div className="pr-16">
                  {activeSeries ? (
                    <p className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                      {activeSeries.title}
                    </p>
                  ) : (
                    <p className="text-sm text-fg-muted">No series</p>
                  )}
                  {episodicPlan && (savedPlan?.episodeNumber ?? 0) > 0 && (
                    <p className="mt-1 text-4xl font-bold tracking-tight text-accent">
                      Episode {savedPlan?.episodeNumber}
                    </p>
                  )}
                </div>
              }
            >
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
                      aria-invalid={!episodeValid}
                      className={clsx(
                        'w-full rounded-lg border bg-bg px-3 py-2 text-sm text-fg outline-none',
                        !episodeValid
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
                    !episodeValid
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-fg-muted',
                  )}
                >
                  {!episodeValid
                    ? 'Enter a whole number of 1 or more.'
                    : episodeTaken
                      ? `Heads up: episode ${episodeNum} also appears on a past stream or plan in this series — saving anyway is fine.`
                      : "Prefilled with the next episode in this series' sequence."}
                </p>
              )}

              {activeSeries && (
                <div className="mt-2 rounded-lg border border-edge bg-surface p-3 text-sm">
                  {(activeSeries.twitchCategory?.id ||
                    activeSeries.youtubeCategory?.id ||
                    activeSeries.kickCategory?.id) && (
                    <p className="text-xs font-medium text-fg-muted">
                      {[
                        activeSeries.twitchCategory?.id
                          ? `Twitch: ${activeSeries.twitchCategory.name}`
                          : '',
                        activeSeries.youtubeCategory?.id
                          ? `YouTube: ${activeSeries.youtubeCategory.name}`
                          : '',
                        activeSeries.kickCategory?.id
                          ? `Kick: ${activeSeries.kickCategory.name}`
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
            </EditableField>
          )}
          </div>

          <EditableField
            label="Thumbnail"
            labelExtra="(optional)"
            editMode={editMode}
            editing={editingField === 'thumb'}
            saved={savedFlash === 'thumb'}
            doneOnly
            frameless
            onEdit={() => openField('thumb')}
            onCancel={closeField}
            view={
              thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt="Stream thumbnail"
                  className="aspect-video w-full rounded-md border border-edge object-cover"
                />
              ) : (
                <p className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-edge text-sm text-fg-muted">
                  No thumbnail yet
                </p>
              )
            }
          >
            <PlanThumbnailEditor
              planTitle={title}
              planDescription={description}
              file={thumbFile}
              url={thumbUrl}
              history={zipThumbHistory(
                savedPlan?.thumbnailHistory,
                savedPlan?.thumbnailHistoryUrls,
              )}
              onApply={applyThumb}
              onOpenFull={() => setThumbOpen(true)}
            />
          </EditableField>
          </div>

          <div>
            <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-fg">
              Description{' '}
              <span className="font-normal text-fg-muted">(optional)</span>
              {savedFlash === 'description' && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-fg-muted">
                  <Check size={12} aria-hidden />
                  Saved
                </span>
              )}
            </span>
            <MarkdownField
              id="plan-description"
              value={description}
              onChange={setDescription}
              placeholder="What's the plan for this stream?"
              onSelectionChange={(start, end) => setDescSelection([start, end])}
              onDone={
                editMode
                  ? () => {
                      persist({description: description.trim()})
                        .then(() => flash('description'))
                        .catch((err) =>
                          setError(
                            errMsg(err, 'Could not save the description.'),
                          ),
                        )
                    }
                  : undefined
              }
            />
            <DescriptionAiActions
              description={description}
              selection={descSelection}
              onDescription={(next) => {
                setDescription(next)
                setDescSelection([0, 0])
                if (savedPlan) {
                  persist({description: next.trim()})
                    .then(() => flash('description'))
                    .catch((err) =>
                      setError(errMsg(err, 'Could not save the description.')),
                    )
                }
              }}
            />
          </div>

          <Modal
            open={thumbOpen}
            onClose={() => setThumbOpen(false)}
            title={title.trim() || 'Stream thumbnail'}
            maxWidthClass="max-w-5xl"
          >
            {thumbUrl && (
              <img
                src={thumbUrl}
                alt="Stream thumbnail, full size"
                className="w-full rounded-lg"
              />
            )}
          </Modal>

          <EditableField
            label="Tags"
            labelExtra="(comma-separated — blank uses the series' tags)"
            editMode={editMode}
            editing={editingField === 'tags'}
            saved={savedFlash === 'tags'}
            saving={fieldSaving}
            error={editingField === 'tags' ? fieldError : ''}
            onEdit={() => openField('tags')}
            onCancel={() => {
              setTags((savedPlan?.tags ?? []).join(', '))
              closeField()
            }}
            onSave={() => void saveField('tags', {tags: parseTags(tags)})}
            view={
              (savedPlan?.tags ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pr-16">
                  {(savedPlan?.tags ?? []).map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-surface-hover px-2 py-0.5 text-xs text-fg-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="pr-16 text-sm text-fg-muted">
                  {(activeSeries?.tags?.length ?? 0) > 0
                    ? `Using the series' tags: ${activeSeries!.tags.join(', ')}`
                    : 'No tags'}
                </p>
              )
            }
          >
            <input
              id="plan-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onKeyDown={(e) => {
                if (editMode && e.key === 'Enter') {
                  e.preventDefault()
                  void saveField('tags', {tags: parseTags(tags)})
                }
              }}
              placeholder={
                (activeSeries?.tags?.length ?? 0) > 0
                  ? activeSeries!.tags.join(', ')
                  : 'ai, coding, live'
              }
              className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </EditableField>

          <div>
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
              Broadcast to
              {savedFlash === 'channels' && (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-fg-muted">
                  <Check size={12} aria-hidden />
                  Saved
                </span>
              )}
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
                    onClick={() => void toggleChannel(svc.id)}
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
                        : svc.id === 'kick'
                          ? activeSeries?.kickCategory?.name ?? ''
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
                    // Content labels come from the linked series: Twitch's
                    // classification labels, YouTube's made-for-kids flag.
                    const contentLabels =
                      svc.id === 'twitch'
                        ? (activeSeries?.twitchLabels ?? []).map(
                            twitchLabelName,
                          )
                        : svc.id === 'youtube' &&
                            activeSeries?.youtubeMadeForKids
                          ? [YOUTUBE_MADE_FOR_KIDS_NAME]
                          : []
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
                          {contentLabels.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {contentLabels.map((l) => (
                                <span
                                  key={l}
                                  className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                                >
                                  {l}
                                </span>
                              ))}
                            </div>
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
                          {svc.id === 'kick' && (
                            <p className="mt-0.5 text-xs text-fg-muted/70">
                              Kick streams carry no description — title and
                              category only.
                            </p>
                          )}
                          {svc.id === 'facebook' && (
                            <p className="mt-0.5 text-xs text-fg-muted/70">
                              Retitles the Page&apos;s live video and posts a
                              go-live announcement once on the air.
                            </p>
                          )}
                          {svc.id === 'instagram' && (
                            <p className="mt-0.5 text-xs text-fg-muted/70">
                              Instagram&apos;s API can&apos;t set live info or
                              post announcements — share from the app.
                            </p>
                          )}
                          {svc.id === 'x' && (
                            <p className="mt-0.5 text-xs text-fg-muted/70">
                              Posts one go-live announcement with your watch
                              links once the stream is on the air.
                            </p>
                          )}
                          {svc.id === 'tiktok' && (
                            <p className="mt-0.5 text-xs text-fg-muted/70">
                              Posts one go-live announcement video (rendered
                              from the plan thumbnail) once on the air —
                              private until the TikTok app passes its audit.
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

          <div className="flex flex-wrap items-center gap-3">
            {!editMode && (
              <>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Creating…' : 'Create plan'}
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
                >
                  Cancel
                </button>
              </>
            )}
            {canConclude && (
              <div className="ml-auto flex items-center gap-2">
                {confirmConclude ? (
                  <>
                    <span className="text-xs text-fg-muted">
                      Keep its details on the past stream and remove the plan?
                    </span>
                    <button
                      type="button"
                      onClick={() => void conclude()}
                      disabled={concluding}
                      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {concluding ? 'Concluding…' : 'Confirm conclude'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmConclude(false)}
                      disabled={concluding}
                      className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      Keep plan
                    </button>
                  </>
                ) : confirmReset ? (
                  <>
                    <span className="text-xs text-fg-muted">
                      Forget this broadcast and keep the plan for a future
                      stream?
                    </span>
                    <button
                      type="button"
                      onClick={() => void resetStream()}
                      disabled={resetting}
                      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {resetting ? 'Resetting…' : 'Confirm reset'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      disabled={resetting}
                      className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
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
                        title="False start? Forget this broadcast — sessions and go-live assignments are cleared, the plan stays for a future stream."
                        className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                      >
                        <RotateCcw size={14} aria-hidden />
                        Reset broadcast
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmConclude(true)}
                      title="This episode has been broadcast — wrap it up as a past stream."
                      className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
                    >
                      <CheckCircle2 size={14} aria-hidden />
                      Conclude episode
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * One field of the plan form. Creating a plan (editMode false) renders the
 * editor directly — the whole form submits at once. Editing an existing plan
 * shows a read-only view with a subtle Edit CTA on hover (mirroring
 * MarkdownField); choosing it swaps in the editor with its own Save/Cancel
 * (or a single Done for fields whose actions save themselves), so each field
 * persists independently and the form needs no global Save.
 */
function EditableField({
  label,
  labelExtra,
  editMode,
  editing,
  saved,
  saving = false,
  error = '',
  doneOnly = false,
  frameless = false,
  className,
  onEdit,
  onSave,
  onCancel,
  view,
  children,
}: {
  label: string
  labelExtra?: string
  editMode: boolean
  editing: boolean
  /** Show the transient "Saved" confirmation next to the label. */
  saved: boolean
  saving?: boolean
  error?: string
  /** The field saves itself (e.g. thumbnail actions): show only Done. */
  doneOnly?: boolean
  /** Hero styling: the view renders bare (no label row, border, or padding)
   *  with the Edit CTA overlaid — the view's own typography is the label. */
  frameless?: boolean
  className?: string
  onEdit: () => void
  onSave?: () => void
  onCancel: () => void
  /** Read-only rendering of the stored value. */
  view: ReactNode
  /** The editor controls. */
  children: ReactNode
}) {
  const heading = (
    <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-fg">
      {label}
      {labelExtra && (
        <span className="font-normal text-fg-muted">{labelExtra}</span>
      )}
      {saved && !frameless && (
        <span className="inline-flex items-center gap-1 text-xs font-normal text-fg-muted">
          <Check size={12} aria-hidden />
          Saved
        </span>
      )}
    </span>
  )

  if (!editMode) {
    return (
      <div className={className}>
        {heading}
        {children}
      </div>
    )
  }

  if (!editing) {
    return (
      <div className={className}>
        {!frameless && heading}
        <div
          className={clsx(
            'group relative rounded-lg',
            !frameless && 'border border-edge bg-bg px-3 py-2.5',
          )}
        >
          {view}
          <div className="absolute right-2 top-2 flex items-center gap-1.5">
            {saved && frameless && (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs font-medium text-fg-muted shadow-sm">
                <Check size={12} aria-hidden />
                Saved
              </span>
            )}
            <button
              type="button"
              onClick={onEdit}
              title={`Edit ${label.toLowerCase()}`}
              className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-xs font-medium text-fg-muted opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg"
            >
              <Pencil size={12} aria-hidden />
              Edit
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {heading}
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {doneOnly ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
          >
            <Check size={12} aria-hidden />
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  )
}

/**
 * The "Request edits" AI helper under a description field: applies an
 * instruction to the description — scoped to the highlighted section when one
 * is selected, otherwise the whole text. Shared with the video-plan form.
 * (Whole-plan generation lives in GeneratePlanButton at the top of the form.)
 */
export function DescriptionAiActions({
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
  const aiConnected =
    (statuses['anthropic']?.connected ?? false) ||
    (statuses['openai']?.connected ?? false)

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
  const aiConnected =
    (statuses['anthropic']?.connected ?? false) ||
    (statuses['openai']?.connected ?? false)

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

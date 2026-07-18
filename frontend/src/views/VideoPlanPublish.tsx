import {
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Upload,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  GenerateVideoPlanThumbnail,
  GenerateVideoPublishFields,
  GetEditWorkspace,
  GetTikTokPublish,
  GetVideoPublish,
  GetYouTubeCategories,
  PublishPlanVideo,
  PublishPlanVideoToTikTok,
  SaveVideoPlan,
  SaveVideoPublishDraft,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'
import {
  PlanThumbnailEditor,
  zipThumbHistory,
  type PlanThumb,
} from '../components/PlanThumbnailEditor'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {formatBytes, formatDate} from '../lib/format'
import {usePlanAi} from '../plans/PlanAiProvider'
import {useServices} from '../services/ServicesProvider'
import {DescriptionAiActions} from './PlanStream'

/** Wails rejects bound-method promises with the Go error string. */
const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

const parseTags = (raw: string): string[] =>
  raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

/** The fields the AI can draft — all of them, or one on its own. */
type PublishField = 'title' | 'description' | 'tags' | 'category'

/**
 * The Publish tab of a video plan: everything the video goes out into the
 * world as. The rendered cut plays here beside its thumbnail, above the
 * listing — title, description, tags, and category — and then it uploads to the
 * connected YouTube channel.
 *
 * Nothing has to be written by hand. The first visit drafts the whole listing
 * (and the thumbnail) from the plan and the source streams' outlines; "Generate
 * with AI" redrafts it; "Request edits" takes feedback and revises what's there
 * rather than starting over; and every field — the thumbnail included — has its
 * own regenerate, so a new title never costs you an approved description. The
 * form persists as a per-plan draft, so navigating away loses nothing.
 */
export function VideoPlanPublish({
  plan,
  onPlanChange,
  onOpenEditor,
}: {
  plan: main.VideoPlan
  /** The thumbnail workbench writes onto the plan; hand the fresh one back. */
  onPlanChange: (plan: main.VideoPlan) => void
  /** Jump to the Editor tab (where the video is produced). */
  onOpenEditor: () => void
}) {
  // Short-form is a vertical video: its cover is 9:16, and so is the player.
  const short = plan.format === 'short'

  const {statuses} = useServices()
  const ytConnected = Boolean(statuses.youtube?.connected)
  const ttConnected = Boolean(statuses.tiktok?.connected)
  const aiConnected =
    Boolean(statuses.anthropic?.connected) ||
    Boolean(statuses.openai?.connected)
  const openaiConnected = Boolean(statuses.openai?.connected)

  const [outputs, setOutputs] = useState<main.EditOutput[]>([])
  const [output, setOutput] = useState('final.mp4')
  const [title, setTitle] = useState(plan.title)
  const [description, setDescription] = useState('')
  const [selection, setSelection] = useState<[number, number]>([0, 0])
  const [tags, setTags] = useState((plan.tags ?? []).join(', '))
  const [categories, setCategories] = useState<main.ServiceCategory[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [privacy, setPrivacy] = useState('public')
  const [record, setRecord] = useState<main.VideoPublishRecord | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [ttRecord, setTtRecord] = useState<main.TikTokPublishRecord | null>(
    null,
  )
  const [ttPublishing, setTtPublishing] = useState(false)
  const [ttWarning, setTtWarning] = useState('')
  const [progress, setProgress] = useState('')
  // Which fields the AI is working on right now ('' = idle, 'all' = the lot).
  const [drafting, setDrafting] = useState<PublishField | 'all' | ''>('')
  const [requesting, setRequesting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  // Guards the draft autosave until the stored draft has been applied, so a
  // mount never clobbers it with the initial values.
  const loaded = useRef(false)
  // Remounts the description editor once the stored draft is in, so it opens
  // read-only when a description exists (its view/edit mode is set on mount).
  const [ready, setReady] = useState(false)
  // The first visit pre-drafts the listing; this makes sure it happens once.
  const preDrafted = useRef(false)

  // Live mirrors, so the AI calls below always send the current form without
  // re-subscribing every keystroke.
  const formRef = useRef<main.VideoPublishDraft>()
  formRef.current = main.VideoPublishDraft.createFrom({
    output,
    title,
    description,
    tags: parseTags(tags),
    categoryId,
    privacy,
  })

  const planAi = usePlanAi()

  /**
   * Draft fields on the connected AI service. Fields empty = the whole
   * listing; feedback carries the producer's "request edits" note. Only the
   * fields that come back are touched, so regenerating one leaves the rest of
   * the producer's work alone.
   *
   * The run is owned by PlanAiProvider — a status-bar chip tracks it, and it
   * persists the result onto the stored draft itself, so navigating away
   * mid-draft loses nothing.
   */
  const draft = useCallback(
    async (fields: PublishField[], note = '') => {
      setDrafting(fields.length === 1 ? fields[0] : 'all')
      setError('')
      try {
        const s = await planAi.run('listing', plan.id, plan.title, async () => {
          const s = await GenerateVideoPublishFields(
            plan.id,
            formRef.current!,
            fields,
            note,
          )
          // Persist straight onto the stored draft: the mounted form below
          // also applies it, but a run that finishes after navigating away
          // must still land.
          const base = formRef.current!
          await SaveVideoPublishDraft(
            plan.id,
            main.VideoPublishDraft.createFrom({
              output: base.output,
              title: s.title || base.title,
              description: s.description || base.description,
              tags: (s.tags ?? []).length > 0 ? s.tags : base.tags,
              categoryId: s.categoryId || base.categoryId,
              privacy: base.privacy,
            }),
          )
          return s
        })
        if (s.title) setTitle(s.title)
        if (s.description) setDescription(s.description)
        if ((s.tags ?? []).length > 0) setTags(s.tags.join(', '))
        if (s.categoryId) setCategoryId(s.categoryId)
        setRequesting(false)
        setFeedback('')
      } catch (err) {
        setError(messageOf(err, 'The listing could not be generated.'))
      } finally {
        setDrafting('')
      }
    },
    [plan.id, plan.title, planAi],
  )

  // Nothing has been written for this plan yet and there is a video to
  // publish — the first visit should pre-draft the listing. Set during the
  // load below and acted on once the AI connection is known, so a late-
  // resolving service status never re-runs the load and clobbers the form.
  const [blankWithVideo, setBlankWithVideo] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      GetEditWorkspace(plan.id).catch(() => null),
      GetVideoPublish(plan.id).catch(() => null),
      GetYouTubeCategories().catch(() => [] as main.ServiceCategory[]),
      GetTikTokPublish(plan.id).catch(() => null),
    ]).then(([ws, st, cats, tt]) => {
      if (cancelled) return
      if (tt) setTtRecord(tt)
      const outs = ws?.outputs ?? []
      setOutputs(outs)
      // Prefer final.mp4; else whatever is rendered.
      setOutput((cur) =>
        outs.some((o) => o.name === cur) ? cur : (outs[0]?.name ?? cur),
      )
      setCategories(cats ?? [])

      if (st?.draft) {
        const draftOutput = st.draft.output
        // A draft can name an output that no longer exists (re-rendered under
        // another name, workspace cleaned); honoring it would blank the
        // player, so it only wins when the file is still there.
        if (draftOutput && outs.some((o) => o.name === draftOutput)) {
          setOutput(draftOutput)
        }
        if (st.draft.title) setTitle(st.draft.title)
        setDescription(st.draft.description ?? '')
        if ((st.draft.tags ?? []).length > 0) {
          setTags((st.draft.tags as string[]).join(', '))
        }
        if (st.draft.categoryId) setCategoryId(st.draft.categoryId)
        if (st.draft.privacy) setPrivacy(st.draft.privacy)
      }
      // No draft category yet: suggest the source series' YouTube category.
      if (!st?.draft?.categoryId && st?.defaultCategoryId) {
        setCategoryId(st.defaultCategoryId)
      }
      if (st?.record) setRecord(main.VideoPublishRecord.createFrom(st.record))
      setPublishing(st?.publishing ?? false)
      loaded.current = true
      setReady(true)
      setBlankWithVideo(!st?.draft && outs.length > 0)
    })
    return () => {
      cancelled = true
    }
  }, [plan.id])

  // The first visit drafts the whole listing, so the producer arrives at
  // something to react to rather than a blank form. Saving the draft (above,
  // debounced) is what makes this a once-only.
  useEffect(() => {
    if (!blankWithVideo || !aiConnected || preDrafted.current) return
    preDrafted.current = true
    void draft([])
  }, [blankWithVideo, aiConnected, draft])

  // Upload progress for this plan streams in as events.
  useEffect(
    () =>
      EventsOn('publish:progress', (planId: string, detail: string) => {
        if (planId === plan.id) setProgress(detail)
      }),
    [plan.id],
  )

  // Persist the form as a per-plan draft (debounced) once loaded.
  useEffect(() => {
    if (!loaded.current) return
    const id = window.setTimeout(() => {
      void SaveVideoPublishDraft(
        plan.id,
        main.VideoPublishDraft.createFrom({
          output,
          title,
          description,
          tags: parseTags(tags),
          categoryId,
          privacy,
        }),
      ).catch(() => {})
    }, 800)
    return () => window.clearTimeout(id)
  }, [plan.id, output, title, description, tags, categoryId, privacy])

  // The thumbnail workbench persists straight onto the plan (the backend folds
  // the replaced image into the plan's thumbnail history).
  const applyThumb = async (t: PlanThumb) => {
    const saved = await SaveVideoPlan(
      main.VideoPlan.createFrom({
        id: plan.id,
        title: plan.title,
        description: plan.description,
        format: plan.format,
        tags: plan.tags ?? [],
        streams: plan.streams ?? [],
        thumbnailFile: t.file,
        createdAt: plan.createdAt,
      }),
    )
    onPlanChange(saved)
  }

  const publish = async () => {
    if (!title.trim()) {
      setError('Give the video a title first.')
      return
    }
    if (categories.length > 0 && !categoryId) {
      setError('Pick the video’s category.')
      return
    }
    setPublishing(true)
    setError('')
    setWarning('')
    setProgress('Starting the upload…')
    try {
      // Persist the draft as-published before the long upload.
      await SaveVideoPublishDraft(
        plan.id,
        main.VideoPublishDraft.createFrom({
          output,
          title: title.trim(),
          description,
          tags: parseTags(tags),
          categoryId,
          privacy,
        }),
      ).catch(() => {})
      const rec = await PublishPlanVideo(
        plan.id,
        output,
        title.trim(),
        description,
        parseTags(tags),
        categoryId,
        privacy,
      )
      setRecord(rec)
      if (rec.warning) setWarning(rec.warning)
    } catch (err) {
      setError(messageOf(err, 'The video could not be published.'))
    } finally {
      setPublishing(false)
      setProgress('')
    }
  }

  const publishTikTok = async () => {
    if (!title.trim()) {
      setError('Give the video a title first — it becomes the TikTok caption.')
      return
    }
    setTtPublishing(true)
    setError('')
    setTtWarning('')
    try {
      const rec = await PublishPlanVideoToTikTok(
        plan.id,
        output,
        title.trim(),
        description,
      )
      setTtRecord(rec)
      if (rec.warning) setTtWarning(rec.warning)
    } catch (err) {
      setError(messageOf(err, 'The video could not be posted to TikTok.'))
    } finally {
      setTtPublishing(false)
      setProgress('')
    }
  }

  const selectedOutput = outputs.find((o) => o.name === output)
  const busy = drafting !== '' || publishing || ttPublishing
  const hasListing = Boolean(title.trim() || description.trim() || tags.trim())

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Already published: the live record, above the form (which stays
          usable for publishing an updated cut as a new video). */}
      {record && (
        <section
          aria-label="Published video"
          className="flex items-start gap-3 rounded-xl border border-green-600/40 bg-green-600/10 p-4"
        >
          <CheckCircle2
            size={18}
            aria-hidden
            className="mt-0.5 shrink-0 text-green-600 dark:text-green-400"
          />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-fg">
              Published — {record.title || 'video'}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {record.file} · {formatDate(record.publishedAt)}
              {record.thumbPushed ? ' · thumbnail set' : ''}
            </p>
            <a
              href={record.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <ExternalLink size={12} aria-hidden />
              {record.url}
            </a>
          </div>
        </section>
      )}

      {outputs.length === 0 && (
        <p className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-fg-muted">
          No video yet —{' '}
          <button
            type="button"
            onClick={onOpenEditor}
            className="font-semibold text-accent hover:underline"
          >
            produce it on the Editor tab
          </button>{' '}
          first.
        </p>
      )}
      {!ytConnected && (
        <p className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-fg-muted">
          Connect YouTube in Settings → Services to publish videos.
        </p>
      )}

      {/* The video as it will go out: its thumbnail beside the cut itself. */}
      <section
        aria-labelledby="publish-video-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h2
            id="publish-video-heading"
            className="text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            The video
          </h2>
          {outputs.length > 1 && (
            <select
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              disabled={publishing}
              className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs text-fg outline-none focus:border-accent disabled:opacity-60"
            >
              {outputs.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* The cut, playable right here. */}
          <div className="flex flex-col gap-1.5">
            {selectedOutput ? (
              <>
                <video
                  key={`${selectedOutput.mediaUrl}#${selectedOutput.modifiedAt}`}
                  src={`${selectedOutput.mediaUrl}${
                    selectedOutput.mediaUrl.includes('?') ? '&' : '?'
                  }v=${encodeURIComponent(selectedOutput.modifiedAt)}`}
                  controls
                  poster={plan.thumbnailUrl || undefined}
                  className={clsx(
                    'rounded-md border border-edge bg-black',
                    short ? 'aspect-[9/16] w-48' : 'aspect-video w-full',
                  )}
                />
                <p className="text-xs text-fg-muted">
                  {selectedOutput.name} ·{' '}
                  {formatBytes(selectedOutput.sizeBytes)} · rendered{' '}
                  {formatDate(selectedOutput.modifiedAt)}
                </p>
              </>
            ) : (
              <span
                aria-hidden
                className="flex aspect-video w-full items-center justify-center rounded-md border border-edge bg-surface-hover text-fg-muted"
              >
                <ImageIcon size={20} />
              </span>
            )}
          </div>

          {/* The thumbnail: generate, request changes, upload, or restore a
              previous one — every change saves onto the plan immediately, and
              rides onto the YouTube video after the upload. */}
          <div className="flex flex-col gap-1.5">
            <PlanThumbnailEditor
              planTitle={title || plan.title}
              planDescription={description || plan.description}
              file={plan.thumbnailFile}
              url={plan.thumbnailUrl}
              // A short is a vertical video, so its cover is 9:16.
              vertical={short}
              history={zipThumbHistory(
                plan.thumbnailHistory,
                plan.thumbnailHistoryUrls,
              )}
              onApply={applyThumb}
              // The run is owned by PlanAiProvider (status-bar chip) and
              // applies its result itself, so a generation that finishes
              // after navigating away still lands on the plan; the mounted
              // editor's own onApply is then a no-op for the history.
              onGenerate={(feedback, currentFile) =>
                planAi.run(
                  'thumbnail',
                  plan.id,
                  title || plan.title,
                  async () => {
                    const t = await GenerateVideoPlanThumbnail(
                      plan.id,
                      title || plan.title,
                      description || plan.description,
                      feedback,
                      currentFile,
                    )
                    await applyThumb({file: t.file, url: t.url})
                    return t
                  },
                )
              }
              generateTip={`Generated ${
                short ? '9:16 vertical (short form)' : '16:9 (long form)'
              } from this video's title, description, and your brand assets (Profile → Brand Assets). The style guide lives in Settings → Skills → Stream thumbnails.`}
            />
            {!plan.thumbnailUrl && openaiConnected && (
              <p className="text-xs text-fg-muted">
                No thumbnail yet — the video would publish without a custom one.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* The listing: title, description, tags, category. Drafted whole,
          revised from feedback, or regenerated one field at a time. */}
      <section
        aria-labelledby="publish-details-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="publish-details-heading"
            className="text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            Listing
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {hasListing && (
              <button
                type="button"
                onClick={() => setRequesting((open) => !open)}
                disabled={!aiConnected || busy}
                title="Describe what should change and the AI revises the current title, description, tags, and category"
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <MessageSquarePlus size={14} aria-hidden />
                Request edits
              </button>
            )}
            <button
              type="button"
              onClick={() => void draft([])}
              disabled={!aiConnected || busy}
              title={
                aiConnected
                  ? 'Draft the whole listing from the plan and the source streams’ outlines. The guides are Settings → Skills → Preparing videos to publish and Published video descriptions.'
                  : 'Connect Anthropic or OpenAI in Settings → AI to draft the listing.'
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {drafting === 'all' ? (
                <Loader2 size={14} aria-hidden className="animate-spin" />
              ) : (
                <Sparkles size={14} aria-hidden />
              )}
              {drafting === 'all'
                ? 'Drafting…'
                : hasListing
                  ? 'Generate with AI'
                  : 'Generate with AI'}
            </button>
          </div>
        </div>

        {/* Request edits: the feedback revises what's already in the form. */}
        {requesting && (
          <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
            <label
              htmlFor="publish-feedback"
              className="text-sm font-medium text-fg"
            >
              What should change about the listing?
            </label>
            <textarea
              id="publish-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Markdown welcome. e.g. Lead the title with the boss name; cut the second paragraph; add tags for the speedrun angle; the tone is too formal."
              className="w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void draft([], feedback)}
                disabled={busy || !feedback.trim()}
                title={
                  feedback.trim()
                    ? 'Revise the current title, description, tags, and category with this feedback'
                    : 'Describe the changes first'
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {drafting === 'all' ? (
                  <Loader2 size={14} aria-hidden className="animate-spin" />
                ) : (
                  <Send size={14} aria-hidden />
                )}
                {drafting === 'all' ? 'Revising…' : 'Send feedback'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRequesting(false)
                  setFeedback('')
                }}
                disabled={busy}
                className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-fg-muted">
              The feedback is applied against what&apos;s in the form now —
              anything you don&apos;t mention is kept.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <FieldLabel
            htmlFor="publish-title"
            label="Title"
            busy={drafting === 'title'}
            disabled={!aiConnected || busy}
            onRegenerate={() => void draft(['title'])}
            tip="Rewrite just the title — the description, tags, and category are left alone."
          />
          <input
            id="publish-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={publishing}
            maxLength={100}
            className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="publish-description"
            className="text-sm font-medium text-fg"
          >
            Description
          </label>
          {/* Read-only rendered view until its Edit CTA is pressed; the
              Regenerate CTA lives in the editor's toolbar. Keyed on ready so
              a stored description opens in view mode, not the editor. */}
          <MarkdownField
            key={ready ? 'ready' : 'loading'}
            id="publish-description"
            value={description}
            onChange={setDescription}
            onSelectionChange={(start, end) => setSelection([start, end])}
            placeholder="The YouTube description — published verbatim. Generate it above: it summarizes the video from the source outlines and links the original full-length broadcast above your brand links."
            actions={
              <button
                type="button"
                onClick={() => void draft(['description'])}
                disabled={!aiConnected || busy}
                title="Rewrite just the description — the title, tags, and category are left alone."
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-accent disabled:opacity-40"
              >
                {drafting === 'description' ? (
                  <Loader2 size={12} aria-hidden className="animate-spin" />
                ) : (
                  <Sparkles size={12} aria-hidden />
                )}
                {drafting === 'description' ? 'Drafting…' : 'Regenerate'}
              </button>
            }
          />
          {/* Highlight a passage to rewrite just that part, or edit the whole
              text — the same AI actions the broadcast-plan form has. */}
          <DescriptionAiActions
            description={description}
            selection={selection}
            onDescription={setDescription}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel
            htmlFor="publish-tags"
            label="Tags"
            busy={drafting === 'tags'}
            disabled={!aiConnected || busy}
            onRegenerate={() => void draft(['tags'])}
            tip="Rewrite just the tags — everything else is left alone."
          />
          <input
            id="publish-tags"
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            disabled={publishing}
            placeholder="comma, separated, tags"
            className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-60"
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel
              htmlFor="publish-category"
              label="Category"
              busy={drafting === 'category'}
              disabled={!aiConnected || busy || categories.length === 0}
              onRegenerate={() => void draft(['category'])}
              tip="Let the AI pick the category from what the video actually is."
            />
            <select
              id="publish-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={publishing || categories.length === 0}
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-60"
            >
              <option value="">
                {categories.length === 0
                  ? 'Connect YouTube to load categories'
                  : 'Pick a category…'}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            Visibility
            <select
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
              disabled={publishing}
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm font-normal text-fg outline-none focus:border-accent disabled:opacity-60"
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {warning && (
        <p className="text-sm text-amber-600 dark:text-amber-400">{warning}</p>
      )}

      {/* TikTok: the caption is the title and description together, and the
          account's own privacy rules decide how public the post can be. */}
      {ttConnected && (
        <section
          aria-label="TikTok"
          className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">TikTok</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {ttRecord
                  ? `Posted ${formatDate(ttRecord.publishedAt)}${
                      ttRecord.privacy === 'SELF_ONLY' ? ' · private' : ''
                    }`
                  : 'The title and description go up together as the caption.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {ttRecord?.url && (
                <a
                  href={ttRecord.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                >
                  <ExternalLink size={12} aria-hidden />
                  View
                </a>
              )}
              <button
                type="button"
                onClick={() => void publishTikTok()}
                disabled={busy || outputs.length === 0}
                title={
                  outputs.length === 0
                    ? 'Produce the video on the Editor tab first'
                    : ttRecord
                      ? 'Post the current cut to TikTok again'
                      : 'Post this video to TikTok'
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ttPublishing ? (
                  <Loader2 size={14} aria-hidden className="animate-spin" />
                ) : (
                  <Upload size={14} aria-hidden />
                )}
                {ttPublishing
                  ? 'Posting…'
                  : ttRecord
                    ? 'Post again'
                    : 'Publish to TikTok'}
              </button>
            </div>
          </div>
          {ttWarning && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {ttWarning}
            </p>
          )}
        </section>
      )}

      <div className="flex items-center gap-3 border-t border-edge pt-5">
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy || !ytConnected || outputs.length === 0}
          title={
            !ytConnected
              ? 'Connect YouTube in Settings → Services first'
              : outputs.length === 0
                ? 'Produce the video on the Editor tab first'
                : record
                  ? 'Upload the current cut as a new YouTube video'
                  : 'Upload the video to YouTube with these details'
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {publishing ? (
            <Loader2 size={14} aria-hidden className="animate-spin" />
          ) : (
            <Upload size={14} aria-hidden />
          )}
          {publishing
            ? 'Publishing…'
            : record
              ? 'Publish again'
              : 'Publish to YouTube'}
        </button>
        {publishing && progress && (
          <span className="text-xs text-fg-muted">{progress}</span>
        )}
      </div>
    </div>
  )
}

/**
 * A field's label with its own AI regenerate — the point being that a new
 * title never costs you a description you already approved.
 */
function FieldLabel({
  htmlFor,
  label,
  busy,
  disabled,
  onRegenerate,
  tip,
}: {
  htmlFor: string
  label: string
  busy: boolean
  disabled: boolean
  onRegenerate: () => void
  tip: string
}) {
  return (
    <span className="flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={disabled}
        title={tip}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-accent disabled:opacity-40"
      >
        {busy ? (
          <Loader2 size={12} aria-hidden className="animate-spin" />
        ) : (
          <Sparkles size={12} aria-hidden />
        )}
        {busy ? 'Drafting…' : 'Regenerate'}
      </button>
    </span>
  )
}

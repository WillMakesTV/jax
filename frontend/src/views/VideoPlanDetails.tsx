import {
  Check,
  CheckCircle2,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  Link2,
  Loader2,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
  Upload,
  UploadCloud,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  CompleteVideoPlan,
  DeleteVideoPlan,
  GetPastStreams,
  GetTrackedVideos,
  GetVideoPlans,
  GetVideos,
  ReopenVideoPlan,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EpisodeThumb} from '../components/EpisodeThumb'
import {Modal} from '../components/Modal'
import {PlatformPill} from '../components/PlatformPill'
import {TrackedSharesModal} from '../components/TrackedSharesModal'
import {useDownloads} from '../downloads/useDownloads'
import {openExternal} from '../lib/browser'
import {formatCompact, formatDate} from '../lib/format'
import {VideoPlanEditor} from './VideoPlanEditor'
import {VideoPlanPublish} from './VideoPlanPublish'

export type VideoPlanTab = 'content' | 'editor' | 'publish'

const TABS: {id: VideoPlanTab; label: string; icon: typeof Clapperboard}[] = [
  {id: 'content', label: 'Content', icon: Clapperboard},
  {id: 'editor', label: 'Editor', icon: Scissors},
  {id: 'publish', label: 'Publish', icon: Upload},
]

/** A share URL reduced to its host, which is all the row needs to say. */
const shareHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** One tracked posting in the Shares list: platform, host, views, and the
 *  Copy / Open actions for its remote URL. */
function ShareRow({share: s}: {share: main.TrackedShare}) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard
      ?.writeText(s.url)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <li className="flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2">
      {s.platform ? (
        <PlatformPill platform={s.platform} />
      ) : (
        <span className="rounded-full border border-edge px-2.5 py-1 text-xs text-fg-muted">
          Other
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">
          {shareHost(s.url)}
        </span>
        <span className="block text-xs text-fg-muted">
          {[
            s.video
              ? `${formatCompact(s.video.viewCount)} views`
              : 'views unknown',
            s.source === 'publish' ? 'published from Jax' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      {s.source === 'publish' && (
        <UploadCloud size={14} aria-hidden className="shrink-0 text-fg-muted" />
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${shareHost(s.url)} link`}
        title={copied ? 'Copied' : 'Copy link'}
        className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        {copied ? (
          <Check size={14} aria-hidden className="text-emerald-500" />
        ) : (
          <Copy size={14} aria-hidden />
        )}
      </button>
      <button
        type="button"
        onClick={() => openExternal(s.url)}
        aria-label={`Open ${shareHost(s.url)}`}
        title="Open"
        className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <ExternalLink size={14} aria-hidden />
      </button>
    </li>
  )
}

/**
 * A video plan's view page, opened from the planned-video cards on the Videos
 * page, in three tabs that follow the video from raw footage to published:
 * Content (the source streams and their downloaded footage), Editor (the AI
 * edit session, the rendered video, and the manual timeline), and Publish (the
 * thumbnail, the title/description/tags/category, and the upload).
 */
export function VideoPlanDetails({
  plan: initial,
  initialTab,
  onEdit,
  onOpenStream,
  onAddContent,
  onDeleted,
}: {
  plan: main.VideoPlan
  /** Tab to land on; navigation (e.g. the status bar's edit-session chip)
   *  sets it. */
  initialTab?: VideoPlanTab
  /** Open the edit form for this plan. */
  onEdit: (plan: main.VideoPlan) => void
  /** Open a source stream's details view. */
  onOpenStream: (stream: main.PastStream) => void
  /** Open the Add content page for this plan. */
  onAddContent: (plan: main.VideoPlan) => void
  /** The plan was deleted; leave the page. */
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState<'' | 'complete' | 'delete'>('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<VideoPlanTab>(initialTab ?? 'content')
  // Navigating here again with an explicit tab (same mounted component, new
  // nav entry) should switch to it.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])
  // The video playing in the modal (a downloaded source or a rendered
  // output); null = closed.
  const [playing, setPlaying] = useState<{
    title: string
    url: string
    poster?: string
  } | null>(null)

  // The nav entry's copy can be stale (e.g. returning here through history
  // after an edit); re-read the plan by id on mount.
  const [plan, setPlan] = useState(initial)
  useEffect(() => {
    setPlan(initial)
    GetVideoPlans()
      .then((ps) => {
        const fresh = (ps ?? []).find((p) => p.id === initial.id)
        if (fresh) setPlan(fresh)
      })
      .catch(() => {})
  }, [initial])

  // Past streams resolve the plan's source references to thumbnails, episode
  // numbers, and broadcast URLs (cached backend read; fine on mount).
  const [pastStreams, setPastStreams] = useState<main.PastStream[]>([])
  const [streamsLoaded, setStreamsLoaded] = useState(false)
  useEffect(() => {
    GetPastStreams(false)
      .then((s) => setPastStreams(s ?? []))
      .catch(() => {})
      .finally(() => setStreamsLoaded(true))
  }, [])

  // Downloads on disk, matched to each source stream through its broadcast
  // URLs — the same lookup the stream-details page uses.
  const {byUrl} = useDownloads()

  const sources = plan.streams ?? []
  const short = plan.format === 'short'
  const FormatIcon = short ? Zap : Film
  const done = plan.status === 'completed'

  // A completed plan is a Tracked Video; its entry (publish records + share
  // links + live view counts) backs the Shares section and the modal.
  const [tracked, setTracked] = useState<main.TrackedVideo | null>(null)
  const [sharesOpen, setSharesOpen] = useState(false)
  const [refreshingShares, setRefreshingShares] = useState(false)
  useEffect(() => {
    if (!done) {
      setTracked(null)
      setSharesOpen(false)
      return
    }
    let cancelled = false
    GetTrackedVideos()
      .then((all) => {
        if (cancelled) return
        setTracked((all ?? []).find((t) => t.plan.id === plan.id) ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [done, plan.id])

  // The share view counts come from the backend's 1-hour platform cache;
  // refreshing forces a fresh platform fetch, then re-joins this entry.
  const refreshShares = async () => {
    setRefreshingShares(true)
    try {
      await GetVideos(true)
      const all = await GetTrackedVideos()
      setTracked((all ?? []).find((t) => t.plan.id === plan.id) ?? null)
    } catch {
      // The stale numbers stay; the platforms will answer next time.
    } finally {
      setRefreshingShares(false)
    }
  }

  const toggleComplete = async () => {
    setBusy('complete')
    setError('')
    try {
      setPlan(
        done
          ? await ReopenVideoPlan(plan.id)
          : await CompleteVideoPlan(plan.id),
      )
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The plan could not be updated.',
      )
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    setBusy('delete')
    setError('')
    try {
      await DeleteVideoPlan(plan.id)
      onDeleted()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The plan could not be deleted.',
      )
      setConfirmDelete(false)
      setBusy('')
    }
  }

  // Each source reference resolved to its past stream and downloaded copy.
  const resolved = sources.map((src) => {
    const stream = pastStreams.find((s) => s.startedAt === src.startedAt)
    const download = (stream?.broadcasts ?? [])
      .map((b) => byUrl.get(b.url))
      .find(Boolean)
    return {src, stream, download}
  })
  const missing = resolved.filter((r) => !r.download)

  return (
    <div className="flex flex-col">
      {/* No local back link: the top bar's global back covers it. */}
      {/* The plan's identity and actions, shared by every tab: the title
          takes the full width, with the CTAs on their own row beneath. */}
      <header className="mb-6 flex max-w-3xl flex-col gap-4">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
            <FormatIcon size={12} aria-hidden />
            {short ? 'Short form' : 'Long form'}
          </span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
            {plan.title || 'Untitled video plan'}
          </h1>
          {plan.createdAt && (
            <p className="mt-1 text-xs text-fg-muted">
              Planned {formatDate(plan.createdAt)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A tracked video can pick up share links after the fact — where
              else it was posted (TikTok, Instagram, anywhere); their views
              join the video's total. */}
          {done && (
            <button
              type="button"
              onClick={() => setSharesOpen(true)}
              disabled={!tracked}
              title="Add links to the other platforms this video was shared on — their views join the video's total"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              <Link2 size={14} aria-hidden />
              Share links
              {tracked && tracked.shares.length > 0 && (
                <span className="rounded-full bg-accent/15 px-1.5 text-xs font-semibold text-accent">
                  {tracked.shares.length}
                </span>
              )}
            </button>
          )}
          {/* Source more streams or add fresh footage on the plan's own Add
              content page — the wizard's content choices, applied
              immediately. */}
          {!done && (
            <button
              type="button"
              onClick={() => onAddContent(plan)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
            >
              <Plus size={14} aria-hidden />
              Add Content
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(plan)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
          >
            <Pencil size={14} aria-hidden />
            Edit plan
          </button>
          {/* A published video is done being produced: completing it moves the
              plan out of the planned list and into Tracked Videos. Nothing is
              thrown away, so it can be pulled back into production. */}
          <button
            type="button"
            onClick={() => void toggleComplete()}
            disabled={busy !== ''}
            title={
              done
                ? 'Pull this video back into production — it returns to the planned list'
                : 'Mark this video published and done. It leaves the planned list and becomes a Tracked Video; the workspace, renders, and history all stay.'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {busy === 'complete' ? (
              <Loader2 size={14} aria-hidden className="animate-spin" />
            ) : done ? (
              <RotateCcw size={14} aria-hidden />
            ) : (
              <CheckCircle2 size={14} aria-hidden />
            )}
            {done ? 'Reopen' : 'Complete'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== ''}
            title="Delete this plan"
            aria-label="Delete this plan"
            className="inline-flex items-center justify-center rounded-lg border border-edge bg-surface p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </header>

      {done && (
        <p className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-lg border border-green-600/40 bg-green-600/10 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400">
          <CheckCircle2 size={13} aria-hidden />
          Completed{plan.completedAt
            ? ` ${formatDate(plan.completedAt)}`
            : ''}{' '}
          — this video is tracked, not planned.
        </p>
      )}

      {error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Deleting takes the workspace with it, so it asks first. */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this video plan?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            <span className="font-semibold text-fg">
              {plan.title || 'This plan'}
            </span>{' '}
            and everything the app kept for it — the script, the timeline, the
            publish draft, and the edit workspace on disk with its rendered
            videos and revision history — are removed. Any video already
            published to YouTube stays up. This cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={busy === 'delete'}
              className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy === 'delete'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'delete' ? (
                <Loader2 size={14} aria-hidden className="animate-spin" />
              ) : (
                <Trash2 size={14} aria-hidden />
              )}
              {busy === 'delete' ? 'Deleting…' : 'Delete the plan'}
            </button>
          </div>
        </div>
      </Modal>

      <div
        role="tablist"
        aria-label="Video plan sections"
        className="mb-6 flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-accent text-accent-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            <t.icon size={15} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content: the source streams this video draws from, and the footage of
          theirs that is actually on disk to edit with. Once the plan is
          tracked, the published video's thumbnail (from the Publish tab)
          leads the tab instead of the source-stream grid — the footage lists
          below keep the paths back to the material. */}
      {tab === 'content' && (
        <div className="flex max-w-3xl flex-col gap-6">
          {/* Tracked plans lead with the video's face and where it lives:
              thumbnail on the left, the shares (with views and the
              aggregate) to its right. */}
          {done && (plan.thumbnailUrl || tracked) && (
            <div className="flex flex-wrap items-start gap-6">
              {plan.thumbnailUrl && (
                <section
                  aria-labelledby="video-plan-thumb-heading"
                  className="shrink-0"
                >
                  <h2
                    id="video-plan-thumb-heading"
                    className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted"
                  >
                    Thumbnail
                  </h2>
                  <img
                    src={plan.thumbnailUrl}
                    alt="The video's thumbnail"
                    className={clsx(
                      'rounded-xl border border-edge bg-black object-cover',
                      short ? 'aspect-[9/16] w-48' : 'aspect-video w-72',
                    )}
                  />
                </section>
              )}
              {/* Every place the tracked video lives, with its views and the
              aggregate; Refresh re-asks the platforms for today's numbers. */}
              {tracked && (
                <section
                  aria-labelledby="video-plan-shares-heading"
                  className="min-w-0 flex-1 basis-64"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2
                      id="video-plan-shares-heading"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
                    >
                      <Link2 size={13} aria-hidden />
                      Shares
                      {tracked.totalViews > 0 && (
                        <span className="normal-case tracking-normal">
                          · {formatCompact(tracked.totalViews)} views in total
                        </span>
                      )}
                    </h2>
                    <button
                      type="button"
                      onClick={() => void refreshShares()}
                      disabled={refreshingShares}
                      title="Fetch the latest view counts from the platforms"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      <RefreshCw
                        size={12}
                        aria-hidden
                        className={clsx(refreshingShares && 'animate-spin')}
                      />
                      Refresh
                    </button>
                  </div>
                  {tracked.shares.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      No postings recorded yet — use Share links above to add
                      where this video was shared, and its views will count
                      here.
                    </p>
                  ) : (
                    <ul className="flex max-w-xl flex-col gap-2">
                      {tracked.shares.map((s) => (
                        <ShareRow key={s.url} share={s} />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          )}
          {sources.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No source streams referenced yet — add them on the plan&apos;s
              edit page and their downloaded videos will appear here.
            </p>
          ) : !streamsLoaded ? (
            <p className="text-sm text-fg-muted">Loading past streams…</p>
          ) : (
            <>
              {!done && (
                <section aria-labelledby="video-plan-sources-heading">
                  <h2
                    id="video-plan-sources-heading"
                    className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
                  >
                    <Radio size={13} aria-hidden />
                    Source streams ({sources.length})
                  </h2>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {resolved.map(({src, stream}) => {
                      const tile = (
                        <EpisodeThumb
                          title={stream?.title || src.title}
                          startedAt={src.startedAt}
                          thumbnailUrl={stream?.thumbnailUrl}
                          episodeNumber={stream?.episodeNumber}
                        />
                      )
                      return (
                        <li key={src.startedAt}>
                          {stream ? (
                            <button
                              type="button"
                              onClick={() => onOpenStream(stream)}
                              aria-label={`Open details for ${stream.title || 'untitled stream'}`}
                              className="flex w-full flex-col overflow-hidden rounded-xl border border-edge bg-surface text-left transition-colors hover:bg-surface-hover"
                            >
                              {tile}
                            </button>
                          ) : (
                            // The reference no longer resolves to a past stream;
                            // show what the plan recorded, without a link.
                            <div className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface">
                              {tile}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {/* Sources whose footage is not on disk yet; the stream's
                  details page carries the Download action. */}
              {missing.length > 0 && (
                <section aria-labelledby="video-plan-missing-heading">
                  <h2
                    id="video-plan-missing-heading"
                    className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted"
                  >
                    Not downloaded yet
                  </h2>
                  <ul className="flex max-w-xl flex-col gap-2">
                    {missing.map(({src, stream}) => (
                      <li key={src.startedAt}>
                        <button
                          type="button"
                          onClick={() => stream && onOpenStream(stream)}
                          disabled={!stream}
                          title={
                            stream
                              ? 'Open the stream — its details page has the Download action'
                              : 'This reference no longer resolves to a past stream'
                          }
                          className="flex w-full items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2 text-left transition-colors enabled:hover:bg-surface-hover disabled:opacity-60"
                        >
                          <span
                            aria-hidden
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted"
                          >
                            <Radio size={13} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-fg">
                            {stream?.title || src.title || 'Untitled stream'}
                          </span>
                          <span className="shrink-0 text-xs text-fg-muted">
                            {formatDate(src.startedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* Imported footage — files picked from disk or recorded straight
              from OBS into the plan's workspace. Shown regardless of source
              streams, so a footage-only plan still sees its material. */}
          {(plan.files ?? []).length > 0 && (
            <section aria-labelledby="video-plan-additional-footage-heading">
              <h2
                id="video-plan-additional-footage-heading"
                className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
              >
                <Film size={13} aria-hidden />
                Additional Footage ({(plan.files ?? []).length})
              </h2>
              <ul className="flex max-w-xl flex-col gap-2">
                {(plan.files ?? []).map((name, i) => {
                  const url = plan.fileUrls?.[i] ?? ''
                  return (
                    <li
                      key={name}
                      className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-2"
                    >
                      {/* The tile IS the file's own footage: a muted video
                          element parked half a second in renders that frame
                          as the thumbnail, straight off the media server. */}
                      <button
                        type="button"
                        onClick={() => url && setPlaying({title: name, url})}
                        disabled={!url}
                        aria-label={`Play ${name}`}
                        title={
                          url
                            ? 'Play video'
                            : 'The file could not be found in the workspace'
                        }
                        className="group relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-hover text-fg disabled:opacity-50"
                      >
                        {url && (
                          <video
                            src={`${url}#t=0.5`}
                            preload="metadata"
                            muted
                            playsInline
                            aria-hidden
                            className="pointer-events-none absolute inset-0 h-full w-full bg-black object-cover"
                          />
                        )}
                        <span
                          className={clsx(
                            'relative flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                            url
                              ? 'bg-black/50 text-white group-hover:bg-accent group-hover:text-accent-fg'
                              : 'text-fg',
                          )}
                        >
                          <Play size={14} aria-hidden className="ml-0.5" />
                        </span>
                      </button>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {name}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === 'editor' && (
        <VideoPlanEditor
          plan={plan}
          onPlay={(title, url) => setPlaying({title, url})}
          onPublish={() => setTab('publish')}
        />
      )}

      {tab === 'publish' && (
        <VideoPlanPublish
          plan={plan}
          onPlanChange={setPlan}
          onOpenEditor={() => setTab('editor')}
        />
      )}

      {/* Share links of the tracked video; every change saves immediately
          and hands back the re-aggregated entry. */}
      <TrackedSharesModal
        tracked={sharesOpen ? tracked : null}
        onClose={() => setSharesOpen(false)}
        onSaved={(updated) => {
          setTracked(updated)
          setPlan(updated.plan)
        }}
      />

      {/* Quick playback of a source or rendered video; the modal unmounts
          the player on close, which stops playback. */}
      <Modal
        open={playing !== null}
        onClose={() => setPlaying(null)}
        title={playing?.title || 'Video'}
        maxWidthClass="max-w-3xl"
      >
        {playing && (
          <video
            key={playing.url}
            controls
            autoPlay
            poster={playing.poster}
            src={playing.url}
            className="aspect-video w-full rounded-lg bg-black"
          />
        )}
      </Modal>
    </div>
  )
}

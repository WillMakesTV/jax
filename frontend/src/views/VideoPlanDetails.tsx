import {
  ArrowLeft,
  Clapperboard,
  Film,
  LayoutGrid,
  Pencil,
  Play,
  Radio,
  Scissors,
  Tag,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {GetPastStreams, GetVideoPlans} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {DownloadThumb} from '../components/DownloadThumb'
import {EpisodeThumb} from '../components/EpisodeThumb'
import {Markdown} from '../components/markdown/Markdown'
import {Modal} from '../components/Modal'
import {useDownloads} from '../downloads/useDownloads'
import {formatDate, formatDurationMs} from '../lib/format'
import {VideoPlanEditor} from './VideoPlanEditor'

export type VideoPlanTab = 'dashboard' | 'content' | 'editor'

const TABS: {id: VideoPlanTab; label: string; icon: typeof LayoutGrid}[] = [
  {id: 'dashboard', label: 'Video Plan Dashboard', icon: LayoutGrid},
  {id: 'content', label: 'Content', icon: Clapperboard},
  {id: 'editor', label: 'Editor', icon: Scissors},
]

/**
 * A video plan's view page, opened from the planned-video cards on the Videos
 * page, in tabs: the Video Plan Dashboard (the plan in full — format,
 * description, tags, and the source streams it draws from as a thumbnail
 * grid) and Content (the downloaded videos of those source streams — the
 * actual footage on disk to edit from). An Edit action leads to the edit
 * form.
 */
export function VideoPlanDetails({
  plan: initial,
  initialTab,
  onBack,
  onEdit,
  onOpenStream,
  onOpenDownload,
  onComposeDirections,
}: {
  plan: main.VideoPlan
  /** Tab to land on; navigation (e.g. returning from the directions page
   *  after starting a session) sets it. */
  initialTab?: VideoPlanTab
  onBack: () => void
  /** Open the edit form for this plan. */
  onEdit: (plan: main.VideoPlan) => void
  /** Open a source stream's details view. */
  onOpenStream: (stream: main.PastStream) => void
  /** Open a downloaded broadcast's video page (player + chat + transcript). */
  onOpenDownload: (download: main.DownloadedVideo) => void
  /** Open the edit-session directions page (the AI note builder). */
  onComposeDirections: (plan: main.VideoPlan) => void
}) {
  const [tab, setTab] = useState<VideoPlanTab>(initialTab ?? 'dashboard')
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
  const tags = plan.tags ?? []
  const short = plan.format === 'short'
  const FormatIcon = short ? Zap : Film

  // Each source reference resolved to its past stream and downloaded copy.
  const resolved = sources.map((src) => {
    const stream = pastStreams.find((s) => s.startedAt === src.startedAt)
    const download = (stream?.broadcasts ?? [])
      .map((b) => byUrl.get(b.url))
      .find(Boolean)
    return {src, stream, download}
  })
  // Several sources could share one download; list each file once.
  const seenSubfolders = new Set<string>()
  const downloaded = resolved.filter((r) => {
    if (!r.download || seenSubfolders.has(r.download.subfolder)) return false
    seenSubfolders.add(r.download.subfolder)
    return true
  })
  const missing = resolved.filter((r) => !r.download)

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Videos
      </button>

      {/* The plan's identity and Edit action, shared by both tabs. */}
      <header className="mb-6 flex max-w-3xl items-start justify-between gap-4">
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
        <button
          type="button"
          onClick={() => onEdit(plan)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
        >
          <Pencil size={14} aria-hidden />
          Edit plan
        </button>
      </header>

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

      {tab === 'dashboard' && (
        <div className="flex max-w-3xl flex-col gap-6">
          {/* The plan's thumbnail floats right of the description, above the
              source streams. */}
          {(plan.thumbnailUrl || plan.description) && (
            <div className="text-sm">
              {plan.thumbnailUrl && (
                <img
                  src={plan.thumbnailUrl}
                  alt="Video thumbnail"
                  className="float-right mb-2 ml-4 aspect-video w-72 max-w-[50%] rounded-lg border border-edge object-cover"
                />
              )}
              {plan.description && <Markdown>{plan.description}</Markdown>}
              <div className="clear-both" />
            </div>
          )}

          {sources.length > 0 && (
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

          {tags.length > 0 && (
            <section aria-labelledby="video-plan-tags-heading">
              <h2
                id="video-plan-tags-heading"
                className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
              >
                <Tag size={13} aria-hidden />
                Tags
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
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
      )}

      {tab === 'content' && (
        <div className="flex max-w-3xl flex-col gap-6">
          {sources.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No source streams referenced yet — add them on the plan&apos;s
              edit page and their downloaded videos will appear here.
            </p>
          ) : !streamsLoaded ? (
            <p className="text-sm text-fg-muted">Loading past streams…</p>
          ) : (
            <>
              {downloaded.length > 0 ? (
                <section aria-label="Downloaded source videos">
                  <ul className="flex max-w-xl flex-col gap-2">
                    {downloaded.map(({stream, download}) => {
                      const d = download!
                      const title =
                        d.title || stream?.title || 'Untitled stream'
                      return (
                        <li
                          key={d.subfolder}
                          className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-2"
                        >
                          {/* Thumbnail = play in a modal. */}
                          <button
                            type="button"
                            onClick={() =>
                              setPlaying({
                                title,
                                url: d.mediaUrl,
                                poster:
                                  d.thumbnailUrl ||
                                  stream?.thumbnailUrl ||
                                  undefined,
                              })
                            }
                            aria-label={`Play ${title}`}
                            title="Play video"
                            className="group relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-black"
                          >
                            <DownloadThumb
                              subfolder={d.subfolder}
                              src={d.thumbnailUrl || stream?.thumbnailUrl || ''}
                              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-60"
                            />
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform group-hover:scale-110">
                                <Play size={12} aria-hidden className="ml-0.5" />
                              </span>
                            </span>
                            {d.durationSecs > 0 && (
                              <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-px text-[10px] font-medium text-white">
                                {formatDurationMs(d.durationSecs * 1000)}
                              </span>
                            )}
                          </button>
                          {/* Title/meta = the download's full video page
                              (player + chat + transcript). */}
                          <button
                            type="button"
                            onClick={() => onOpenDownload(d)}
                            title="Open the video's page (player, chat, transcript)"
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-sm font-semibold text-fg hover:underline">
                              {title}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-fg-muted">
                              {[
                                stream && stream.episodeNumber > 0
                                  ? `EP ${stream.episodeNumber}`
                                  : '',
                                d.channelName,
                                formatDate(
                                  d.startedAt || stream?.startedAt || '',
                                ),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ) : (
                <p className="text-sm text-fg-muted">
                  None of this plan&apos;s source streams have a downloaded
                  video yet.
                </p>
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
        </div>
      )}

      {tab === 'editor' && (
        <VideoPlanEditor
          plan={plan}
          sourceThumbs={Object.fromEntries(
            pastStreams
              .filter((s) => s.thumbnailUrl)
              .map((s) => [s.startedAt, s.thumbnailUrl]),
          )}
          onOpenSource={(startedAt) => {
            const stream = pastStreams.find((s) => s.startedAt === startedAt)
            if (stream) onOpenStream(stream)
          }}
          onPlay={(title, url) => setPlaying({title, url})}
          onComposeDirections={() => onComposeDirections(plan)}
        />
      )}

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

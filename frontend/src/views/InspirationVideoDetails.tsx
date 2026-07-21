import {
  Download,
  ExternalLink,
  Eye,
  Lightbulb,
  Link2,
  Loader2,
  MessageSquare,
  Package,
  RefreshCw,
  ThumbsUp,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  AnalyzeInspirationVideo,
  ExtractInspirationTakeaways,
  GetInspirationVideo,
  ProcessInspirationVideo,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Markdown} from '../components/markdown/Markdown'
import {PageHeader} from '../components/PageHeader'
import {openExternal} from '../lib/browser'
import {useDataChanged} from '../lib/dataChanged'
import {formatCompact, formatDate} from '../lib/format'
import {clock, inspirationError} from './Inspiration'
import {isWorking, StatusPill} from './InspirationChannelDetails'

type VideoTab = 'takeaways' | 'outline' | 'manifest' | 'transcript'

/** How each takeaway's kind reads on its chip. */
const TAKEAWAY_KINDS: Record<string, string> = {
  tip: 'Tip',
  technique: 'Technique',
  concept: 'Concept',
  hook: 'Hook',
  format: 'Format',
  other: 'Note',
}

/**
 * One inspiration video in full: the local copy, the platform metadata, the
 * takeaways and AI-built outline and manifest (links, products, services),
 * and the transcript it was all read from.
 */
export function InspirationVideoDetails({
  video: initial,
}: {
  video: main.InspirationVideo
}) {
  const [video, setVideo] = useState(initial)
  const [tab, setTab] = useState<VideoTab>('takeaways')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const player = useRef<HTMLVideoElement>(null)

  // Every timestamp on the page is a cue: jump the local copy there and play
  // it. Without a local copy the moment opens on YouTube instead.
  const seek = useCallback(
    (atSecs: number) => {
      const el = player.current
      if (!el) {
        if (video.url) {
          const sep = video.url.includes('?') ? '&' : '?'
          openExternal(`${video.url}${sep}t=${Math.max(0, atSecs)}s`)
        }
        return
      }
      el.currentTime = Math.max(0, atSecs)
      void el.play().catch(() => {})
      el.scrollIntoView({behavior: 'smooth', block: 'center'})
    },
    [video.url],
  )

  const load = useCallback(() => {
    GetInspirationVideo(initial.id)
      .then(setVideo)
      .catch(() => {})
  }, [initial.id])

  useEffect(load, [load])
  // The pipeline persists each step, so an open page follows the run.
  useDataChanged(['inspiration'], load)

  const run = async (what: 'download' | 'analyze' | 'takeaways') => {
    setBusy(what)
    setError('')
    try {
      if (what === 'download') await ProcessInspirationVideo(video.id)
      else if (what === 'takeaways') await ExtractInspirationTakeaways(video.id)
      else await AnalyzeInspirationVideo(video.id)
    } catch (err) {
      setError(inspirationError(err, 'That did not work — try again.'))
    } finally {
      setBusy('')
    }
  }

  const working = isWorking(video.status)
  const studied = Boolean(video.outline) || video.beats.length > 0
  const tabs: {id: VideoTab; label: string; count?: number}[] = [
    {id: 'takeaways', label: 'Takeaways', count: video.takeaways.length},
    {id: 'outline', label: 'Outline'},
    {
      id: 'manifest',
      label: 'Manifest',
      count: video.links.length + video.mentions.length,
    },
    {id: 'transcript', label: 'Transcript', count: video.transcript.length},
  ]

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        description={[
          video.publishedAt ? formatDate(video.publishedAt) : '',
          video.durationSecs > 0 ? clock(video.durationSecs) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            {video.url && (
              <button
                type="button"
                onClick={() => openExternal(video.url)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                <ExternalLink size={14} aria-hidden />
                YouTube
              </button>
            )}
            {!working && (
              <button
                type="button"
                onClick={() =>
                  void run(video.videoFile ? 'analyze' : 'download')
                }
                disabled={busy !== ''}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={14} aria-hidden className="animate-spin" />
                ) : video.videoFile ? (
                  <RefreshCw size={14} aria-hidden />
                ) : (
                  <Download size={14} aria-hidden />
                )}
                {video.videoFile ? 'Study again' : 'Download & study'}
              </button>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-6">
        {/* Sections first: the tabs sit above the hero so the page reads
            tabs → video → whatever was read out of it. */}
        <div
          role="tablist"
          aria-label="Video detail sections"
          className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
        >
          {tabs.map((t) => (
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
              {t.label}
              {Boolean(t.count) && (
                <span
                  className={clsx(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    tab === t.id
                      ? 'bg-accent-fg/20 text-accent-fg'
                      : 'bg-surface-hover text-fg-muted',
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Hero: the local copy on the left, what the study made of it on
            the right. */}
        <section className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="w-full shrink-0 overflow-hidden rounded-xl border border-edge bg-surface lg:w-[30rem] xl:w-[38rem]">
            {video.mediaUrl ? (
              <video
                ref={player}
                src={video.mediaUrl}
                poster={video.thumbUrl || video.thumbnailUrl || undefined}
                controls
                className="aspect-video w-full bg-black"
              />
            ) : video.thumbUrl || video.thumbnailUrl ? (
              <img
                src={video.thumbUrl || video.thumbnailUrl}
                alt={`${video.title} thumbnail`}
                className="aspect-video w-full object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-sm text-fg-muted">
                Not downloaded yet
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 p-3">
              <StatusPill video={video} />
              {video.views > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <Eye size={12} aria-hidden />
                  {formatCompact(video.views)}
                </span>
              )}
              {video.likes > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <ThumbsUp size={12} aria-hidden />
                  {formatCompact(video.likes)}
                </span>
              )}
              {video.comments > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <MessageSquare size={12} aria-hidden />
                  {formatCompact(video.comments)}
                </span>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {video.statusDetail && (
              <p className="rounded-lg border border-edge bg-surface p-3 text-xs text-red-600 dark:text-red-400">
                {video.statusDetail}
              </p>
            )}
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            {video.summary && (
              <div className="rounded-xl border border-edge bg-surface p-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Summary
                </p>
                <p className="text-sm text-fg">{video.summary}</p>
              </div>
            )}

            {video.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {video.tags.slice(0, 12).map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-edge bg-bg px-2 py-0.5 text-xs text-fg-muted"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* The description reads as prose, so it gets the full width. */}
        <section className="rounded-xl border border-edge bg-surface p-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Description
          </p>
          {video.description ? (
            <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm text-fg">
              {video.description}
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
              This video has no description.
            </p>
          )}
        </section>

        {/* The selected section, across the full width of the page. */}
        <div className="flex min-w-0 flex-col gap-4">
          {tab === 'takeaways' && (
            <div className="flex flex-col gap-3">
              {video.takeaways.length === 0 ? (
                <Empty
                  text={
                    working
                      ? 'Takeaways are lifted out of the outline once the video has been studied.'
                      : studied
                        ? 'No takeaways yet — they are extracted in the background, or run it now below.'
                        : 'No takeaways yet — download and study this video first.'
                  }
                />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {video.takeaways.map((t, i) => (
                    <li
                      key={`${t.title}-${i}`}
                      className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                          {TAKEAWAY_KINDS[t.kind] ?? t.kind}
                        </span>
                        {t.atSecs >= 0 && (
                          <Cue atSecs={t.atSecs} onSeek={seek} />
                        )}
                      </div>
                      <p className="text-sm font-semibold text-fg">{t.title}</p>
                      {t.detail && (
                        <p className="text-sm text-fg-muted">{t.detail}</p>
                      )}
                      {t.apply && (
                        <p className="flex gap-2 rounded-lg bg-surface-hover p-2 text-sm text-fg">
                          <Lightbulb
                            size={14}
                            aria-hidden
                            className="mt-0.5 shrink-0 text-accent"
                          />
                          {t.apply}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {studied && !working && (
                <button
                  type="button"
                  onClick={() => void run('takeaways')}
                  disabled={busy !== ''}
                  className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  {busy === 'takeaways' ? (
                    <Loader2 size={14} aria-hidden className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} aria-hidden />
                  )}
                  {video.takeaways.length > 0
                    ? 'Extract again'
                    : 'Extract takeaways'}
                </button>
              )}
            </div>
          )}

          {tab === 'outline' && (
            <div className="flex flex-col gap-4">
              {video.beats.length > 0 && (
                <ol className="flex flex-col gap-2">
                  {video.beats.map((b, i) => (
                    <li
                      key={`${b.atSecs}-${i}`}
                      className="flex gap-3 rounded-lg border border-edge bg-surface p-3"
                    >
                      <Cue atSecs={b.atSecs} onSeek={seek} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-fg">
                          {b.title}
                        </span>
                        {b.summary && (
                          <span className="mt-0.5 block text-sm text-fg-muted">
                            {b.summary}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {video.outline ? (
                <div className="rounded-xl border border-edge bg-surface p-4 text-sm text-fg">
                  <Markdown>{video.outline}</Markdown>
                </div>
              ) : (
                video.beats.length === 0 && (
                  <Empty
                    text={
                      working
                        ? 'The outline appears once the video has been transcribed and studied.'
                        : 'No outline yet — download and study this video to build one.'
                    }
                  />
                )
              )}
            </div>
          )}

          {tab === 'manifest' && (
            <div className="flex flex-col gap-4">
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Links
                </p>
                {video.links.length === 0 ? (
                  <Empty text="No links found in the description or the video." />
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {video.links.map((l, i) => (
                      <li key={`${l.url}-${i}`}>
                        <button
                          type="button"
                          onClick={() => openExternal(l.url)}
                          className="flex w-full items-start gap-2 rounded-lg border border-edge bg-surface p-3 text-left transition-colors hover:bg-surface-hover"
                        >
                          <Link2
                            size={14}
                            aria-hidden
                            className="mt-0.5 shrink-0 text-fg-muted"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-fg">
                              {l.label || l.url}
                            </span>
                            <span className="block truncate text-xs text-fg-muted">
                              {l.url}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Products, services & tools
                </p>
                {video.mentions.length === 0 ? (
                  <Empty text="Nothing named yet." />
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {video.mentions.map((m, i) => (
                      <li
                        key={`${m.name}-${i}`}
                        className="flex items-start gap-3 rounded-lg border border-edge bg-surface p-3"
                      >
                        <Package
                          size={14}
                          aria-hidden
                          className="mt-0.5 shrink-0 text-fg-muted"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-fg">
                            {m.name}
                          </span>
                          {m.detail && (
                            <span className="block text-sm text-fg-muted">
                              {m.detail}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                          {m.kind}
                          {m.atSecs >= 0 && (
                            <Cue atSecs={m.atSecs} onSeek={seek} />
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {video.chapters.length > 0 && (
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Chapters (from YouTube)
                  </p>
                  <ul className="flex flex-col gap-1">
                    {video.chapters.map((c, i) => (
                      <li
                        key={`${c.startSecs}-${i}`}
                        className="flex gap-3 text-sm text-fg"
                      >
                        <Cue atSecs={c.startSecs} onSeek={seek} />
                        {c.title}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {tab === 'transcript' && (
            <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-edge bg-surface p-4">
              {video.transcript.length === 0 ? (
                <Empty
                  text={
                    working
                      ? 'Transcribing — lines appear once the pass finishes.'
                      : 'No transcript yet.'
                  }
                />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {video.transcript.map((l, i) => (
                    <li key={`${l.atSecs}-${i}`} className="flex gap-3 text-sm">
                      <Cue atSecs={l.atSecs} onSeek={seek} className="mt-0.5" />
                      <span className="text-fg">{l.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A timestamp that plays the video from that moment. Every part of the study
 * notes carries these, so they all read and behave the same.
 */
function Cue({
  atSecs,
  onSeek,
  className,
}: {
  atSecs: number
  onSeek: (atSecs: number) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onSeek(atSecs)}
      title="Play from here"
      className={clsx(
        'shrink-0 font-mono text-xs text-accent transition-opacity hover:opacity-70',
        className,
      )}
    >
      {clock(atSecs)}
    </button>
  )
}

function Empty({text}: {text: string}) {
  return (
    <p className="rounded-lg border border-dashed border-edge bg-surface p-4 text-sm text-fg-muted">
      {text}
    </p>
  )
}

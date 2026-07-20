import {
  ArrowLeft,
  Bell,
  Calendar,
  Captions,
  Check,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  HardDrive,
  LayoutGrid,
  Loader2,
  MessageSquare,
  NotebookText,
  Pencil,
  PlayCircle,
  Radio,
  RefreshCw,
  Scissors,
  Trash2,
  Video,
  WandSparkles,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  DeleteLocalStream,
  GenerateStreamDescription,
  GenerateStreamThumbnail,
  GetContentSeries,
  GetPastStreams,
  GetSeriesTypes,
  GetStreamOutline,
  SetPastStreamSeries,
  SetStreamDescription,
  SetStreamEpisode,
  SetStreamThumbnail,
  SetStreamTitle,
  StartDownload,
  UpdateYouTubeStreamInfo,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {ClipsPanel} from '../components/ClipsPanel'
import {Modal} from '../components/Modal'
import {PageHeader} from '../components/PageHeader'
import {OutlinePanel} from '../components/OutlinePanel'
import {
  PlanThumbnailEditor,
  zipThumbHistory,
  type PlanThumb,
} from '../components/PlanThumbnailEditor'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {DescriptionAiActions} from './PlanStream'
import type {VideoPlanTab} from './VideoPlanDetails'
import {
  ChatLogPanel,
  EventsLogPanel,
  TranscriptPanel,
} from '../components/StreamMedia'
import {useDownloadStatus} from '../downloads/DownloadProvider'
import {useDownloads} from '../downloads/useDownloads'
import {openExternal} from '../lib/browser'
import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatDurationMs,
  formatNumber,
} from '../lib/format'
import {SETTING_KEYS, loadSetting} from '../lib/settings'
import {platformName} from '../services/services'
import {useServices} from '../services/ServicesProvider'

/** RFC3339 → "2026-07-05 1900", for a filesystem-safe subfolder timestamp. */
function downloadStamp(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return 'stream'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(
    t.getHours(),
  )}${pad(t.getMinutes())}`
}

/**
 * Cluster a stream's broadcasts into distinct broadcast segments by go-live
 * time. One broadcast simulcast to several channels starts within a small
 * margin on each, so those cluster together; a stream that spans multiple
 * sittings (often manually grouped) forms one cluster per sitting. Sorted by
 * time, each cluster ordered by platform.
 */
function clusterBroadcasts(
  broadcasts: main.PastBroadcast[],
  marginMs: number,
): main.PastBroadcast[][] {
  const sorted = [...broadcasts].sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  )
  const clusters: {anchor: number; items: main.PastBroadcast[]}[] = []
  for (const b of sorted) {
    const t = Date.parse(b.startedAt)
    let placed = false
    if (!Number.isNaN(t)) {
      for (const c of clusters) {
        if (Math.abs(t - c.anchor) <= marginMs) {
          c.items.push(b)
          placed = true
          break
        }
      }
    }
    if (!placed) clusters.push({anchor: Number.isNaN(t) ? 0 : t, items: [b]})
  }
  return clusters.map((c) =>
    c.items
      .slice()
      .sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0)),
  )
}

/**
 * Choose the platform to download this stream from and the ordered VOD URLs.
 * Prefers the configured source; falls back to another platform present in the
 * stream. Streams may span multiple videos on one platform, so all of the
 * chosen platform's broadcasts are returned, ordered by go-live time.
 */
/**
 * Resolve which VOD to download for each broadcast. Picks the preferred
 * platform per broadcast cluster when present, and falls back to whatever
 * channel is available otherwise — so a broadcast that aired on only one
 * channel is still captured. Returns the ordered URLs (possibly mixing
 * platforms) plus the broadcasts they came from.
 */
function resolveDownload(
  clusters: main.PastBroadcast[][],
  source: string,
): {platform: string; urls: string[]; picks: main.PastBroadcast[]} | null {
  // Auto and YouTube both prefer YouTube; Twitch prefers Twitch.
  const order = source === 'twitch' ? ['twitch', 'youtube'] : ['youtube', 'twitch']
  const picks: main.PastBroadcast[] = []
  for (const cluster of clusters) {
    let pick: main.PastBroadcast | undefined
    for (const p of order) {
      pick = cluster.find((b) => b.platform === p && b.url)
      if (pick) break
    }
    if (!pick) pick = cluster.find((b) => b.url)
    if (pick) picks.push(pick)
  }
  if (picks.length === 0) return null
  picks.sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  )
  const urls = picks.map((b) => b.url)
  // Representative platform for naming: the preferred one if it was used at
  // all, otherwise the first pick's platform.
  const platform =
    order.find((p) => picks.some((b) => b.platform === p)) ?? picks[0].platform
  return {platform, urls, picks}
}

/**
 * The title the platforms give the stream — Twitch's preferred (YouTube live
 * titles carry decorations), falling back to the first non-empty. Mirrors
 * pickStreamTitle in past.go; a custom rename overrides it.
 */
function pickPlatformTitle(broadcasts: main.PastBroadcast[]): string {
  const twitch = broadcasts.find(
    (b) => b.platform === 'twitch' && b.title.trim(),
  )
  if (twitch) return twitch.title.trim()
  return broadcasts.find((b) => b.title.trim())?.title.trim() ?? ''
}

export type StreamTab =
  | 'overview'
  | 'chat'
  | 'events'
  | 'transcript'
  | 'outline'
  | 'clips'

interface StreamDetailsProps {
  stream: main.PastStream
  /** Tab to open on; navigation (e.g. the status bar's outline chip) sets it. */
  initialTab?: StreamTab
  onBack: () => void
  /** Open a downloaded broadcast's video page (player + chat + transcript). */
  onOpenDownload: (download: main.DownloadedVideo) => void
  /** Open a video plan made from this stream (the Clips tab), optionally on
   *  a specific tab (e.g. 'editor' right after a script is chosen). */
  onOpenVideoPlan: (plan: main.VideoPlan, tab?: VideoPlanTab) => void
  /** The stream was renamed — reflect it on the navigation entry (and with
   *  it the top-bar title). customTitle is '' when reset to the platform's. */
  onRenamed: (title: string, customTitle: string) => void
}

/**
 * Detail view for one aggregated stream, in tabs: an Overview (summary plus a
 * condensed list of its per-channel videos, each opening that channel's
 * specific stream info), the downloaded video, the unified cross-channel chat,
 * and the transcript.
 */
export function StreamDetails({
  stream,
  initialTab,
  onBack,
  onOpenDownload,
  onOpenVideoPlan,
  onRenamed,
}: StreamDetailsProps) {
  const [tab, setTab] = useState<StreamTab>(initialTab ?? 'overview')
  const [detail, setDetail] = useState<main.PastBroadcast | null>(null)

  // Navigating to this view again with an explicit tab (same mounted
  // component, new nav entry) should switch to it.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])
  // The stream's content series assignment, lifted here so the episode
  // editor reacts when it changes.
  const [seriesId, setSeriesId] = useState(stream.seriesId ?? '')
  const {byUrl, refresh: refreshDownloads} = useDownloads()
  // A downloaded copy of this stream (any of its broadcasts), if present.
  const streamDownload = stream.broadcasts
    .map((b) => byUrl.get(b.url))
    .find(Boolean)

  // Group the videos by broadcast time so the same broadcast across channels
  // sits together. The margin mirrors the cross-platform matching setting.
  const [marginMin, setMarginMin] = useState(5)
  useEffect(() => {
    loadSetting(SETTING_KEYS.streamMatchMargin).then((v) => {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) setMarginMin(n)
    })
  }, [])
  const clusters = clusterBroadcasts(stream.broadcasts, marginMin * 60_000)
  const channelCount = new Set(stream.broadcasts.map((b) => b.platform)).size

  // The stream's effective title, editable in place (a custom rename
  // overrides the platform title; clearing it falls back). Local state so
  // edits reflect without refetching the whole past-streams list.
  const [title, setTitle] = useState(stream.title)
  const [customTitle, setCustomTitle] = useState(stream.customTitle ?? '')
  const platformTitle = pickPlatformTitle(stream.broadcasts)
  // Without a rename the stream carries its concluded plan's title (the plan
  // moves onto the stream at conclude), falling back to the platform's.
  const planTitle = stream.plan?.title?.trim() ?? ''
  const fallbackTitle = planTitle || platformTitle
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [titleError, setTitleError] = useState('')
  useEffect(() => {
    setTitle(stream.title)
    setCustomTitle(stream.customTitle ?? '')
  }, [stream])
  const streamName = title || `Stream ${formatDate(stream.startedAt)}`

  const openRename = () => {
    setTitleDraft(title)
    setTitleError('')
    setRenaming(true)
  }
  // Save the rename; an empty (or fallback-matching) value clears the
  // override so the plan/platform title shows again.
  const saveTitle = async (next: string) => {
    const trimmed = next.trim()
    const clearing = trimmed === '' || trimmed === fallbackTitle
    setSavingTitle(true)
    setTitleError('')
    try {
      await SetStreamTitle(stream.startedAt, clearing ? '' : trimmed)
      const effective = clearing
        ? fallbackTitle || `Stream ${formatDate(stream.startedAt)}`
        : trimmed
      setTitle(clearing ? fallbackTitle : trimmed)
      setCustomTitle(clearing ? '' : trimmed)
      onRenamed(effective, clearing ? '' : trimmed)
      setRenaming(false)
    } catch (err) {
      setTitleError(
        err instanceof Error && err.message
          ? err.message
          : 'The title could not be saved.',
      )
    } finally {
      setSavingTitle(false)
    }
  }

  // Custom (generated/uploaded) thumbnail: local state so edits reflect
  // without refetching the whole past-streams list. The platform image is
  // derived from the broadcasts rather than stream.thumbnailUrl because the
  // backend overrides the latter with the custom one.
  const [customThumb, setCustomThumb] = useState<main.StreamThumbInfo | null>(
    stream.customThumb ?? null,
  )
  const [editingThumb, setEditingThumb] = useState(false)
  const platformThumbUrl =
    stream.broadcasts.find((b) => b.thumbnailUrl)?.thumbnailUrl ?? ''
  // The plan's own thumbnail (when the stream came from a concluded plan)
  // outranks the platform image everywhere: it is the producer's work.
  const planThumbFile = stream.plan?.thumbnailFile ?? ''
  const planThumbUrl = (planThumbFile && stream.plan?.thumbnailUrl) || ''
  const thumbUrl =
    (customThumb?.file && customThumb.url) || planThumbUrl || platformThumbUrl

  // Whether an outline exists — it is the creative brief for generated
  // thumbnails, so the CTA only appears once there is one. Re-checked on tab
  // switches so generating an outline immediately unlocks the CTA.
  const [hasOutline, setHasOutline] = useState(false)
  useEffect(() => {
    let cancelled = false
    GetStreamOutline(stream.startedAt)
      .then((o) => {
        if (!cancelled) setHasOutline(Boolean(o.generatedAt))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [stream.startedAt, tab])

  const applyThumb = async (t: PlanThumb) => {
    const info = await SetStreamThumbnail(stream.startedAt, t.file)
    setCustomThumb(
      info.file || (info.historyFiles?.length ?? 0) > 0 ? info : null,
    )
    setYtNote('')
    setYtError('')
  }

  // One "Update YouTube" action: title (live prefix stripped — the broadcast
  // is over), description, and custom thumbnail land on the VOD together.
  const ytUrls = stream.broadcasts
    .filter((b) => b.platform === 'youtube')
    .map((b) => b.url)
  const [updatingYt, setUpdatingYt] = useState(false)
  const [ytNote, setYtNote] = useState('')
  const [ytError, setYtError] = useState('')

  const updateYouTube = async () => {
    setUpdatingYt(true)
    setYtNote('')
    setYtError('')
    try {
      const res = await UpdateYouTubeStreamInfo(stream.startedAt, ytUrls)
      if (res.thumbnailPushed) setCustomThumb(res.thumb)
      const wrote = [
        'title',
        ...(res.descriptionPushed ? ['description'] : []),
        ...(res.thumbnailPushed ? ['thumbnail'] : []),
      ]
      setYtNote(
        `YouTube updated: ${wrote.join(', ')}.${
          res.warning ? ` ${res.warning}` : ''
        }`,
      )
    } catch (err) {
      setYtError(
        err instanceof Error && err.message
          ? err.message
          : String(err) || 'The YouTube video could not be updated.',
      )
    } finally {
      setUpdatingYt(false)
    }
  }
  // Total runtime: one representative duration per broadcast segment, summed.
  const totalDurationSecs = clusters.reduce(
    (sum, c) => sum + (c.find((b) => b.durationSecs > 0)?.durationSecs ?? 0),
    0,
  )
  // The unified chat window: the stream's start through the last broadcast's
  // end, so multi-sitting streams cover the gap between segments too.
  const streamStartMs = Date.parse(stream.startedAt)
  const chatDurationSecs = stream.broadcasts.reduce((max, b) => {
    const t = Date.parse(b.startedAt)
    if (Number.isNaN(t) || Number.isNaN(streamStartMs)) return max
    const end = Math.round((t - streamStartMs) / 1000) + (b.durationSecs || 0)
    return Math.max(max, end)
  }, totalDurationSecs)

  // Video download: resolve the preferred source, run the sidecar. Progress is
  // reported app-wide in the status bar (see DownloadProvider).
  const {statuses} = useServices()
  const dlStatus = useDownloadStatus()
  const [source, setSource] = useState('auto')
  useEffect(() => {
    loadSetting(SETTING_KEYS.downloadSource).then((v) => setSource(v ?? 'auto'))
  }, [])
  const download = resolveDownload(clusters, source)
  const [confirmRedownload, setConfirmRedownload] = useState(false)

  const startDownload = async (fresh = false) => {
    if (!download) return
    dlStatus.markStarting(stream.startedAt)
    try {
      const name = streamName
      // Per-stream subfolder: timestamp + stream title + source channel name.
      // A re-download reuses the existing download's subfolder so everything
      // keyed on it (transcripts, broadcast snapshots) stays attached.
      const channel =
        statuses[download.platform as 'twitch' | 'youtube' | 'kick']?.account ||
        platformName(download.platform)
      const subfolder =
        (fresh && streamDownload?.subfolder) ||
        `${downloadStamp(stream.startedAt)} - ${name} - ${channel}`

      // Metadata written alongside the video as manifest.json so the app can
      // track and play the downloaded broadcast. Built from the actual picked
      // broadcasts (which may span channels for single-channel broadcasts).
      const picks = download.picks
      const startedAt =
        picks.map((b) => b.startedAt).sort()[0] || stream.startedAt
      const manifest = {
        id: `${download.platform}|${download.urls[0]}`,
        title: name,
        platform: download.platform,
        channelName: channel,
        startedAt,
        durationSecs: picks.reduce((s, b) => s + (b.durationSecs || 0), 0),
        viewCount: picks.reduce((s, b) => s + (b.viewCount || 0), 0),
        // Platform URLs only — a custom thumbnail is served by the local
        // media server, whose address doesn't survive restarts.
        thumbnailUrl:
          picks.find((b) => b.thumbnailUrl)?.thumbnailUrl || platformThumbUrl,
        urls: download.urls,
      }
      await StartDownload(
        name,
        subfolder,
        JSON.stringify(manifest),
        fresh,
        download.urls,
      )
    } catch (err) {
      dlStatus.markError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not start the download.',
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Broadcasting
      </button>

      <PageHeader
        description={`${clusters.length} broadcast${
          clusters.length === 1 ? '' : 's'
        } across ${channelCount} channel${channelCount === 1 ? '' : 's'}.${
          customTitle ? ' Renamed — the platforms keep their own title.' : ''
        }`}
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openRename}
                title="Rename this stream everywhere it appears in the app. The platforms' own titles are untouched until you Update YouTube."
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
              >
                <Pencil size={13} aria-hidden />
                Rename
              </button>
              {ytUrls.length > 0 && (
                <button
                  type="button"
                  onClick={() => void updateYouTube()}
                  disabled={updatingYt}
                  title="Write this stream's title, description, and thumbnail onto its YouTube video in one action. The live prefix comes off the title — the broadcast is over."
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  {updatingYt ? (
                    <Loader2 size={13} aria-hidden className="animate-spin" />
                  ) : (
                    <BrandTile platform="youtube" size={13} />
                  )}
                  {updatingYt ? 'Updating…' : 'Update YouTube'}
                </button>
              )}
            </div>
            {ytNote && (
              <p className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                <Check size={13} aria-hidden />
                {ytNote}
              </p>
            )}
            {ytError && (
              <p className="max-w-sm text-right text-xs text-red-600 dark:text-red-400">
                {ytError}
              </p>
            )}
          </div>
        }
      />

      {/* Rename workbench: the custom title shows everywhere in the app and
          overrides the platform title; clearing it falls back. */}
      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename stream"
        icon={<Pencil size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          The new title is used everywhere this stream appears in the app —
          the platforms&apos; own video titles are not changed.
        </p>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void saveTitle(titleDraft)
            }
          }}
          placeholder={fallbackTitle || 'Stream title'}
          autoFocus
          className="mt-4 w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        {customTitle && fallbackTitle && (
          <p className="mt-2 text-xs text-fg-muted">
            {planTitle ? 'Planned title' : 'Platform title'}: “{fallbackTitle}”
          </p>
        )}
        {titleError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {titleError}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {customTitle && (
            <button
              type="button"
              onClick={() => void saveTitle('')}
              disabled={savingTitle}
              className="mr-auto rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            >
              {planTitle ? 'Use planned title' : 'Use platform title'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setRenaming(false)}
            disabled={savingTitle}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void saveTitle(titleDraft)}
            disabled={savingTitle || !titleDraft.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {savingTitle ? 'Saving…' : 'Save title'}
          </button>
        </div>
      </Modal>

      <StreamTabs tab={tab} onChange={setTab} />

      {tab === 'chat' && (
        <ChatLogPanel
          startedAt={stream.startedAt}
          durationSecs={chatDurationSecs}
          noun="stream"
        />
      )}
      {tab === 'events' && (
        <EventsLogPanel
          startedAt={stream.startedAt}
          durationSecs={chatDurationSecs}
          noun="stream"
        />
      )}
      {tab === 'transcript' && (
        <TranscriptPanel
          startedAt={stream.startedAt}
          subfolder={streamDownload?.subfolder}
          noun="stream"
        />
      )}
      {tab === 'outline' && (
        <OutlinePanel
          startedAt={stream.startedAt}
          durationSecs={chatDurationSecs}
          title={streamName}
        />
      )}
      {tab === 'clips' && (
        <ClipsPanel
          stream={stream}
          streamName={streamName}
          onOpenVideoPlan={onOpenVideoPlan}
        />
      )}

      {tab === 'overview' && (
        <>
      <StreamSeriesSelect
        stream={stream}
        seriesId={seriesId}
        onChange={setSeriesId}
      />
      <EpisodeEditor stream={stream} seriesId={seriesId} />

      {/* Summary: thumbnail + aggregate tiles. */}
      <section
        aria-label="Stream summary"
        className="flex flex-col gap-4 lg:flex-row"
      >
        <div className="flex w-full max-w-md shrink-0 flex-col gap-2">
        {streamDownload ? (
          <>
            <button
              type="button"
              onClick={() => onOpenDownload(streamDownload)}
              aria-label="Play downloaded video"
              className="group relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black"
            >
              {((customThumb?.file && customThumb.url) ||
                streamDownload.thumbnailUrl ||
                platformThumbUrl) && (
                <img
                  src={
                    (customThumb?.file && customThumb.url) ||
                    streamDownload.thumbnailUrl ||
                    platformThumbUrl
                  }
                  alt=""
                  aria-hidden
                  className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-60"
                />
              )}
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform group-hover:scale-110">
                  <PlayCircle size={32} aria-hidden />
                </span>
              </span>
              <span className="absolute left-2 top-2 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                Downloaded
              </span>
            </button>
            {/* The platforms still list this stream's VODs, so the local copy
                can be replaced from the source (e.g. a corrupted file, or a
                download made at a lower quality). */}
            {download && !stream.local && (
              <button
                type="button"
                onClick={() => setConfirmRedownload(true)}
                disabled={dlStatus.state === 'running'}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {dlStatus.state === 'running' ? (
                  <Loader2 size={13} aria-hidden className="animate-spin" />
                ) : (
                  <RefreshCw size={13} aria-hidden />
                )}
                {dlStatus.state === 'running'
                  ? 'Downloading…'
                  : `Re-download from ${platformName(download.platform)}`}
              </button>
            )}
          </>
        ) : download ? (
          // Not downloaded yet: the thumbnail itself is the download CTA.
          // Once downloaded it becomes the play button above.
          <button
            type="button"
            onClick={() => void startDownload()}
            disabled={dlStatus.state === 'running'}
            title={`Download every broadcast's VOD${
              download.urls.length > 1 ? 's (stitched together)' : ''
            }`}
            className="group relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black"
          >
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt=""
                aria-hidden
                className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-60"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-surface text-fg-muted">
                <Video size={32} aria-hidden />
              </span>
            )}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform group-hover:scale-110">
                {dlStatus.state === 'running' ? (
                  <Loader2 size={28} aria-hidden className="animate-spin" />
                ) : (
                  <Download size={28} aria-hidden />
                )}
              </span>
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {dlStatus.state === 'running'
                  ? 'Downloading…'
                  : 'Download videos'}
              </span>
            </span>
          </button>
        ) : thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`${streamName} thumbnail`}
            className="aspect-video w-full rounded-xl border border-edge object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-edge bg-surface text-fg-muted">
            <Video size={32} aria-hidden />
          </div>
        )}

        {/* Custom thumbnail tools: generate with AI (briefed from the
            outline), upload a hand-made image, or fall back to the
            platform's own thumbnail. A custom image shows everywhere the
            stream's thumbnail appears. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditingThumb(true)}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <WandSparkles size={13} aria-hidden />
            {customThumb?.file
              ? 'Edit thumbnail'
              : thumbUrl
                ? 'Customize thumbnail'
                : hasOutline
                  ? 'Generate thumbnail with AI'
                  : 'Add thumbnail'}
          </button>
        </div>
        </div>

        <div className="grid flex-1 grid-cols-2 content-start gap-4">
          <SummaryTile
            icon={Calendar}
            label="Date"
            value={formatDate(stream.startedAt) || '—'}
          />
          <SummaryTile
            icon={Clock}
            label="Duration"
            value={
              totalDurationSecs > 0
                ? formatDurationMs(totalDurationSecs * 1000)
                : '—'
            }
          />
          <SummaryTile
            icon={Eye}
            label="Total views"
            value={
              stream.totalViews > 0 ? formatCompact(stream.totalViews) : '—'
            }
          />
          <SummaryTile
            icon={Radio}
            label="Broadcasts"
            value={String(clusters.length)}
          />
        </div>
      </section>

      {/* Description: the concluded plan's text by default, editable and
          AI-generatable per stream (see stream_desc.go). The header's
          "Update YouTube" writes it onto the VOD together with the title
          and thumbnail. */}
      <div className="mt-6">
        <StreamDescriptionSection
          stream={stream}
          streamName={streamName}
          seriesId={seriesId}
          hasOutline={hasOutline}
        />
      </div>

      {/* Videos grouped by broadcast segment. A single simulcast is one group
          (rendered without a header); multi-sitting streams show one header
          per broadcast so the same broadcast across channels sits together. */}
      <h2 className="mb-3 mt-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Videos
      </h2>
      <div className="flex flex-col gap-6">
        {clusters.map((cluster, i) => (
          <div key={cluster.map((b) => b.url).join(',')}>
            {clusters.length > 1 && (
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
                  Broadcast {i + 1}
                </span>
                <span className="text-xs text-fg-muted">
                  {formatDateTime(cluster[0].startedAt)} ·{' '}
                  {cluster.length} channel{cluster.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
            <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface">
              {cluster.map((b) => {
                const dl = byUrl.get(b.url)
                return (
                  <VideoRow
                    key={`${b.platform}-${b.url}`}
                    broadcast={b}
                    download={dl}
                    onOpen={() => setDetail(b)}
                    onPlay={dl ? () => onOpenDownload(dl) : undefined}
                  />
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Custom thumbnail workbench, briefed from the stream's outline. */}
      <Modal
        open={editingThumb}
        onClose={() => setEditingThumb(false)}
        title="Stream thumbnail"
        maxWidthClass="max-w-lg"
      >
        <p className="mb-3 text-sm text-fg-muted">
          Generate one from the stream&apos;s title and its AI outline
          (following your brand assets and the &ldquo;Stream thumbnails&rdquo;
          skill) or upload your own — either counts as a custom thumbnail and
          shows everywhere this stream appears.
          {platformThumbUrl
            ? ' Without a custom one, the platform’s own thumbnail is used.'
            : ''}
          {!hasOutline
            ? ' Generating needs the stream’s outline — build it on the Outline tab first.'
            : ''}
        </p>
        {/* Without a custom image, the plan's own thumbnail previews as the
            existing picture — and rides along as the revision base, so
            "request changes" edits the image made for this stream's plan.
            Only a stream with no plan thumbnail falls back to the platform
            image (which the backend fetches as the base). */}
        <PlanThumbnailEditor
          planTitle={streamName}
          planDescription=""
          file={customThumb?.file || planThumbFile}
          url={
            (customThumb?.file ? customThumb.url : '') ||
            planThumbUrl ||
            platformThumbUrl
          }
          history={zipThumbHistory(
            customThumb?.historyFiles,
            customThumb?.historyUrls,
          )}
          onGenerate={(feedback, currentFile) =>
            GenerateStreamThumbnail(
              stream.startedAt,
              streamName,
              feedback,
              currentFile,
            )
          }
          generateTip="Generated from the stream's title, its AI outline, and your brand assets (Profile → Brand Assets). The style guide lives in Settings → Skills → Stream thumbnails."
          removeLabel={platformThumbUrl ? 'Use platform thumbnail' : undefined}
          onApply={applyThumb}
        />
      </Modal>

      {/* Re-downloading replaces the local video file, so it sits behind an
          explicit confirmation. */}
      <Modal
        open={confirmRedownload}
        onClose={() => setConfirmRedownload(false)}
        title="Re-download this stream?"
        icon={<RefreshCw size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          The stream&apos;s video is fetched again from{' '}
          {download ? platformName(download.platform) : 'its platform'} and the
          current local copy is replaced. The stream&apos;s transcript, chat,
          and history are untouched.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmRedownload(false)}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmRedownload(false)
              void startDownload(true)
            }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            Re-download
          </button>
        </div>
      </Modal>

      {/* Any downloaded stream can drop its local copy. For a local-only
          stream that copy is the last one — deleting removes the stream for
          good; otherwise the stream stays listed on its platforms. */}
      {streamDownload && (
        <DeleteDownloadSection
          stream={stream}
          download={streamDownload}
          onDeleted={() => {
            refreshDownloads()
            if (stream.local) onBack()
          }}
        />
      )}
        </>
      )}

      <BroadcastDetailModal
        broadcast={detail}
        onClose={() => setDetail(null)}
      />
    </div>
  )
}

/**
 * The stream's description card. Shows the effective description (custom
 * text, else the concluded plan's), editable in the markdown field, with the
 * shared request-edits helper and an AI draft grounded in the stream's
 * outline. Edits persist as the stream's custom description; clearing the
 * text falls back to the plan's.
 */
function StreamDescriptionSection({
  stream,
  streamName,
  seriesId,
  hasOutline,
}: {
  stream: main.PastStream
  streamName: string
  seriesId: string
  hasOutline: boolean
}) {
  const {statuses} = useServices()
  const aiConnected =
    (statuses['anthropic']?.connected ?? false) ||
    (statuses['openai']?.connected ?? false)

  const [description, setDescription] = useState(stream.description ?? '')
  const [selection, setSelection] = useState<[number, number]>([0, 0])
  const [generating, setGenerating] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = async (next: string) => {
    setError('')
    try {
      await SetStreamDescription(stream.startedAt, next.trim())
      setSaved(true)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the description.',
      )
    }
  }

  const generate = async () => {
    setGenerating(true)
    setError('')
    try {
      const text = await GenerateStreamDescription(
        stream.startedAt,
        streamName,
        seriesId,
        stream.episodeNumber,
      )
      setDescription(text)
      setSelection([0, 0])
      await save(text)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : String(err) || 'Could not generate a description.',
      )
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section
      aria-label="Stream description"
      className="mb-6 rounded-xl border border-edge bg-surface p-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Description
          {saved && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal normal-case tracking-normal text-fg-muted">
              <Check size={12} aria-hidden />
              Saved
            </span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!aiConnected || !hasOutline || generating}
            title={
              !aiConnected
                ? 'Connect an AI service in Settings → AI to draft descriptions.'
                : !hasOutline
                  ? "Needs the stream's outline — generate one on the Outline tab first."
                  : "Drafted for YouTube search from the stream's outline and its series context."
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={12} aria-hidden className="animate-spin" />
            ) : (
              <WandSparkles size={12} aria-hidden />
            )}
            {description.trim() ? 'Regenerate with AI' : 'Generate with AI'}
          </button>
        </div>
      </div>

      <MarkdownField
        id="stream-description"
        value={description}
        onChange={(v) => {
          setDescription(v)
          setSaved(false)
        }}
        placeholder="What happened on this stream?"
        onSelectionChange={(start, end) => setSelection([start, end])}
        onDone={() => void save(description)}
      />
      <DescriptionAiActions
        description={description}
        selection={selection}
        onDescription={(next) => {
          setDescription(next)
          setSelection([0, 0])
          void save(next)
        }}
      />

      {(stream.plan?.tags ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(stream.plan?.tags ?? []).map((t) => (
            <span
              key={t}
              className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </section>
  )
}

/** The details page's section tabs. */
function StreamTabs({
  tab,
  onChange,
}: {
  tab: StreamTab
  onChange: (tab: StreamTab) => void
}) {
  const tabs: {id: StreamTab; label: string; icon: typeof LayoutGrid}[] = [
    {id: 'overview', label: 'Overview', icon: LayoutGrid},
    {id: 'chat', label: 'Chat', icon: MessageSquare},
    {id: 'events', label: 'Events', icon: Bell},
    {id: 'transcript', label: 'Transcript', icon: Captions},
    {id: 'outline', label: 'Outline', icon: NotebookText},
    {id: 'clips', label: 'Clips', icon: Scissors},
  ]
  return (
    <div
      role="tablist"
      aria-label="Stream sections"
      className="mb-6 flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === t.id
              ? 'bg-accent text-accent-fg'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          )}
        >
          <t.icon size={14} aria-hidden />
          {t.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Assign (or clear) a content series for this past stream. The assignment is
 * persisted per broadcast so it survives refetches. `onChange` fires after
 * the save commits, so dependents (the episode editor) read fresh state.
 */
function StreamSeriesSelect({
  stream,
  seriesId,
  onChange,
}: {
  stream: main.PastStream
  seriesId: string
  onChange: (id: string) => void
}) {
  const [series, setSeries] = useState<main.ContentSeries[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    GetContentSeries()
      .then((s) => setSeries(s ?? []))
      .catch(() => {})
  }, [])

  if (series.length === 0) return null

  const change = async (id: string) => {
    const keys = stream.broadcasts.map((b) => `${b.platform}|${b.url}`)
    try {
      await SetPastStreamSeries(keys, id)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1_500)
    } catch {
      // Non-fatal; the value reconciles on the next load.
    }
    onChange(id)
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <label htmlFor="stream-series" className="text-sm font-medium text-fg">
        Series
      </label>
      <select
        id="stream-series"
        value={seriesId}
        onChange={(e) => void change(e.target.value)}
        className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
      >
        <option value="">None</option>
        {series.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      {saved && (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <Check size={13} aria-hidden />
          Saved
        </span>
      )}
    </div>
  )
}

/**
 * Episode number + short description for streams in an episodic series.
 * Hidden unless the assigned series' type is episodic. The number arrives
 * from the stream's planned broadcast (adopted at go-live — the plan's
 * episode and the past stream's are one and the same); both fields are
 * editable here, persisted per broadcast like the series assignment.
 */
function EpisodeEditor({
  stream,
  seriesId,
}: {
  stream: main.PastStream
  seriesId: string
}) {
  const [episodic, setEpisodic] = useState(false)
  const [number, setNumber] = useState(
    stream.episodeNumber > 0 ? String(stream.episodeNumber) : '',
  )
  const [description, setDescription] = useState(
    stream.episodeDescription ?? '',
  )
  const [saved, setSaved] = useState(false)

  // Is the assigned series episodic (via its series type)?
  useEffect(() => {
    if (!seriesId) {
      setEpisodic(false)
      return
    }
    let cancelled = false
    Promise.all([GetContentSeries(), GetSeriesTypes()])
      .then(([series, types]) => {
        if (cancelled) return
        const s = (series ?? []).find((x) => x.id === seriesId)
        setEpisodic(
          Boolean((types ?? []).find((t) => t.id === s?.typeId)?.episodic),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [seriesId])

  // Read the current assignment fresh: the plan's episode adopts onto the
  // stream inside GetPastStreams, so the navigation prop can predate it (or
  // the series was just assigned on this page).
  useEffect(() => {
    if (!episodic) return
    let cancelled = false
    const keys = new Set(
      stream.broadcasts.map((b) => `${b.platform}|${b.url}`),
    )
    GetPastStreams(false)
      .then((streams) => {
        if (cancelled) return
        const cur = (streams ?? []).find((s) =>
          (s.broadcasts ?? []).some((b) => keys.has(`${b.platform}|${b.url}`)),
        )
        if (cur && cur.episodeNumber > 0) {
          setNumber(String(cur.episodeNumber))
          setDescription(cur.episodeDescription ?? '')
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [episodic, stream])

  if (!episodic) return null

  const parsed = Number(number)
  const valid = Number.isInteger(parsed) && parsed >= 1

  const save = async () => {
    if (!valid) return
    const keys = stream.broadcasts.map((b) => `${b.platform}|${b.url}`)
    try {
      await SetStreamEpisode(keys, parsed, description.trim())
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1_500)
    } catch {
      // Non-fatal; the values reconcile on the next load.
    }
  }

  return (
    <div className="mb-6 -mt-3 flex flex-wrap items-center gap-2">
      <label htmlFor="stream-episode" className="text-sm font-medium text-fg">
        Episode
      </label>
      <input
        id="stream-episode"
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={number}
        onChange={(e) => {
          setNumber(e.target.value)
          setSaved(false)
        }}
        className="w-20 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
      />
      <input
        aria-label="Episode description"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value)
          setSaved(false)
        }}
        placeholder="Short episode description"
        className="w-full max-w-md flex-1 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={!valid}
        className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
      >
        Save
      </button>
      {saved && (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <Check size={13} aria-hidden />
          Saved
        </span>
      )}
    </div>
  )
}

/**
 * Delete action for a stream's downloaded copy. For a local-only stream the
 * video file is the last remaining copy, so deleting removes the stream from
 * the history for good; for a stream the platforms still list, only the
 * local files go (the stream stays and can be downloaded again). Stored
 * chat, transcript, and outline survive either way. Both paths sit behind an
 * explicit confirmation.
 */
function DeleteDownloadSection({
  stream,
  download,
  onDeleted,
}: {
  stream: main.PastStream
  download: main.DownloadedVideo
  onDeleted: () => void
}) {
  const lastCopy = stream.local
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await DeleteLocalStream(download.subfolder)
      setConfirming(false)
      onDeleted()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not delete the download.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Delete downloaded video"
      className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
        >
          <HardDrive size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">
            {lastCopy ? 'Local copy only' : 'Downloaded video'}
          </p>
          <p className="mt-0.5 text-sm text-fg-muted">
            {lastCopy
              ? 'This stream is no longer available on its platforms; the downloaded video is the only remaining copy.'
              : 'A local copy of this stream is on disk. Deleting it frees the space — the stream stays listed on its platforms and can be downloaded again.'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/40 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
      >
        <Trash2 size={14} aria-hidden />
        {lastCopy ? 'Delete past stream' : 'Delete download'}
      </button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={lastCopy ? 'Delete this past stream?' : 'Delete this download?'}
        icon={<Trash2 size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          {lastCopy
            ? `“${stream.title || 'Untitled stream'}” only exists as a local download. Deleting it removes the video file from your computer and the stream from your history — it can't be recovered afterwards.`
            : `The downloaded video files for “${stream.title || 'Untitled stream'}” are removed from your computer. The stream itself stays listed, and its stored chat, transcript, and outline are kept.`}
        </p>
        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : lastCopy ? 'Delete stream' : 'Delete download'}
          </button>
        </div>
      </Modal>
    </section>
  )
}

/** One condensed, clickable video row for a channel's copy of the stream. */
function VideoRow({
  broadcast,
  download,
  onOpen,
  onPlay,
}: {
  broadcast: main.PastBroadcast
  download?: main.DownloadedVideo
  onOpen: () => void
  /** Present when a local download exists — plays it instead of opening info. */
  onPlay?: () => void
}) {
  const name = platformName(broadcast.platform)
  const meta = [
    formatDate(broadcast.startedAt),
    broadcast.duration,
    broadcast.viewCount > 0 ? `${formatCompact(broadcast.viewCount)} views` : '',
    // The platform no longer lists this VOD; the download is the only copy.
    broadcast.local ? 'Local copy' : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const downloaded = Boolean(download && onPlay)

  return (
    <li>
      <button
        type="button"
        onClick={downloaded ? onPlay : onOpen}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-surface-hover"
      >
        <BrandTile platform={broadcast.platform} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">
            {broadcast.title || name}
          </p>
          <p className="truncate text-xs text-fg-muted">
            {name}
            {meta && ` · ${meta}`}
          </p>
        </div>
        {downloaded ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-600/15 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-400">
            <PlayCircle size={14} aria-hidden />
            Play
          </span>
        ) : (
          <ChevronRight
            size={16}
            aria-hidden
            className="shrink-0 text-fg-muted"
          />
        )}
      </button>
    </li>
  )
}

/** One channel's specific stream info, in a dialog. */
function BroadcastDetailModal({
  broadcast,
  onClose,
}: {
  broadcast: main.PastBroadcast | null
  onClose: () => void
}) {
  if (!broadcast) return null
  const name = platformName(broadcast.platform)
  return (
    <Modal
      open
      onClose={onClose}
      title={broadcast.title || name}
      icon={<BrandTile platform={broadcast.platform} size={28} />}
    >
      <div className="flex flex-col gap-4">
        {broadcast.thumbnailUrl && (
          <img
            src={broadcast.thumbnailUrl}
            alt={`${name} thumbnail`}
            className="w-full rounded-lg border border-edge"
          />
        )}
        <dl className="divide-y divide-edge">
          <DetailRow label="Channel" value={name} />
          <DetailRow
            label="Went live"
            value={formatDateTime(broadcast.startedAt) || '—'}
          />
          <DetailRow label="Duration" value={broadcast.duration || '—'} />
          <DetailRow
            label="Views"
            value={
              broadcast.viewCount > 0 ? formatNumber(broadcast.viewCount) : '—'
            }
          />
        </dl>
        {broadcast.local ? (
          // The platform removed this VOD; linking out would 404.
          <p className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2 text-sm font-medium text-fg-muted">
            <HardDrive size={16} aria-hidden />
            No longer available on {name} — only the local copy remains
          </p>
        ) : (
          <button
            type="button"
            onClick={() => openExternal(broadcast.url)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <ExternalLink size={16} aria-hidden />
            Watch on {name}
          </button>
        )}
      </div>
    </Modal>
  )
}

export function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon size={16} aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold text-fg">{value}</p>
    </div>
  )
}

export function DetailRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-right text-sm font-medium text-fg">
        {value}
      </dd>
    </div>
  )
}


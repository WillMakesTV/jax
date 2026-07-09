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
  PlayCircle,
  Radio,
  RefreshCw,
  Trash2,
  Video,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {
  DeleteLocalStream,
  GetContentSeries,
  GetPastStreams,
  GetSeriesTypes,
  SetPastStreamSeries,
  SetStreamEpisode,
  StartDownload,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {Modal} from '../components/Modal'
import {PageHeader} from '../components/PageHeader'
import {OutlinePanel} from '../components/OutlinePanel'
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

export type StreamTab = 'overview' | 'chat' | 'events' | 'transcript' | 'outline'

interface StreamDetailsProps {
  stream: main.PastStream
  /** Tab to open on; navigation (e.g. the status bar's outline chip) sets it. */
  initialTab?: StreamTab
  onBack: () => void
  /** Open a downloaded broadcast's video page (player + chat + transcript). */
  onOpenDownload: (download: main.DownloadedVideo) => void
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
      const name = stream.title || `Stream ${formatDate(stream.startedAt)}`
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
        thumbnailUrl:
          picks.find((b) => b.thumbnailUrl)?.thumbnailUrl ||
          stream.thumbnailUrl,
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
        Back to Past Streams
      </button>

      <PageHeader
        description={`${clusters.length} broadcast${
          clusters.length === 1 ? '' : 's'
        } across ${channelCount} channel${channelCount === 1 ? '' : 's'}.`}
      />

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
          title={stream.title || `Stream ${formatDate(stream.startedAt)}`}
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

      {/* The concluded plan's description and custom data live on with the
          stream (see conclude.go). */}
      {stream.plan &&
        (stream.plan.description || (stream.plan.tags ?? []).length > 0) && (
          <section
            aria-label="Episode details from the concluded plan"
            className="mb-6 rounded-xl border border-edge bg-surface p-4"
          >
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
              Episode details
            </h2>
            {stream.plan.description && (
              <p className="whitespace-pre-wrap text-sm text-fg">
                {stream.plan.description}
              </p>
            )}
            {(stream.plan.tags ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(stream.plan.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

      {/* Summary: thumbnail + aggregate tiles. */}
      <section
        aria-label="Stream summary"
        className="flex flex-col gap-4 lg:flex-row"
      >
        {streamDownload ? (
          <div className="flex w-full max-w-md flex-col gap-2">
            <button
              type="button"
              onClick={() => onOpenDownload(streamDownload)}
              aria-label="Play downloaded video"
              className="group relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-black"
            >
              {(streamDownload.thumbnailUrl || stream.thumbnailUrl) && (
                <img
                  src={streamDownload.thumbnailUrl || stream.thumbnailUrl}
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
          </div>
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
            className="group relative aspect-video w-full max-w-md overflow-hidden rounded-xl border border-edge bg-black"
          >
            {stream.thumbnailUrl ? (
              <img
                src={stream.thumbnailUrl}
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
        ) : stream.thumbnailUrl ? (
          <img
            src={stream.thumbnailUrl}
            alt={`${stream.title || 'Stream'} thumbnail`}
            className="aspect-video w-full max-w-md rounded-xl border border-edge object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full max-w-md items-center justify-center rounded-xl border border-edge bg-surface text-fg-muted">
            <Video size={32} aria-hidden />
          </div>
        )}

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

      {/* Videos grouped by broadcast segment. A single simulcast is one group
          (rendered without a header); multi-sitting streams show one header
          per broadcast so the same broadcast across channels sits together. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-fg-muted">
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

      {/* A local-only stream's downloaded copy is its last copy; deleting it
          removes the stream for good, so it needs an explicit confirmation. */}
      {stream.local && streamDownload && (
        <DeleteLocalStreamSection
          stream={stream}
          download={streamDownload}
          onDeleted={() => {
            refreshDownloads()
            onBack()
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
 * Hidden unless the assigned series' type is episodic. Numbers initialise by
 * date on the backend (oldest stream = episode one); both fields are editable
 * here, persisted per broadcast like the series assignment.
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

  // Read the current assignment fresh: default initialisation happens inside
  // GetPastStreams, so the navigation prop can predate it (or the series was
  // just assigned on this page).
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
 * Delete action for a stream that only exists as a local download. The video
 * file is the last remaining copy, so deletion sits behind a confirmation.
 */
function DeleteLocalStreamSection({
  stream,
  download,
  onDeleted,
}: {
  stream: main.PastStream
  download: main.DownloadedVideo
  onDeleted: () => void
}) {
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
          : 'Could not delete the past stream.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Delete past stream"
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
          <p className="text-sm font-semibold text-fg">Local copy only</p>
          <p className="mt-0.5 text-sm text-fg-muted">
            This stream is no longer available on its platforms; the downloaded
            video is the only remaining copy.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-600/40 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
      >
        <Trash2 size={14} aria-hidden />
        Delete past stream
      </button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this past stream?"
        icon={<Trash2 size={18} aria-hidden className="text-fg-muted" />}
      >
        <p className="text-sm text-fg-muted">
          “{stream.title || 'Untitled stream'}” only exists as a local
          download. Deleting it removes the video file from your computer and
          the stream from your history — it can't be recovered afterwards.
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
            {busy ? 'Deleting…' : 'Delete stream'}
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


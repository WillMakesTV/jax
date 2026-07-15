import {
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Eye,
  Gauge,
  Radio,
  Users,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  GetContentSeries,
  GetLiveStreamMeta,
  GetSeriesTypes,
  NextEpisodeNumber,
  SetPastStreamSeries,
  SetStreamEpisode,
} from '../../wailsjs/go/main/App'
import clsx from 'clsx'
import {main} from '../../wailsjs/go/models'
import {BrandTile} from '../components/BrandTile'
import {PageHeader} from '../components/PageHeader'
import {ChatPanel} from '../chat/ChatPanel'
import {useChat} from '../chat/ChatProvider'
import {EventsPanel} from '../events/EventsPanel'
import {useEvents} from '../events/EventsProvider'
import {TranscriptPanel} from '../transcript/TranscriptPanel'
import {openExternal} from '../lib/browser'
import {
  formatCompact,
  formatDateTime,
  formatDurationMs,
  formatKbps,
  formatNumber,
  formatUptime,
} from '../lib/format'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {platformName} from '../services/services'
import {DetailRow, SummaryTile} from './StreamDetails'

interface LiveStreamDetailsProps {
  onBack: () => void
}

/** The live details page's tabs. */
type LiveDetailsTab = 'overview' | 'chat' | 'events' | 'transcript'

/**
 * Detail view for the current live stream: an overview (aggregate metrics,
 * series/episode assignment, and a card per broadcasting channel) plus the
 * stream's chat, events, and live transcript — the same feeds as the
 * Broadcast section, and the transcript is stored as part of this stream.
 */
export function LiveStreamDetails({onBack}: LiveStreamDetailsProps) {
  const {platforms, obs, requestFastPolling} = useLiveData()
  const {unreadCount: unreadChat} = useChat()
  const {unreadCount: unreadEvents} = useEvents()
  const [tab, setTab] = useState<LiveDetailsTab>('overview')

  // Detailed metrics view: poll platforms at the fast cadence while open.
  useEffect(() => requestFastPolling(), [requestFastPolling])

  const live = platforms.filter((p) => p.live)
  const {totalViewers, uptimeMs} = aggregateLive(platforms, obs)

  const tabs: {id: LiveDetailsTab; label: string; badge?: number}[] = [
    {id: 'overview', label: 'Overview'},
    {id: 'chat', label: 'Chat', badge: unreadChat},
    {id: 'events', label: 'Events', badge: unreadEvents},
    {id: 'transcript', label: 'Transcript'},
  ]

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

      {live.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-12 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Radio size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">
            The stream has ended
          </p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Once its VODs are processed it will appear under Broadcasting.
          </p>
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Live stream sections"
            className="mb-4 flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
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
                {Boolean(t.badge) && (
                  <span
                    className={clsx(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                      tab === t.id
                        ? 'bg-accent-fg/20 text-accent-fg'
                        : 'bg-accent text-accent-fg',
                    )}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === 'chat' && <ChatPanel />}
          {tab === 'events' && <EventsPanel />}
          {tab === 'transcript' && <TranscriptPanel />}
          {tab === 'overview' && (
            <>
              <PageHeader
                description={`Live on ${live
                  .map((p) => platformName(p.platform))
                  .join(' + ')}.`}
              />

              <LiveSeriesEpisode
                startedAt={
                  live.map((p) => p.startedAt).filter(Boolean).sort()[0] ?? ''
                }
              />

              {/* Aggregate metrics. */}
              <section
                aria-label="Live summary"
                className="grid grid-cols-2 gap-4 lg:grid-cols-4"
              >
                <SummaryTile
                  icon={Users}
                  label="Total viewers"
                  value={formatCompact(totalViewers)}
                />
                <SummaryTile
                  icon={Clock}
                  label="Uptime"
                  value={uptimeMs !== null ? formatDurationMs(uptimeMs) : '—'}
                />
                <SummaryTile
                  icon={Radio}
                  label="Live channels"
                  value={String(live.length)}
                />
                <SummaryTile
                  icon={Gauge}
                  label="Encoder"
                  value={
                    obs?.outputActive
                      ? obs.kbps !== null
                        ? formatKbps(obs.kbps)
                        : 'Streaming'
                      : '—'
                  }
                />
              </section>

              {/* Per-channel live details. */}
              <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-fg-muted">
                Channel details
              </h2>
              <div className="grid grid-cols-1 gap-4 pb-8 sm:grid-cols-2">
                {live.map((p) => (
                  <LiveChannelCard key={p.platform} stream={p} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Series/episode assignment for the running broadcast, mirroring the past
 * stream details page. VOD urls don't exist yet, so assignments key on the
 * go-live time ("live|<startedAt>"); once the finished stream's VODs appear,
 * the backend adopts them onto its broadcast keys automatically.
 */
function LiveSeriesEpisode({startedAt}: {startedAt: string}) {
  const [series, setSeries] = useState<main.ContentSeries[]>([])
  const [types, setTypes] = useState<main.SeriesType[]>([])
  const [seriesId, setSeriesId] = useState('')
  const [number, setNumber] = useState('')
  const [description, setDescription] = useState('')
  const [savedSeries, setSavedSeries] = useState(false)
  const [savedEpisode, setSavedEpisode] = useState(false)

  const liveKey = `live|${startedAt}`

  useEffect(() => {
    if (!startedAt) return
    let cancelled = false
    Promise.all([GetContentSeries(), GetSeriesTypes(), GetLiveStreamMeta(startedAt)])
      .then(([s, t, meta]) => {
        if (cancelled) return
        setSeries(s ?? [])
        setTypes(t ?? [])
        setSeriesId(meta.seriesId ?? '')
        if (meta.episodeNumber > 0) setNumber(String(meta.episodeNumber))
        setDescription(meta.episodeDescription ?? '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [startedAt])

  const episodic = Boolean(
    types.find((t) => t.id === series.find((s) => s.id === seriesId)?.typeId)
      ?.episodic,
  )

  // An episodic assignment without a number yet slots in as the next episode.
  useEffect(() => {
    if (!episodic || !seriesId || number !== '') return
    let cancelled = false
    NextEpisodeNumber(seriesId)
      .then((n) => {
        if (!cancelled && n > 0) setNumber((cur) => (cur === '' ? String(n) : cur))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [episodic, seriesId, number])

  if (!startedAt || series.length === 0) return null

  const changeSeries = async (id: string) => {
    setSeriesId(id)
    try {
      await SetPastStreamSeries([liveKey], id)
      setSavedSeries(true)
      window.setTimeout(() => setSavedSeries(false), 1_500)
    } catch {
      // Non-fatal; the value reconciles on the next load.
    }
  }

  const parsed = Number(number)
  const valid = Number.isInteger(parsed) && parsed >= 1

  const saveEpisode = async () => {
    if (!valid) return
    try {
      await SetStreamEpisode([liveKey], parsed, description.trim())
      setSavedEpisode(true)
      window.setTimeout(() => setSavedEpisode(false), 1_500)
    } catch {
      // Non-fatal; the values reconcile on the next load.
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="live-series" className="text-sm font-medium text-fg">
          Series
        </label>
        <select
          id="live-series"
          value={seriesId}
          onChange={(e) => void changeSeries(e.target.value)}
          className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
        >
          <option value="">None</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        {savedSeries && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check size={13} aria-hidden />
            Saved
          </span>
        )}
      </div>

      {episodic && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="live-episode" className="text-sm font-medium text-fg">
            Episode
          </label>
          <input
            id="live-episode"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={number}
            onChange={(e) => {
              setNumber(e.target.value)
              setSavedEpisode(false)
            }}
            className="w-20 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
          <input
            aria-label="Episode description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setSavedEpisode(false)
            }}
            placeholder="Short episode description"
            className="w-full max-w-md flex-1 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void saveEpisode()}
            disabled={!valid}
            className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Save
          </button>
          {savedEpisode && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check size={13} aria-hidden />
              Saved
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function LiveChannelCard({stream}: {stream: main.LiveStream}) {
  const name = platformName(stream.platform)
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface">
      <div className="flex items-center gap-3 border-b border-edge p-4">
        <BrandTile platform={stream.platform} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">
            {stream.channelName || name}
          </p>
          {/* Each channel keeps its own live title. */}
          <p className="truncate text-xs text-fg-muted">
            {stream.title || 'Untitled broadcast'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-500 dark:text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
          Live
        </span>
      </div>

      {stream.thumbnailUrl && (
        <img
          src={stream.thumbnailUrl}
          alt={`${name} live preview`}
          className="aspect-video w-full object-cover"
        />
      )}

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-4 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <Eye size={14} aria-hidden />
            {formatNumber(stream.viewerCount)} watching
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={14} aria-hidden />
            {formatUptime(stream.startedAt)}
          </span>
        </div>

        <dl className="divide-y divide-edge">
          {stream.category && (
            <DetailRow label="Category" value={stream.category} />
          )}
          <DetailRow
            label="Went live"
            value={formatDateTime(stream.startedAt) || '—'}
          />
          {(stream.details ?? []).map((d) => (
            <DetailRow key={d.label} label={d.label} value={d.value} />
          ))}
        </dl>

        <div className="mt-4 flex gap-3">
          {stream.streamUrl && (
            <button
              type="button"
              onClick={() => openExternal(stream.streamUrl)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <ExternalLink size={16} aria-hidden />
              Watch stream
            </button>
          )}
          {stream.channelUrl && (
            <button
              type="button"
              onClick={() => openExternal(stream.channelUrl)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-edge bg-bg px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
            >
              <ExternalLink size={16} aria-hidden />
              Open channel
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

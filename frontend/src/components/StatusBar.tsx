import {
  Bell,
  Captions,
  Clock,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Music,
  NotebookText,
  Users,
  Video,
  VideoOff,
  VolumeX,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useChat} from '../chat/ChatProvider'
import {useDownloadStatus} from '../downloads/DownloadProvider'
import {useEvents} from '../events/EventsProvider'
import {useCaptureHidden} from '../lib/captureHidden'
import {formatCompact, formatDurationMs, formatKbps} from '../lib/format'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'
import {
  useOutlineJobs,
  type OutlineJob,
  type OutlineNotice,
} from '../outline/OutlineProvider'
import {
  useVodTranscribe,
  type VodJob,
  type VodNotice,
} from '../transcript/VodTranscribeProvider'

interface StatusBarProps {
  /** Navigate to the Chat page (unread-messages notification). */
  onOpenChat: () => void
  /** Navigate to the Live Events tab (unread-events notification). */
  onOpenEvents: () => void
  /** Open the past stream whose video is being downloaded (by startedAt). */
  onOpenDownloading: (startedAt: string) => void
  /** Open the stream whose download is being transcribed (by subfolder). */
  onOpenTranscribing: (subfolder: string) => void
  /** Open the Outline tab of the stream whose outline is generating. */
  onOpenOutline: (startedAt: string) => void
}

/**
 * Subtle app-wide status strip pinned to the bottom of the window: live
 * indicator, uptime, unread chat/event notifications, encoder health, and
 * total viewers across all channels.
 */
export function StatusBar({
  onOpenChat,
  onOpenEvents,
  onOpenDownloading,
  onOpenTranscribing,
  onOpenOutline,
}: StatusBarProps) {
  const {platforms, obs, mics, music, camera, micSourceName, obsConnected} =
    useLiveData()
  const {unreadCount} = useChat()
  const {unreadCount: unreadEvents} = useEvents()
  const download = useDownloadStatus()
  const vodTranscribe = useVodTranscribe()
  const outline = useOutlineJobs()

  // Prefer the designated primary mic; otherwise "on" when any mic is
  // unmuted. Hidden entirely when OBS is away or has no mic devices.
  const primaryMic = micSourceName
    ? mics.find((m) => m.name === micSourceName)
    : undefined
  const micOn = primaryMic ? !primaryMic.muted : mics.some((m) => !m.muted)
  const {anyLive, liveCount, totalViewers, uptimeMs} = aggregateLive(
    platforms,
    obs,
  )

  // Uptime derives from timestamps, so re-render periodically while live to
  // keep it fresh between (potentially slow) data polls.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!anyLive) return
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000)
    return () => window.clearInterval(id)
  }, [anyLive])

  const encoder = !obsConnected
    ? 'Encoder off'
    : obs?.outputReconnecting
      ? 'Encoder reconnecting…'
      : obs?.outputActive
        ? `${obs.kbps !== null ? formatKbps(obs.kbps) : 'Streaming'} · ${Math.round(obs.activeFps)} fps`
        : 'Encoder idle'

  return (
    <footer
      aria-label="Stream status"
      className="flex h-7 shrink-0 items-center gap-5 border-t border-edge bg-surface px-4 text-xs text-fg-muted"
    >
      {/* Live indicator */}
      <span className="inline-flex items-center gap-1.5">
        {anyLive ? (
          <>
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="font-semibold text-red-500 dark:text-red-400">
              Live
            </span>
            {liveCount > 1 && <span>on {liveCount} channels</span>}
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-fg-muted" aria-hidden />
            Offline
          </>
        )}
      </span>

      {/* Uptime (only meaningful while live) */}
      {anyLive && (
        <span className="inline-flex items-center gap-1.5">
          <Clock size={12} aria-hidden />
          {uptimeMs !== null ? formatDurationMs(uptimeMs) : '—'}
        </span>
      )}

      {/* Mic state across OBS's audio input capture devices. */}
      {obsConnected && mics.length > 0 && (
        <span
          className={
            micOn
              ? 'inline-flex items-center gap-1.5 font-semibold text-green-600 dark:text-green-400'
              : 'inline-flex items-center gap-1.5 font-semibold text-red-500 dark:text-red-400'
          }
        >
          {micOn ? (
            <Mic size={12} aria-hidden />
          ) : (
            <MicOff size={12} aria-hidden />
          )}
          {micOn ? 'Mic on' : 'Mic off'}
        </span>
      )}

      {/* Music state: the Application Audio Capture source designated in
          Primary Sources. Hidden until one is designated. */}
      {obsConnected && music && (
        <span
          title={music.name}
          className={
            music.muted
              ? 'inline-flex items-center gap-1.5 font-semibold text-red-500 dark:text-red-400'
              : 'inline-flex items-center gap-1.5 font-semibold text-green-600 dark:text-green-400'
          }
        >
          {music.muted ? (
            <VolumeX size={12} aria-hidden />
          ) : (
            <Music size={12} aria-hidden />
          )}
          {music.muted ? 'Music off' : 'Music on'}
        </span>
      )}

      {/* Primary webcam of the active scene: shown/hidden. Hidden until a
          camera is designated for the active scene. */}
      {obsConnected && camera && (
        <span
          title={`${camera.name} · ${camera.sceneName}`}
          className={
            camera.enabled
              ? 'inline-flex items-center gap-1.5 font-semibold text-green-600 dark:text-green-400'
              : 'inline-flex items-center gap-1.5 font-semibold text-red-500 dark:text-red-400'
          }
        >
          {camera.enabled ? (
            <Video size={12} aria-hidden />
          ) : (
            <VideoOff size={12} aria-hidden />
          )}
          {camera.enabled ? 'Camera on' : 'Camera off'}
        </span>
      )}

      {/* Download / processing status from the sidecar; when the download's
          source stream is known, the chip clicks through to it. */}
      {download.state !== 'idle' &&
        (() => {
          const cls =
            download.state === 'error'
              ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 dark:text-red-400'
              : download.state === 'done'
                ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 dark:text-green-400'
                : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-fg'
          const body = (
            <>
              {download.state === 'running' ? (
                <Loader2 size={12} aria-hidden className="animate-spin" />
              ) : (
                <Download size={12} aria-hidden />
              )}
              <span className="max-w-[22rem] truncate">
                {download.state === 'done' ? '✓ ' : ''}
                {download.detail}
              </span>
            </>
          )
          return download.startedAt ? (
            <button
              type="button"
              onClick={() => onOpenDownloading(download.startedAt)}
              title="Open the stream being downloaded"
              className={`${cls} transition-colors hover:text-accent`}
            >
              {body}
            </button>
          ) : (
            <span title={download.detail} className={cls}>
              {body}
            </span>
          )
        })()}

      {/* Downloaded-video transcription queue; click through to the stream
          being transcribed. */}
      <TranscribeStatus
        jobs={vodTranscribe.jobs}
        notice={vodTranscribe.notice}
        onOpen={onOpenTranscribing}
      />

      {/* Outline generation; click through to the stream's Outline tab. */}
      <OutlineStatus
        jobs={outline.jobs}
        notice={outline.notice}
        onOpen={onOpenOutline}
      />

      {/* Unread events notification; click through to the Live Events tab. */}
      {unreadEvents > 0 && (
        <button
          type="button"
          onClick={onOpenEvents}
          title="Open live events"
          className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Bell size={12} aria-hidden />
          {formatCompact(unreadEvents)} {unreadEvents === 1 ? 'event' : 'events'}
        </button>
      )}

      {/* Unread chat notification; click through to the Chat page. */}
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={onOpenChat}
          title="Open chat"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          <MessageSquare size={12} aria-hidden />
          {formatCompact(unreadCount)} unread
        </button>
      )}

      {/* Right-aligned: encoder + viewers (while live) + capture visibility */}
      <span className="ml-auto inline-flex items-center gap-1.5">
        <Gauge size={12} aria-hidden />
        {encoder}
      </span>
      {anyLive && (
        <span className="inline-flex items-center gap-1.5">
          <Users size={12} aria-hidden />
          {formatCompact(totalViewers)} viewers
        </span>
      )}
      <CaptureVisibilityToggle />
    </footer>
  )
}

/**
 * Eye button mirroring Settings → Streams → "Hide application from screen
 * capture": closed eye = the window is invisible to captures and screen
 * shares, open eye = capturable. Clicking flips it; the shared hook keeps it
 * in sync with the settings toggle.
 */
function CaptureVisibilityToggle() {
  const [hidden, setHidden] = useCaptureHidden()
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      await setHidden(!hidden)
    } catch {
      // Unsupported here (e.g. old Windows); the settings page explains why.
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={hidden}
      aria-label="Hide application from screen capture"
      onClick={() => void toggle()}
      disabled={busy}
      title={
        hidden
          ? 'Hidden from screen capture — captures, shares and screenshots can’t see this app. Click to make it capturable.'
          : 'Visible to screen capture. Click to hide this app from captures, screen shares and screenshots.'
      }
      className={
        hidden
          ? 'inline-flex items-center text-accent transition-colors hover:text-fg disabled:opacity-50'
          : 'inline-flex items-center text-fg-muted transition-colors hover:text-fg disabled:opacity-50'
      }
    >
      {hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
    </button>
  )
}

/**
 * Outline-generation chip: while a run is in flight it is a button that jumps
 * to that stream's Outline tab; afterwards the end-of-run notice lingers
 * briefly (also clickable when the outline is ready).
 */
function OutlineStatus({
  jobs,
  notice,
  onOpen,
}: {
  jobs: OutlineJob[]
  notice: OutlineNotice | null
  onOpen: (startedAt: string) => void
}) {
  if (jobs.length > 0) {
    const label =
      jobs.length === 1
        ? `Building outline — ${jobs[0].title || 'stream'}`
        : `Building ${jobs.length} outlines`
    return (
      <button
        type="button"
        onClick={() => onOpen(jobs[0].startedAt)}
        title="Open the stream's outline"
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg transition-colors hover:text-accent"
      >
        <Loader2 size={12} aria-hidden className="animate-spin" />
        <span className="max-w-[22rem] truncate">{label}</span>
      </button>
    )
  }

  if (!notice) return null
  if (notice.state === 'done') {
    return (
      <button
        type="button"
        onClick={() => onOpen(notice.startedAt)}
        title="Open the outline"
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 transition-colors hover:text-accent dark:text-green-400"
      >
        <NotebookText size={12} aria-hidden />
        <span className="max-w-[22rem] truncate">✓ {notice.detail}</span>
      </button>
    )
  }
  return (
    <span
      title={notice.detail}
      className="inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 dark:text-red-400"
    >
      <NotebookText size={12} aria-hidden />
      <span className="max-w-[22rem] truncate">{notice.detail}</span>
    </span>
  )
}

/**
 * Transcription-queue chip: while jobs exist it is a button that jumps to the
 * stream being transcribed; afterwards the end-of-run notice lingers briefly.
 */
function TranscribeStatus({
  jobs,
  notice,
  onOpen,
}: {
  jobs: VodJob[]
  notice: VodNotice | null
  onOpen: (subfolder: string) => void
}) {
  if (jobs.length > 0) {
    const running = jobs.filter((j) => j.state === 'running')
    const queued = jobs.length - running.length
    const label =
      running.length === 0
        ? `${queued} queued for transcription`
        : running.length === 1 && queued === 0
          ? running[0].detail
          : `Transcribing ${running.length} video${running.length === 1 ? '' : 's'}${
              queued > 0 ? ` · ${queued} queued` : ''
            }`
    const target = running[0] ?? jobs[0]
    return (
      <button
        type="button"
        onClick={() => onOpen(target.subfolder)}
        title="Open the stream being transcribed"
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg transition-colors hover:text-accent"
      >
        <Loader2 size={12} aria-hidden className="animate-spin" />
        <span className="max-w-[22rem] truncate">{label}</span>
      </button>
    )
  }

  if (!notice) return null
  return (
    <span
      title={notice.detail}
      className={
        notice.state === 'error'
          ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 dark:text-red-400'
          : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 dark:text-green-400'
      }
    >
      <Captions size={12} aria-hidden />
      <span className="max-w-[22rem] truncate">
        {notice.state === 'done' ? '✓ ' : ''}
        {notice.detail}
      </span>
    </span>
  )
}

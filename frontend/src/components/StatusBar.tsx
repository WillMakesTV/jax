import {
  Bell,
  Clock,
  Download,
  Gauge,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Music,
  Users,
  Video,
  VideoOff,
  VolumeX,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useChat} from '../chat/ChatProvider'
import {useDownloadStatus} from '../downloads/DownloadProvider'
import {useEvents} from '../events/EventsProvider'
import {formatCompact, formatDurationMs, formatKbps} from '../lib/format'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'

interface StatusBarProps {
  /** Navigate to the Chat page (unread-messages notification). */
  onOpenChat: () => void
  /** Navigate to the Live Events tab (unread-events notification). */
  onOpenEvents: () => void
}

/**
 * Subtle app-wide status strip pinned to the bottom of the window: live
 * indicator, uptime, unread chat/event notifications, encoder health, and
 * total viewers across all channels.
 */
export function StatusBar({onOpenChat, onOpenEvents}: StatusBarProps) {
  const {platforms, obs, mics, music, camera, micSourceName, obsConnected} =
    useLiveData()
  const {unreadCount} = useChat()
  const {unreadCount: unreadEvents} = useEvents()
  const download = useDownloadStatus()

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

      {/* Uptime */}
      <span className="inline-flex items-center gap-1.5">
        <Clock size={12} aria-hidden />
        {uptimeMs !== null ? formatDurationMs(uptimeMs) : '—'}
      </span>

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

      {/* Download / processing status from the sidecar. */}
      {download.state !== 'idle' && (
        <span
          title={download.detail}
          className={
            download.state === 'error'
              ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 dark:text-red-400'
              : download.state === 'done'
                ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 dark:text-green-400'
                : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-fg'
          }
        >
          {download.state === 'running' ? (
            <Loader2 size={12} aria-hidden className="animate-spin" />
          ) : (
            <Download size={12} aria-hidden />
          )}
          <span className="max-w-[22rem] truncate">
            {download.state === 'done' ? '✓ ' : ''}
            {download.detail}
          </span>
        </span>
      )}

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

      {/* Right-aligned: encoder + viewers */}
      <span className="ml-auto inline-flex items-center gap-1.5">
        <Gauge size={12} aria-hidden />
        {encoder}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Users size={12} aria-hidden />
        {anyLive ? `${formatCompact(totalViewers)} viewers` : '—'}
      </span>
    </footer>
  )
}

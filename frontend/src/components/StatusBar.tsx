import {Clock, Gauge, Users} from 'lucide-react'
import {useEffect, useState} from 'react'
import {formatCompact, formatDurationMs, formatKbps} from '../lib/format'
import {aggregateLive, useLiveData} from '../live/LiveDataProvider'

/**
 * Subtle app-wide status strip pinned to the bottom of the window: live
 * indicator, uptime, encoder health, and total viewers across all channels.
 */
export function StatusBar() {
  const {platforms, obs, obsConnected} = useLiveData()
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

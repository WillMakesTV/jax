import {
  ArrowRight,
  Bell,
  MessageSquare,
  MonitorPlay,
  Plug,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import {useChat} from '../chat/ChatProvider'
import {useEvents} from '../events/EventsProvider'
import {StatusPill} from '../live/LiveOverview'
import {useLiveData} from '../live/LiveDataProvider'
import {MixerPanel} from '../obs/MixerPanel'
import {useObsPreview} from '../obs/useObsPreview'

/** ~10 fps for the small dashboard preview. */
const COMPACT_FRAME_MS = 100

interface LiveDashboardProps {
  /** Open the OBS Studio section. */
  onOpenObs: () => void
  /** Open the Chat tab. */
  onOpenChat: () => void
  /** Open the Events tab. */
  onOpenEvents: () => void
}

/**
 * The Broadcast section's Live Dashboard tab: stream-action and unread cards
 * up top, then a small OBS program preview with the primary sources.
 */
export function LiveDashboard({
  onOpenObs,
  onOpenChat,
  onOpenEvents,
}: LiveDashboardProps) {
  const {unreadCount: unreadChat} = useChat()
  const {unreadCount: unreadEvents} = useEvents()

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* OBS preview + sources (2x), notifications alongside (1x). */}
      <div className="min-w-0 lg:flex-[2]">
        <ObsSection onOpenObs={onOpenObs} />
      </div>

      <div className="lg:flex-[1]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Notifications
        </h2>
        <div className="flex flex-col gap-4">
          <UnreadCard
            icon={MessageSquare}
            label="Unread messages"
            hint="from the unified chat"
            count={unreadChat}
            onClick={onOpenChat}
          />
          <UnreadCard
            icon={Bell}
            label="Unread events"
            hint="follows, subs & more"
            count={unreadEvents}
            onClick={onOpenEvents}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function UnreadCard({
  icon: Icon,
  label,
  hint,
  count,
  onClick,
}: {
  icon: LucideIcon
  label: string
  hint: string
  count: number
  onClick: () => void
}) {
  const active = count > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-xl border bg-surface p-4 text-left transition-colors hover:bg-surface-hover',
        active ? 'border-accent/50' : 'border-edge',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-accent text-accent-fg' : 'bg-surface-hover text-fg-muted',
        )}
      >
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold text-fg">{count}</span>
          <span className="truncate text-sm font-medium text-fg">{label}</span>
        </div>
        <p className="truncate text-xs text-fg-muted">{hint}</p>
      </div>
      <ArrowRight size={16} aria-hidden className="shrink-0 text-fg-muted" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// OBS preview + primary sources
// ---------------------------------------------------------------------------

function ObsSection({onOpenObs}: {onOpenObs: () => void}) {
  const {obs, obsConnected} = useLiveData()
  const {preview, sceneName} = useObsPreview(COMPACT_FRAME_MS)
  const streaming = Boolean(obs?.outputActive)
  const reconnecting = Boolean(obs?.outputReconnecting)

  if (!obsConnected) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-edge bg-surface p-5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
        >
          <Plug size={20} />
        </span>
        <p className="text-sm text-fg-muted">
          OBS is not connected. Connect it in Settings → Services to see the
          preview and control your sources here.
        </p>
      </div>
    )
  }

  return (
    <section aria-label="Live dashboard">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          OBS
        </h2>
        <button
          type="button"
          onClick={onOpenObs}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted transition-colors hover:text-fg"
        >
          Open OBS Studio
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>

      {/* Preview (2x) with primary sources (1x). Compact fixed height; the
          preview fills it and the sources scroll within it. */}
      <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-surface p-4 sm:h-72 sm:flex-row sm:items-stretch">
        <button
          type="button"
          onClick={onOpenObs}
          aria-label="Open OBS Studio"
          className="group relative block w-full min-w-0 overflow-hidden rounded-xl border border-edge bg-black text-left transition-opacity hover:opacity-95 sm:flex-[2]"
        >
          {preview ? (
            <img
              src={preview}
              alt={`OBS program output${sceneName ? ` — scene ${sceneName}` : ''}`}
              className="aspect-video w-full object-contain sm:aspect-auto sm:h-full"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center text-fg-muted sm:aspect-auto sm:h-full">
              <MonitorPlay size={24} aria-hidden />
            </div>
          )}
          <span className="absolute left-1.5 top-1.5">
            <StatusPill
              live={streaming || reconnecting}
              label={
                reconnecting ? 'Reconnecting' : streaming ? 'On air' : 'Preview'
              }
            />
          </span>
          {sceneName && (
            <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {sceneName}
            </span>
          )}
        </button>

        <div className="flex min-w-0 flex-col sm:h-full sm:flex-[1] sm:border-l sm:border-edge sm:pl-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Primary Sources
          </h3>
          <div className="min-h-0 sm:flex-1 sm:overflow-y-auto">
            <MixerPanel compact />
          </div>
        </div>
      </div>
    </section>
  )
}

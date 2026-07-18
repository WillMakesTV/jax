import {
  Bell,
  BugOff,
  Captions,
  Clapperboard,
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
  Scissors,
  ScrollText,
  Sparkles,
  Users,
  Video,
  VideoOff,
  VolumeX,
  WandSparkles,
} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {
  DismissFixNotice,
  GetPostStreamStatus,
  ListFixNotices,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'
import {useChat} from '../chat/ChatProvider'
import {
  useClipIdeas,
  type ClipIdeasJob,
  type ClipIdeasNotice,
} from '../clips/ClipIdeasProvider'
import {useDownloadStatus} from '../downloads/DownloadProvider'
import {
  useEditSession,
  type EditSessionNotice,
  type EditSessionState,
  type ScriptJobState,
  type ScriptNotice,
} from '../editor/EditSessionProvider'
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
  usePlanAi,
  type PlanAiJob,
  type PlanAiNotice,
} from '../plans/PlanAiProvider'
import {
  useVodTranscribe,
  type VodJob,
  type VodNotice,
} from '../transcript/VodTranscribeProvider'
import type {StreamTab} from '../views/StreamDetails'

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
  /** Open the Clips tab of the stream whose script ideas are generating. */
  onOpenClipIdeas: (startedAt: string) => void
  /** Open the Publish tab of the plan whose thumbnail/listing is generating. */
  onOpenPlanAi: (planId: string) => void
  /** Open the Editor tab of the video plan with the active edit session. */
  onOpenEditSession: (planId: string) => void
  /** Open the past stream the post-stream wrap-up is processing, on the tab
   *  matching the pipeline's stage (null = overview). */
  onOpenPostStream: (startedAt: string, tab: StreamTab | null) => void
  /** Open the page a resolved bug report was filed on. */
  onOpenFixNotice: (notice: main.FixNotice) => void
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
  onOpenClipIdeas,
  onOpenPlanAi,
  onOpenEditSession,
  onOpenPostStream,
  onOpenFixNotice,
}: StatusBarProps) {
  const {platforms, obs, mics, music, camera, micSourceName, obsConnected} =
    useLiveData()
  const {unreadCount} = useChat()
  const {unreadCount: unreadEvents} = useEvents()
  const download = useDownloadStatus()
  const vodTranscribe = useVodTranscribe()
  const outline = useOutlineJobs()
  const clipIdeas = useClipIdeas()
  const planAi = usePlanAi()
  const editSession = useEditSession()

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

      {/* Clip-script pitching; click through to the stream's Clips tab. */}
      <ClipIdeasStatus
        jobs={clipIdeas.jobs}
        notice={clipIdeas.notice}
        onOpen={onOpenClipIdeas}
        onDismiss={clipIdeas.dismissNotice}
      />

      {/* AI thumbnail/listing generation for a video plan; click through to
          the plan's Publish tab to review the result. */}
      <PlanAiStatus
        jobs={planAi.jobs}
        notice={planAi.notice}
        onOpen={onOpenPlanAi}
      />

      {/* Post-stream wrap-up pipeline (download → transcribe → outline →
          thumbnail → description → clip scripts); click through to the
          stream. */}
      <PostStreamStatusChip onOpen={onOpenPostStream} />

      {/* AI writing a video plan's script; click through to its Editor tab. */}
      <ScriptStatus
        job={editSession.scriptJob}
        notice={editSession.scriptNotice}
        onOpen={onOpenEditSession}
      />

      {/* Video edit session; click through to the plan's Editor tab. */}
      <EditSessionStatus
        session={editSession.session}
        notice={editSession.notice}
        onOpen={onOpenEditSession}
      />

      {/* A filed bug report was resolved; click through to its page (the
          notice is read-once and clears on click). */}
      <FixNoticeChip onOpen={onOpenFixNotice} />

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
 * Clip-script chip: while the AI pitches scripts for a stream — reading the
 * whole broadcast, which takes a couple of minutes — it is a button that jumps
 * to that stream's Clips tab. The run is owned by ClipIdeasProvider, so it
 * keeps going when the producer navigates away; when it finishes the chip
 * turns green and lingers, still clickable, so the fresh pitches are one
 * click away from anywhere in the app.
 */
function ClipIdeasStatus({
  jobs,
  notice,
  onOpen,
  onDismiss,
}: {
  jobs: ClipIdeasJob[]
  notice: ClipIdeasNotice | null
  onOpen: (startedAt: string) => void
  /** Clear the lingering notice — following it counts as read. */
  onDismiss: () => void
}) {
  if (jobs.length > 0) {
    const label =
      jobs.length === 1
        ? `Pitching clip scripts — ${jobs[0].title || 'stream'}`
        : `Pitching clip scripts for ${jobs.length} streams`
    return (
      <button
        type="button"
        onClick={() => onOpen(jobs[0].startedAt)}
        title="Open the stream's Clips tab — generation keeps going in the background"
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg transition-colors hover:text-accent"
      >
        <Loader2 size={12} aria-hidden className="animate-spin" />
        <span className="max-w-[22rem] truncate">{label}</span>
      </button>
    )
  }

  if (!notice) return null
  return (
    <button
      type="button"
      onClick={() => {
        // Following the notice is reading it — clear it rather than letting
        // it linger for the full timeout.
        onDismiss()
        onOpen(notice.startedAt)
      }}
      title={
        notice.state === 'done'
          ? 'Open the Clips tab to read the three pitched scripts'
          : notice.detail
      }
      className={
        notice.state === 'error'
          ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 transition-colors hover:text-accent dark:text-red-400'
          : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 transition-colors hover:text-accent dark:text-green-400'
      }
    >
      <Scissors size={12} aria-hidden />
      <span className="max-w-[22rem] truncate">
        {notice.state === 'done' ? '✓ ' : ''}
        {notice.detail}
      </span>
    </button>
  )
}

/**
 * Plan-AI chip: while the AI produces a video plan's thumbnail or listing
 * (title/description/tags) it is a button that jumps to that plan's Publish
 * tab. The run is owned by PlanAiProvider and persists its own result, so
 * navigating away costs nothing; the done notice turns green and lingers,
 * still clickable, so the result is one click away from anywhere.
 */
function PlanAiStatus({
  jobs,
  notice,
  onOpen,
}: {
  jobs: PlanAiJob[]
  notice: PlanAiNotice | null
  onOpen: (planId: string) => void
}) {
  if (jobs.length > 0) {
    const label =
      jobs.length === 1
        ? `${jobs[0].kind === 'thumbnail' ? 'Generating thumbnail' : 'Drafting listing'} — ${
            jobs[0].title || 'video plan'
          }`
        : `Running ${jobs.length} AI drafts`
    return (
      <button
        type="button"
        onClick={() => onOpen(jobs[0].planId)}
        title="Open the plan's Publish tab — generation keeps going in the background"
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg transition-colors hover:text-accent"
      >
        <Loader2 size={12} aria-hidden className="animate-spin" />
        <span className="max-w-[22rem] truncate">{label}</span>
      </button>
    )
  }

  if (!notice) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(notice.planId)}
      title={
        notice.state === 'done'
          ? 'Open the Publish tab to review the result'
          : notice.detail
      }
      className={
        notice.state === 'error'
          ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 transition-colors hover:text-accent dark:text-red-400'
          : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 transition-colors hover:text-accent dark:text-green-400'
      }
    >
      <WandSparkles size={12} aria-hidden />
      <span className="max-w-[22rem] truncate">
        {notice.state === 'done' ? '✓ ' : ''}
        {notice.detail}
      </span>
    </button>
  )
}

/**
 * Script-generation chip: while the AI writes a video plan's script — reading
 * every source stream's transcript and outline, which takes a while — it is a
 * button that jumps to that plan's Editor tab. The script saves itself on the
 * way out, so navigating away costs nothing; the done notice lingers briefly,
 * still clickable, so the finished script is one click away.
 */
function ScriptStatus({
  job,
  notice,
  onOpen,
}: {
  job: ScriptJobState | null
  notice: ScriptNotice | null
  onOpen: (planId: string) => void
}) {
  if (job?.running) {
    const plan = job.title || 'video plan'
    return (
      <button
        type="button"
        onClick={() => onOpen(job.planId)}
        title={`Writing the script for “${plan}” — reading the source streams’ transcripts and outlines. It saves itself when it's done; click to open the Editor tab.`}
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg transition-colors hover:text-accent"
      >
        <Loader2 size={12} aria-hidden className="animate-spin" />
        <span className="max-w-[22rem] truncate">
          Writing script — {plan}
        </span>
      </button>
    )
  }

  if (!notice) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(notice.planId)}
      title={
        notice.state === 'done'
          ? 'Open the Editor tab — the script is saved and ready to process'
          : notice.detail
      }
      className={
        notice.state === 'error'
          ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 transition-colors hover:text-accent dark:text-red-400'
          : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 transition-colors hover:text-accent dark:text-green-400'
      }
    >
      <ScrollText size={12} aria-hidden />
      <span className="max-w-[22rem] truncate">
        {notice.state === 'done' ? '✓ ' : ''}
        {notice.detail}
      </span>
    </button>
  )
}

/**
 * Video-edit-session chip: while the video processes in the background it is a
 * button that jumps to that plan's Editor tab, showing the step the session is
 * on right now (renders are long, and "Editing…" for twenty minutes tells the
 * producer nothing). Afterwards the end-of-run notice lingers briefly, still
 * clickable so the finished video — or the failure log — is one click away.
 */
function EditSessionStatus({
  session,
  notice,
  onOpen,
}: {
  session: EditSessionState | null
  notice: EditSessionNotice | null
  onOpen: (planId: string) => void
}) {
  if (session?.running) {
    const plan = session.title || 'video plan'
    // The session's newest progress line is the step it is on. It leads with
    // what is happening ("Generating video") so the chip is unambiguous even
    // before the first step arrives, or when a long render goes quiet.
    const step = session.lastLine.trim()
    return (
      <button
        type="button"
        onClick={() => onOpen(session.planId)}
        title={`Generating the video for “${plan}” in the background — click to open its Editor tab and follow the session${
          step ? `\n\n${step}` : ''
        }`}
        className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg transition-colors hover:text-accent"
      >
        <Loader2 size={12} aria-hidden className="animate-spin" />
        <span className="shrink-0">Generating video —</span>
        {/* The title is the whole video idea now, so it gets an ellipsis
            rather than the run of the bar; the full text sits in the hover
            title. */}
        <span className="max-w-[14rem] truncate">{plan}</span>
        {step && (
          <span className="max-w-[20rem] truncate text-fg-muted">· {step}</span>
        )}
      </button>
    )
  }

  if (!notice) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(notice.planId)}
      title={
        notice.state === 'done'
          ? 'Open the rendered video on the Editor tab'
          : "Open the Editor tab to see the session's log"
      }
      className={
        notice.state === 'error'
          ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 transition-colors hover:text-accent dark:text-red-400'
          : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 transition-colors hover:text-accent dark:text-green-400'
      }
    >
      <Clapperboard size={12} aria-hidden />
      <span className="max-w-[22rem] truncate">
        {notice.state === 'done' ? '✓ ' : ''}
        {notice.detail}
      </span>
    </button>
  )
}

/**
 * Bug-fixed chip: the read-once notices a resolved debug report leaves behind
 * (see ai_debug.go). One at a time, oldest first — clicking opens the page the
 * report was filed on so the fix is easy to review, and dismisses the notice
 * for good; any further notices take its place.
 */
function FixNoticeChip({onOpen}: {onOpen: (notice: main.FixNotice) => void}) {
  const [notices, setNotices] = useState<main.FixNotice[]>([])

  useEffect(() => {
    ListFixNotices()
      .then((n) => setNotices(n ?? []))
      .catch(() => {})
    return EventsOn('debugfix:new', (n: main.FixNotice) => {
      setNotices((prev) =>
        prev.some((x) => x.id === n.id) ? prev : [...prev, n],
      )
    })
  }, [])

  if (notices.length === 0) return null
  const first = notices[0]
  const read = () => {
    setNotices((prev) => prev.filter((n) => n.id !== first.id))
    DismissFixNotice(first.id).catch(() => {})
    onOpen(first)
  }
  return (
    <button
      type="button"
      onClick={read}
      title={`“${first.title || 'Your bug report'}” was resolved — click to open the page it was filed on and clear this notice`}
      className="inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 transition-colors hover:text-accent dark:text-green-400"
    >
      <BugOff size={12} aria-hidden />
      <span className="max-w-[22rem] truncate">
        ✓ Bug fixed — {first.title || 'your report'}
      </span>
      {notices.length > 1 && (
        <span className="rounded-full bg-green-600/15 px-1.5 text-[11px] font-semibold">
          +{notices.length - 1}
        </span>
      )}
    </button>
  )
}

/** How long a finished pipeline's notice lingers in the status bar. */
const POST_STREAM_CLEAR_MS = 600_000

/**
 * Post-stream wrap-up chip: while the pipeline runs (see poststream.go) it
 * shows the current stage and jumps to the stream being processed; the final
 * done/error notice lingers, still clickable, so the result is one click away
 * even when the wrap-up finished while the user was elsewhere.
 */
function PostStreamStatusChip({
  onOpen,
}: {
  onOpen: (startedAt: string, tab: StreamTab | null) => void
}) {
  const [status, setStatus] = useState<main.PostStreamStatus | null>(null)
  const clearTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    // Only an in-flight pipeline is picked up on mount; a long-finished one
    // shouldn't resurrect its notice.
    GetPostStreamStatus()
      .then((s) => {
        if (s?.active) setStatus(s)
      })
      .catch(() => {})
    const off = EventsOn('poststream:update', (s: main.PostStreamStatus) => {
      setStatus(s)
      window.clearTimeout(clearTimer.current)
      if (!s.active) {
        clearTimer.current = window.setTimeout(
          () => setStatus(null),
          POST_STREAM_CLEAR_MS,
        )
      }
    })
    return () => {
      off()
      window.clearTimeout(clearTimer.current)
    }
  }, [])

  if (!status || !status.stage) return null

  const warningCount = status.warnings?.length ?? 0
  const cls = status.active
    ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-fg'
    : status.stage === 'done'
      ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-green-600 dark:text-green-400'
      : status.stage === 'cancelled'
        ? 'inline-flex min-w-0 items-center gap-1.5 font-medium text-fg-muted'
        : 'inline-flex min-w-0 items-center gap-1.5 font-medium text-red-500 dark:text-red-400'
  const body = (
    <>
      {status.active ? (
        <Loader2 size={12} aria-hidden className="animate-spin" />
      ) : (
        <Sparkles size={12} aria-hidden />
      )}
      <span className="max-w-[22rem] truncate">
        {status.stage === 'done' && warningCount === 0 ? '✓ ' : ''}
        {status.detail}
      </span>
    </>
  )
  const title = [
    status.title ? `Wrapping up “${status.title}”` : 'Post-stream wrap-up',
    ...(status.warnings ?? []),
  ].join('\n')

  // Land on the tab matching the pipeline's stage, so the click shows the
  // work in question — a finished wrap-up ends on the clip scripts it just
  // pitched, not the overview.
  const stageTab: StreamTab | null =
    status.stage === 'transcribe'
      ? 'transcript'
      : status.stage === 'outline'
        ? 'outline'
        : status.stage === 'clips' || status.stage === 'done'
          ? 'clips'
          : null

  return status.startedAt ? (
    <button
      type="button"
      onClick={() => onOpen(status.startedAt, stageTab)}
      title={title}
      className={`${cls} transition-colors hover:text-accent`}
    >
      {body}
    </button>
  ) : (
    <span title={title} className={cls}>
      {body}
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

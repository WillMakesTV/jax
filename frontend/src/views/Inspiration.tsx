import {Clapperboard, Lightbulb, Loader2, Plus, Trash2} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  AddInspirationChannel,
  AddInspirationVideo,
  DeleteInspirationChannel,
  GetInspirationChannels,
  GetInspirationVideos,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Modal} from '../components/Modal'
import {PageHeader} from '../components/PageHeader'
import {useDataChanged} from '../lib/dataChanged'
import {formatDate} from '../lib/format'

/** Message text from a rejected binding call. */
export function inspirationError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * The Inspiration section: reference videos worth studying, grouped by the
 * channel they came from. Adding a single video indexes its channel too, so
 * the library is always browsable the same way — channel, then videos, then
 * one video's full manifest (see InspirationChannelDetails / VideoDetails).
 */
export function Inspiration({
  onOpenChannel,
}: {
  /** Open a channel's page. */
  onOpenChannel: (channel: main.InspirationChannel) => void
}) {
  const [channels, setChannels] = useState<main.InspirationChannel[]>([])
  const [videos, setVideos] = useState<main.InspirationVideo[]>([])

  const load = useCallback(() => {
    GetInspirationChannels()
      .then((c) => setChannels(c ?? []))
      .catch(() => {})
    GetInspirationVideos('')
      .then((v) => setVideos(v ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  // The pipeline writes as it goes (download → transcript → manifest), and an
  // MCP client may index in the background; both land through the store.
  useDataChanged(['inspiration'], load)

  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        description="Reference videos worth studying — downloaded, transcribed, and broken down, grouped by the channel they came from."
        actions={
          channels.length > 0 && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={14} aria-hidden />
              Add inspiration
            </button>
          )
        }
      />

      {channels.length === 0 ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover sm:w-2/3"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            <Lightbulb size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              Add your first inspiration
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              Paste a YouTube video and Jax downloads it, transcribes it, and
              builds a timestamped outline with the links and products it names
              — or index a whole channel to browse later.
            </p>
          </div>
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {channels.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              videos={videos.filter((v) => v.channelId === c.id)}
              onOpen={() => onOpenChannel(c)}
            />
          ))}
        </ul>
      )}

      <AddInspirationModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function ChannelCard({
  channel,
  videos,
  onOpen,
}: {
  channel: main.InspirationChannel
  videos: main.InspirationVideo[]
  onOpen: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const ready = videos.filter((v) => v.status === 'ready').length
  const cover = videos.find((v) => v.thumbUrl || v.thumbnailUrl)

  const remove = async () => {
    setBusy(true)
    try {
      await DeleteInspirationChannel(channel.id)
    } catch {
      // Non-fatal; the list reconciles on the next load.
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-edge bg-surface text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
      >
        {cover ? (
          <img
            src={cover.thumbUrl || cover.thumbnailUrl}
            alt=""
            aria-hidden
            className="aspect-video w-full border-b border-edge object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center border-b border-edge bg-surface-hover text-fg-muted">
            <Clapperboard size={28} aria-hidden />
          </div>
        )}

        <div className="flex flex-1 flex-col p-4">
          <div className="flex min-w-0 items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
              {channel.name || 'Unknown channel'}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirm(true)
              }}
              title="Remove this channel…"
              aria-label="Remove this channel"
              className="shrink-0 text-fg-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
          {channel.handle && (
            <p className="mt-0.5 truncate text-xs text-fg-muted">
              {channel.handle}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
            <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
              {videos.length} {videos.length === 1 ? 'video' : 'videos'}
            </span>
            {ready > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                {ready} studied
              </span>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Are you sure?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            <span className="font-semibold text-fg">
              {channel.name || 'This channel'}
            </span>{' '}
            and the {videos.length} video
            {videos.length === 1 ? '' : 's'} indexed from it — including any
            downloaded copies — are removed. This cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(false)}
              disabled={busy}
              className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={14} aria-hidden className="animate-spin" />
              ) : (
                <Trash2 size={14} aria-hidden />
              )}
              Remove
            </button>
          </div>
        </div>
      </Modal>
    </li>
  )
}

/** Paste a video (downloaded and studied) or a channel (indexed for later). */
export function AddInspirationModal({
  open,
  onClose,
  channelURL,
}: {
  open: boolean
  onClose: () => void
  /** Prefills the channel field — used from a channel's own page. */
  channelURL?: string
}) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'video' | 'channel'>('video')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setUrl(channelURL ?? '')
    setMode(channelURL ? 'channel' : 'video')
    setError('')
    setNote('')
  }, [open, channelURL])

  const submit = async () => {
    const value = url.trim()
    if (!value) {
      setError('Paste a YouTube URL first.')
      return
    }
    setBusy(true)
    setError('')
    setNote('')
    try {
      if (mode === 'video') {
        await AddInspirationVideo(value)
        setNote('Downloading — the video appears in its channel as it lands.')
      } else {
        const channel = await AddInspirationChannel(value)
        setNote(
          `Indexed ${channel.name || 'the channel'} — open it to download a video.`,
        )
      }
      setUrl('')
    } catch (err) {
      setError(
        inspirationError(
          err,
          mode === 'video'
            ? 'That video could not be indexed.'
            : 'That channel could not be indexed.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add inspiration"
      icon={<Lightbulb size={18} aria-hidden className="text-accent" />}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-4"
      >
        <div
          role="tablist"
          aria-label="What to add"
          className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
        >
          {(
            [
              {id: 'video', label: 'One video'},
              {id: 'channel', label: 'Whole channel'},
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => setMode(t.id)}
              className={
                mode === t.id
                  ? 'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg'
                  : 'rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg'
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div>
          <label
            htmlFor="inspiration-url"
            className="mb-1.5 block text-sm font-medium text-fg"
          >
            {mode === 'video' ? 'Video URL' : 'Channel URL'}
          </label>
          <input
            id="inspiration-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              mode === 'video'
                ? 'https://www.youtube.com/watch?v=…'
                : 'https://www.youtube.com/@channel'
            }
            autoFocus
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <p className="mt-1.5 text-xs text-fg-muted">
            {mode === 'video'
              ? 'The video downloads into the Videos workspace under inspiration/<channel>, then is transcribed and broken down. Its channel is indexed alongside it.'
              : "The channel's recent videos are tracked without downloading; open one from the channel's page to study it."}
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {note && <p className="text-sm text-fg-muted">{note}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} aria-hidden className="animate-spin" />}
            {busy
              ? 'Indexing…'
              : mode === 'video'
                ? 'Add video'
                : 'Index channel'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Close
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Shared meta line for a video card: date · duration. */
export function videoMeta(video: main.InspirationVideo): string {
  return [
    video.publishedAt ? formatDate(video.publishedAt) : '',
    video.durationSecs > 0 ? clock(video.durationSecs) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Seconds as h:mm:ss (or m:ss under an hour) — mirrors the backend's clock. */
export function clock(secs: number): string {
  const total = Math.max(0, Math.floor(secs))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

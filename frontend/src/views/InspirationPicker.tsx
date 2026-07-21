import {Clapperboard, Loader2, Radio, Scissors, Video} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  AddInspirationChannelVideos,
  BrowseInspirationChannel,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Modal} from '../components/Modal'
import {formatCompact, formatDate} from '../lib/format'
import {clock, inspirationError} from './Inspiration'

/** How each kind of upload reads, and the icon it carries. */
const KINDS: {id: string; label: string; icon: typeof Video}[] = [
  {id: 'video', label: 'Videos', icon: Video},
  {id: 'short', label: 'Shorts', icon: Scissors},
  {id: 'live', label: 'Live', icon: Radio},
]

/**
 * Pick what to study from a channel already in the library — no URLs, since
 * the channel is known. Its uploads are listed newest first, grouped as
 * videos, shorts and past live streams; picking any queues them in that same
 * order, one at a time.
 */
export function InspirationPicker({
  open,
  channel,
  onClose,
}: {
  open: boolean
  channel: main.InspirationChannel
  onClose: () => void
}) {
  const [candidates, setCandidates] = useState<main.InspirationCandidate[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [kinds, setKinds] = useState<Record<string, boolean>>({
    video: true,
    short: true,
    live: true,
  })
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(30)
  const [since, setSince] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const browse = useCallback(
    async (howMany: number) => {
      setLoading(true)
      setError('')
      try {
        const found = await BrowseInspirationChannel(channel.id, howMany)
        setCandidates(found ?? [])
      } catch (err) {
        setError(inspirationError(err, 'That channel could not be read.'))
      } finally {
        setLoading(false)
      }
    },
    [channel.id],
  )

  // Read the channel each time the dialog opens, so newly published uploads
  // are offered without a restart.
  useEffect(() => {
    if (!open) return
    setPicked({})
    setQuery('')
    void browse(limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, browse])

  const matches = candidates.filter((c) => {
    if (!kinds[c.kind]) return false
    if (since && c.publishedAt && c.publishedAt.slice(0, 10) < since)
      return false
    const q = query.trim().toLowerCase()
    return !q || c.title.toLowerCase().includes(q)
  })
  const selected = matches.filter((c) => picked[c.id])
  const fresh = matches.filter((c) => !c.indexed)

  const add = async (list: main.InspirationCandidate[]) => {
    if (list.length === 0) return
    setBusy(true)
    setError('')
    try {
      await AddInspirationChannelVideos(channel.id, list)
      onClose()
    } catch (err) {
      setError(inspirationError(err, 'Those videos could not be queued.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add from ${channel.name || 'this channel'}`}
      icon={<Clapperboard size={18} aria-hidden className="text-fg-muted" />}
      maxWidthClass="max-w-3xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Search</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter this channel's uploads by title"
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Published since</span>
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="flex w-28 flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Read</span>
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 30)}
              onBlur={() => void browse(limit)}
              title="How many uploads to read per kind"
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((k) => {
            const Icon = k.icon
            const count = candidates.filter((c) => c.kind === k.id).length
            return (
              <button
                key={k.id}
                type="button"
                onClick={() =>
                  setKinds((prev) => ({...prev, [k.id]: !prev[k.id]}))
                }
                disabled={count === 0}
                className={
                  kinds[k.id] && count > 0
                    ? 'inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent px-3 py-1 text-sm font-medium text-accent-fg disabled:opacity-50'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-3 py-1 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover disabled:opacity-50'
                }
              >
                <Icon size={12} aria-hidden />
                {k.label}
                <span className="text-xs opacity-80">{count}</span>
              </button>
            )
          })}
          <span className="ml-auto text-xs text-fg-muted">
            {loading
              ? 'Reading the channel…'
              : `${fresh.length} new · ${matches.length} shown`}
          </span>
        </div>

        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto rounded-lg border border-edge bg-bg p-2">
          {loading && candidates.length === 0 ? (
            <li className="flex items-center gap-2 p-3 text-sm text-fg-muted">
              <Loader2 size={14} aria-hidden className="animate-spin" />
              Reading this channel's uploads…
            </li>
          ) : matches.length === 0 ? (
            <li className="p-3 text-sm text-fg-muted">
              Nothing matches those filters.
            </li>
          ) : (
            matches.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={Boolean(picked[c.id])}
                    onChange={(e) =>
                      setPicked((prev) => ({...prev, [c.id]: e.target.checked}))
                    }
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                  {c.thumbnailUrl && (
                    <img
                      src={c.thumbnailUrl}
                      alt=""
                      aria-hidden
                      className="h-9 w-16 shrink-0 rounded object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {c.title}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      {[
                        KINDS.find((k) => k.id === c.kind)?.label.replace(
                          /s$/,
                          '',
                        ),
                        c.publishedAt ? formatDate(c.publishedAt) : '',
                        c.durationSecs > 0 ? clock(c.durationSecs) : '',
                        c.views > 0 ? `${formatCompact(c.views)} views` : '',
                        c.indexed ? 'already indexed' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add(fresh)}
            disabled={busy || loading || fresh.length === 0}
            title="Queue everything shown that is not already indexed"
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {busy && <Loader2 size={14} aria-hidden className="animate-spin" />}
            Add all {fresh.length}
          </button>
          <button
            type="button"
            onClick={() => void add(selected)}
            disabled={busy || selected.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} aria-hidden className="animate-spin" />}
            Add {selected.length || ''} selected
          </button>
        </div>
      </div>
    </Modal>
  )
}

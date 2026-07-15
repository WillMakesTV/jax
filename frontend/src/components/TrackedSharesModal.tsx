import clsx from 'clsx'
import {ExternalLink, Link2, Plus, Trash2, UploadCloud} from 'lucide-react'
import {useEffect, useState} from 'react'
import {SetVideoPlanShares} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {openExternal} from '../lib/browser'
import {formatCompact} from '../lib/format'
import {Modal} from './Modal'
import {PlatformPill} from './PlatformPill'

interface TrackedSharesModalProps {
  tracked: main.TrackedVideo | null
  onClose: () => void
  /** Receives the re-joined tracked video after every successful change. */
  onSaved: (t: main.TrackedVideo) => void
}

/** A share's matched view count, or an honest "unknown". */
const viewsLabel = (share: main.TrackedShare) =>
  share.video ? `${formatCompact(share.video.viewCount)} views` : 'views unknown'

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Edit where a tracked video lives: the publish records are shown read-only,
 * and the hand-posted share links (TikTok, Instagram, anywhere) are added and
 * removed here. Every change saves immediately and returns the re-aggregated
 * view counts.
 */
export function TrackedSharesModal({
  tracked,
  onClose,
  onSaved,
}: TrackedSharesModalProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Delete asks for a second click; holds the armed URL.
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)

  useEffect(() => {
    setDraft('')
    setError('')
    setDeleteArmed(null)
  }, [tracked?.plan.id])

  if (!tracked) return null

  const manualURLs = tracked.plan.shareUrls ?? []
  const publishShares = tracked.shares.filter((s) => s.source === 'publish')
  const manualShares = tracked.shares.filter((s) => s.source === 'manual')

  const save = async (urls: string[]) => {
    setBusy(true)
    setError('')
    try {
      onSaved(await SetVideoPlanShares(tracked.plan.id, urls))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!draft.trim()) return
    await save([...manualURLs, draft.trim()])
    setDraft('')
  }

  const remove = (url: string) => {
    setDeleteArmed(null)
    void save(manualURLs.filter((u) => u !== url))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Video shares"
      icon={<Link2 size={18} aria-hidden className="text-fg-muted" />}
      maxWidthClass="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          Every place “{tracked.plan.title}” was posted. Views from all of them
          add up to the video's total
          {tracked.totalViews > 0 && (
            <>
              {' — currently '}
              <span className="font-semibold text-fg">
                {formatCompact(tracked.totalViews)}
              </span>
            </>
          )}
          .
        </p>

        {publishShares.length > 0 && (
          <ul className="flex flex-col gap-2">
            {publishShares.map((s) => (
              <li
                key={s.url}
                className="flex items-center gap-3 rounded-lg border border-edge bg-bg px-3 py-2"
              >
                <PlatformPill platform={s.platform} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">
                    {hostOf(s.url)}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {viewsLabel(s)} · published from Jax
                  </span>
                </span>
                <UploadCloud
                  size={14}
                  aria-hidden
                  className="shrink-0 text-fg-muted"
                />
                <button
                  type="button"
                  onClick={() => openExternal(s.url)}
                  aria-label={`Open ${hostOf(s.url)}`}
                  title="Open"
                  className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <ExternalLink size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {manualShares.length > 0 && (
          <ul className="flex flex-col gap-2">
            {manualShares.map((s) => (
              <li
                key={s.url}
                className="flex items-center gap-3 rounded-lg border border-edge bg-bg px-3 py-2"
              >
                {s.platform ? (
                  <PlatformPill platform={s.platform} />
                ) : (
                  <span className="rounded-full border border-edge px-2.5 py-1 text-xs text-fg-muted">
                    Other
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">
                    {hostOf(s.url)}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {s.video
                      ? viewsLabel(s)
                      : 'not found on your connected channels — views unknown'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => openExternal(s.url)}
                  aria-label={`Open ${hostOf(s.url)}`}
                  title="Open"
                  className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <ExternalLink size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    deleteArmed === s.url ? remove(s.url) : setDeleteArmed(s.url)
                  }
                  onBlur={() => setDeleteArmed(null)}
                  disabled={busy}
                  aria-label={`Remove ${hostOf(s.url)}`}
                  title={
                    deleteArmed === s.url ? 'Click again to remove' : 'Remove'
                  }
                  className={clsx(
                    'rounded-lg p-1.5 transition-colors disabled:opacity-50',
                    deleteArmed === s.url
                      ? 'bg-red-600 text-white hover:bg-red-500'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-red-600 dark:hover:text-red-400',
                  )}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
          className="flex items-center gap-2"
        >
          <input
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://www.tiktok.com/@you/video/…"
            aria-label="Share link to add"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} aria-hidden />
            Add link
          </button>
        </form>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </Modal>
  )
}

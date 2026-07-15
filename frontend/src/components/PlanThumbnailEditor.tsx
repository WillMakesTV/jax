import clsx from 'clsx'
import {
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react'
import {useState} from 'react'
import {
  GeneratePlanThumbnail,
  UploadPlanThumbnail,
} from '../../wailsjs/go/main/App'
import {useServices} from '../services/ServicesProvider'

/** Wails rejects bound-method promises with the Go error string. */
const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

export interface PlanThumb {
  file: string
  url: string
}

/** Pair a plan's thumbnailHistory files with their served URLs. */
export const zipThumbHistory = (
  files?: string[],
  urls?: string[],
): PlanThumb[] =>
  (files ?? [])
    .map((file, i) => ({file, url: urls?.[i] ?? ''}))
    .filter((t) => t.file && t.url)

/**
 * The thumbnail workbench shared by the plan form and the broadcast page:
 * preview, AI generation (fresh, or revised via the feedback box), uploading
 * a hand-made image, and removal. Generation follows the "Stream thumbnails"
 * skill and the brand's assets. The parent persists each change in onApply
 * (throw to surface the failure here).
 */
export function PlanThumbnailEditor({
  planTitle,
  planDescription,
  file,
  url,
  history = [],
  onApply,
  onOpenFull,
  onGenerate,
  generateTip,
  removeLabel,
  vertical = false,
}: {
  planTitle: string
  planDescription: string
  file: string
  url: string
  /**
   * Compose (and preview) the thumbnail 9:16 rather than 16:9 — a short-form
   * video's cover, seen full-screen on a phone. The generator is told the same
   * thing; this keeps the preview honest about what came back.
   */
  vertical?: boolean
  /** Previous versions (newest first) offered for one-click restore. */
  history?: PlanThumb[]
  /** Persist and reflect the new thumbnail ({'', ''} on removal). */
  onApply: (t: PlanThumb) => Promise<void>
  /** Open the full-size view; omit to make the preview non-clickable. */
  onOpenFull?: () => void
  /**
   * Produce the image (fresh when feedback/currentFile are empty, a revision
   * otherwise). Defaults to plan generation from the title + description;
   * past streams override this to generate from their outline.
   */
  onGenerate?: (feedback: string, currentFile: string) => Promise<PlanThumb>
  /** Tooltip for the generate button; defaults to the plan wording. */
  generateTip?: string
  /**
   * Label for the clear action; past streams with a platform image pass
   * "Use platform thumbnail" since clearing falls back to it.
   */
  removeLabel?: string
}) {
  const {statuses} = useServices()
  const openaiConnected = Boolean(statuses.openai?.connected)

  const [busy, setBusy] = useState<'' | 'generate' | 'upload'>('')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const generate = async (revise: boolean) => {
    setBusy('generate')
    setError('')
    try {
      const t = onGenerate
        ? await onGenerate(revise ? feedback.trim() : '', revise ? file : '')
        : await GeneratePlanThumbnail(
            planTitle.trim(),
            planDescription.trim(),
            revise ? feedback.trim() : '',
            revise ? file : '',
          )
      await onApply({file: t.file, url: t.url})
      if (revise) setFeedback('')
    } catch (err) {
      setError(messageOf(err, 'The thumbnail could not be generated.'))
    } finally {
      setBusy('')
    }
  }

  const upload = async () => {
    setBusy('upload')
    setError('')
    try {
      const t = await UploadPlanThumbnail()
      if (t.file) {
        await onApply({file: t.file, url: t.url})
        setFeedback('')
      }
    } catch (err) {
      setError(messageOf(err, 'Could not add the image.'))
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    setError('')
    try {
      await onApply({file: '', url: ''})
      setFeedback('')
    } catch (err) {
      setError(messageOf(err, 'Could not remove the thumbnail.'))
    }
  }

  const restore = async (t: PlanThumb) => {
    setError('')
    try {
      await onApply(t)
    } catch (err) {
      setError(messageOf(err, 'Could not restore that thumbnail.'))
    }
  }

  const generating = busy === 'generate'
  // A vertical cover is tall; showing it in a 16:9 box would crop away the
  // composition and lie about what will be published.
  const frame = vertical ? 'aspect-[9/16]' : 'aspect-video'

  return (
    <div className="flex flex-col gap-2.5">
      {url && (
        <button
          type="button"
          onClick={onOpenFull}
          disabled={!onOpenFull}
          title={onOpenFull ? 'View full size' : undefined}
          className={clsx(
            'group/img relative block overflow-hidden rounded-md border border-edge focus-visible:border-accent',
            vertical ? 'w-48 self-start' : 'w-full',
          )}
        >
          <img
            src={url}
            alt="Stream thumbnail"
            className={clsx(frame, 'w-full object-cover')}
          />
          {onOpenFull && (
            <span className="absolute inset-0 hidden items-center justify-center bg-black/40 text-[10px] font-semibold text-white group-hover/img:flex">
              View full size
            </span>
          )}
        </button>
      )}

      {openaiConnected && url && (
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder="What should change? e.g. less text, warmer colors, focus on the robot"
          className="w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {openaiConnected && url && (
          <button
            type="button"
            onClick={() => void generate(true)}
            disabled={busy !== '' || !feedback.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={14} aria-hidden className="animate-spin" />
            ) : (
              <WandSparkles size={14} aria-hidden />
            )}
            Request changes
          </button>
        )}
        {openaiConnected && (
          <button
            type="button"
            onClick={() => void generate(false)}
            disabled={
              busy !== '' || (!planTitle.trim() && !planDescription.trim())
            }
            title={
              generateTip ??
              'Generated from the title, description, and your brand assets (Profile → Brand Assets). The style guide lives in Settings → Skills → Stream thumbnails.'
            }
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50',
              url
                ? 'border border-edge text-fg hover:bg-surface-hover'
                : 'bg-accent text-accent-fg hover:opacity-90',
            )}
          >
            {generating && !url ? (
              <Loader2 size={14} aria-hidden className="animate-spin" />
            ) : (
              <ImageIcon size={14} aria-hidden />
            )}
            {url ? 'Generate new' : 'Generate thumbnail'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void upload()}
          disabled={busy !== ''}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          {busy === 'upload' ? (
            <Loader2 size={14} aria-hidden className="animate-spin" />
          ) : (
            <Upload size={14} aria-hidden />
          )}
          Upload image
        </button>
        {url && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy !== ''}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <Trash2 size={14} aria-hidden />
            {removeLabel ?? 'Remove'}
          </button>
        )}
      </div>

      {generating && (
        <p className="text-xs text-fg-muted">
          Generating — this can take up to a minute…
        </p>
      )}
      {history.length > 0 && (
        <div>
          <p className="text-xs font-medium text-fg-muted">
            Previous versions — click to restore
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {history.map((h) => (
              <li key={h.file}>
                <button
                  type="button"
                  onClick={() => void restore(h)}
                  disabled={busy !== ''}
                  title="Restore this thumbnail (the current one moves into the history)"
                  className={clsx(
                    'group/hist relative block overflow-hidden rounded-md border border-edge disabled:opacity-50',
                    vertical ? 'w-16' : 'w-24',
                  )}
                >
                  <img
                    src={h.url}
                    alt="Previous thumbnail"
                    className={clsx(frame, 'w-full object-cover')}
                  />
                  <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[10px] font-semibold text-white group-hover/hist:flex">
                    Restore
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!openaiConnected && (
        <p className="text-xs text-fg-muted">
          Connect OpenAI in Settings → AI to generate thumbnails — or upload
          your own image.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

import {ArrowLeft, Loader2, Sparkles, Wand2} from 'lucide-react'
import clsx from 'clsx'
import {useState} from 'react'
import {GenerateEditDirections, StartEditRun} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {MarkdownField} from '../components/markdown/MarkdownField'

/**
 * The edit-session directions page, opened from the Video Plan Editor's
 * "Start edit session" CTA. Notes-first flow: describe what the video should
 * be, let the AI note builder draft the directions — it reads the plan and
 * each source stream's overview/outline, and (in account mode) digs into the
 * stored transcripts and outlines through the app's own tools — then iterate
 * with further notes or hand edits until satisfied. The final text is handed
 * to StartEditRun as the session directions.
 */
export function EditDirections({
  plan,
  onBack,
  onStarted,
}: {
  plan: main.VideoPlan
  onBack: () => void
  /** Navigate to the plan's Editor tab once the session is running. */
  onStarted: () => void
}) {
  const [notes, setNotes] = useState('')
  const [directions, setDirections] = useState('')
  // Bumped per AI draft: remounts the markdown field so a fresh draft opens
  // in rendered view (its edit/view mode is internal, set at mount).
  const [draftRound, setDraftRound] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const busy = generating || starting

  // Draft (or revise) the directions: the current draft and the notes go in,
  // the new draft comes back, and the notes clear for the next iteration.
  const generate = () => {
    setGenerating(true)
    setError('')
    GenerateEditDirections(plan.id, notes, directions)
      .then((text) => {
        setDirections(text)
        setNotes('')
        setDraftRound((n) => n + 1)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setGenerating(false))
  }

  const start = () => {
    setStarting(true)
    setError('')
    StartEditRun(plan.id, directions)
      .then(onStarted)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setStarting(false)
      })
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to the plan
      </button>

      <div className="flex max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Edit session directions
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            The brief the editing session executes for{' '}
            <span className="font-semibold text-fg">
              {plan.title || 'this plan'}
            </span>
            . Build it with the AI note builder below, refine until it reads
            right, then start the session.
          </p>
        </header>

        {/* Step 1 — the AI note builder. */}
        <section
          aria-labelledby="notes-builder-heading"
          className="rounded-xl border border-edge bg-surface p-4"
        >
          <h2 id="notes-builder-heading" className="text-sm font-semibold text-fg">
            AI note builder
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Describe what matters — tone, moments to include, target length —
            and the builder drafts the directions. It reads the plan and every
            source stream&apos;s overview and outline, and reviews the stored
            transcripts and outlines through the app&apos;s tools, so the
            beats it writes point at real moments. The drafting style is the
            &ldquo;Video edit session directions&rdquo; skill (Settings →
            Skills).
          </p>
          <div className="mt-3 flex items-start gap-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              disabled={busy}
              placeholder={
                directions.trim()
                  ? 'What should change in the directions below?'
                  : 'e.g. A tight 8-minute highlight of the boss fight; keep the chat blowup; end on the victory scream…'
              }
              className="w-full flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-60"
            />
            <button
              type="button"
              onClick={generate}
              disabled={busy || (!notes.trim() && !directions.trim())}
              title="Draft (or revise) the directions from the plan, the source context, and your notes"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {generating ? (
                <Loader2 size={14} aria-hidden className="animate-spin" />
              ) : (
                <Sparkles size={14} aria-hidden />
              )}
              {generating
                ? 'Generating…'
                : directions.trim()
                  ? 'Revise directions'
                  : 'Generate directions'}
            </button>
          </div>
          {generating && (
            <p className="mt-2 text-xs text-fg-muted">
              Reviewing the source streams&apos; outlines and transcripts —
              this can take a minute…
            </p>
          )}
        </section>

        {/* Step 2 — the directions themselves, hand-editable. */}
        <section aria-labelledby="directions-heading">
          <h2
            id="directions-heading"
            className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
          >
            Directions
          </h2>
          {/* The generated draft renders as markdown; MarkdownField carries
              no disabled state, so the wrapper freezes it while AI works. */}
          <div
            className={clsx(busy && 'pointer-events-none opacity-60')}
            aria-busy={busy}
          >
            <MarkdownField
              key={draftRound}
              id="edit-directions"
              value={directions}
              onChange={setDirections}
              placeholder="The generated directions land here — or write your own. This exact text is what the edit session executes."
            />
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">
            Edit freely — whatever is in this box is passed verbatim as the
            session directions.
          </p>
        </section>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-edge pt-5">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={start}
            disabled={busy || !directions.trim()}
            title={
              directions.trim()
                ? 'Start the edit session with these directions'
                : 'Build or write the directions first'
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Wand2 size={14} aria-hidden />
            {starting ? 'Starting…' : 'Start edit session'}
          </button>
        </div>
      </div>
    </div>
  )
}

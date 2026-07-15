import {CheckCircle2, RotateCcw} from 'lucide-react'
import {useState} from 'react'
import {
  ConcludePlannedStream,
  ResetPlannedStream,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'

/**
 * A plan card's wrap-up actions, shown once the plan has been broadcast and
 * that broadcast is over: Conclude keeps the plan's details on the past
 * stream and removes the plan (the episode happened); Reset forgets the
 * broadcast — a false start — and keeps the plan for a future stream. The
 * same actions live on the plan's own pages (PlanStream, BroadcastPlan);
 * here they sit on the Planning and Broadcast dashboards' cards so a
 * finished episode can be wrapped up in place.
 */
export function PlanStreamedActions({
  planId,
  session,
  onConcluded,
  onReset,
}: {
  planId: string
  /** The plan's latest broadcast session, when it has gone live. */
  session: main.PlanSessionInfo | null
  /** The plan has been concluded and no longer exists. */
  onConcluded: () => void
  /** The broadcast was forgotten; the plan remains. */
  onReset: () => void
}) {
  const [confirm, setConfirm] = useState<'' | 'conclude' | 'reset'>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Offered from the moment the plan has gone live (it has a stream
  // session) — the same gate as the plan pages' canConclude. Concluding
  // while still on the air closes the session early; the confirm guards it.
  if (!session) return null

  const run = async (action: 'conclude' | 'reset') => {
    setBusy(true)
    setError('')
    try {
      if (action === 'conclude') {
        await ConcludePlannedStream(planId)
        onConcluded()
        return
      }
      await ResetPlannedStream(planId)
      setConfirm('')
      onReset()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : action === 'conclude'
            ? 'The episode could not be concluded.'
            : 'Could not reset the broadcast.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 border-t border-edge pt-2.5">
      {confirm !== '' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">
            {confirm === 'conclude'
              ? 'Keep its details on the past stream and remove the plan?'
              : 'Forget this broadcast and keep the plan for a future stream?'}
          </span>
          <button
            type="button"
            onClick={() => void run(confirm)}
            disabled={busy}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? confirm === 'conclude'
                ? 'Concluding…'
                : 'Resetting…'
              : confirm === 'conclude'
                ? 'Confirm conclude'
                : 'Confirm reset'}
          </button>
          <button
            type="button"
            onClick={() => setConfirm('')}
            disabled={busy}
            className="rounded-lg border border-edge bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
            Streamed
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {/* A matched entry has no go-live session to forget, so only
                Conclude applies. */}
            {!session.matched && (
              <button
                type="button"
                onClick={() => setConfirm('reset')}
                title="False start? Forget this broadcast — the plan stays for a future stream."
                className="inline-flex items-center gap-1 rounded-lg border border-edge bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <RotateCcw size={12} aria-hidden />
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirm('conclude')}
              title="Wrap this episode up: keep its details on the past stream and remove the plan."
              className="inline-flex items-center gap-1 rounded-lg border border-edge bg-bg px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
            >
              <CheckCircle2 size={12} aria-hidden />
              Conclude
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

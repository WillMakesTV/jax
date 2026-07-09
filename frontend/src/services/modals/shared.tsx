import {CheckCircle2, Eye, EyeOff} from 'lucide-react'
import {useState} from 'react'
import type {ComponentProps, ReactNode} from 'react'

export const fieldInputClass =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted'

/**
 * The human-readable message of a rejected call. Wails rejects bound-method
 * failures with a plain STRING (not an Error), so `err.message`-only handling
 * swallows the backend's actual explanation.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  const s = String(err ?? '').trim()
  return s && s !== 'undefined' && s !== 'null' ? s : fallback
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-fg"
      >
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}

export function PrimaryButton({children, ...props}: ComponentProps<'button'>) {
  return (
    <button
      {...props}
      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function ConnectedPanel({
  label,
  account,
  masked,
  onDisconnect,
}: {
  label: string
  account: string
  /** Hide the account behind dots, revealed by an eye toggle (for accounts
   *  identified by private data such as an email address). */
  masked?: boolean
  onDisconnect: () => void | Promise<void>
}) {
  const [revealed, setRevealed] = useState(false)
  const hidden = masked && !revealed
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-lg border border-edge bg-bg px-3 py-3 text-sm">
        <CheckCircle2
          size={18}
          aria-hidden
          className="shrink-0 text-green-600 dark:text-green-400"
        />
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          {label}{' '}
          <span className="font-medium text-fg">
            {hidden ? '•••••••••••' : account}
          </span>
        </span>
        {masked && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide the account' : 'Show the account'}
            title={revealed ? 'Hide the account' : 'Show the account'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {revealed ? (
              <EyeOff size={15} aria-hidden />
            ) : (
              <Eye size={15} aria-hidden />
            )}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDisconnect}
        className="w-full rounded-lg border border-edge px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
      >
        Disconnect
      </button>
    </div>
  )
}

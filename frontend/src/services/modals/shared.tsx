import {CheckCircle2} from 'lucide-react'
import type {ComponentProps, ReactNode} from 'react'

export const fieldInputClass =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted'

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
  onDisconnect,
}: {
  label: string
  account: string
  onDisconnect: () => void | Promise<void>
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-lg border border-edge bg-bg px-3 py-3 text-sm">
        <CheckCircle2
          size={18}
          aria-hidden
          className="shrink-0 text-green-600 dark:text-green-400"
        />
        <span className="text-fg-muted">
          {label} <span className="font-medium text-fg">{account}</span>
        </span>
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

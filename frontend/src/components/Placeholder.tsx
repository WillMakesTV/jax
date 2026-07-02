import type {LucideIcon} from 'lucide-react'

interface PlaceholderProps {
  icon: LucideIcon
  message: string
}

/** Empty-state card shown by views that are not yet implemented. */
export function Placeholder({icon: Icon, message}: PlaceholderProps) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-edge bg-surface p-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-hover text-fg-muted"
        >
          <Icon size={28} strokeWidth={1.75} />
        </span>
        <p className="max-w-sm text-sm text-fg-muted">{message}</p>
      </div>
    </div>
  )
}

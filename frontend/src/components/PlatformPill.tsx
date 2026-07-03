import {SERVICES} from '../services/services'

/**
 * Small display pill with the platform's logo, signalling where content is
 * hosted (e.g. on video cards). For a clickable deep-link variant see the
 * BroadcastChip in the Streams view.
 */
export function PlatformPill({
  platform,
  label,
}: {
  platform: string
  /** Text next to the logo; defaults to the platform's display name. */
  label?: string
}) {
  const def = SERVICES.find((s) => s.id === platform)
  const Icon = def?.Icon
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted">
      {Icon && (
        <span
          aria-hidden
          className="flex h-4 w-4 items-center justify-center rounded-full text-white"
          style={{backgroundColor: def?.brand}}
        >
          <Icon size={10} />
        </span>
      )}
      {label ?? def?.name ?? platform}
    </span>
  )
}

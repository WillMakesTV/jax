import {SERVICES} from '../services/services'

/** Square brand-coloured logo tile for a platform (twitch, youtube, obs). */
export function BrandTile({
  platform,
  size = 36,
}: {
  platform: string
  size?: number
}) {
  const def = SERVICES.find((s) => s.id === platform)
  if (!def) return null
  const Icon = def.Icon
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg text-white"
      style={{width: size, height: size, backgroundColor: def.brand}}
    >
      <Icon size={Math.round(size * 0.55)} />
    </span>
  )
}

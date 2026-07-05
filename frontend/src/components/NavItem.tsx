import clsx from 'clsx'
import type {NavItemConfig} from '../navigation'

interface NavItemProps {
  item: NavItemConfig
  active: boolean
  collapsed: boolean
  /** Render the item's icon as a pulsing red "on air" indicator. */
  live?: boolean
  onSelect: () => void
}

/**
 * A single sidebar navigation button. When the sidebar is collapsed the label
 * is hidden but remains accessible via `aria-label` and a native tooltip.
 */
export function NavItem({item, active, collapsed, live, onSelect}: NavItemProps) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={clsx(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        collapsed && 'justify-center',
        active
          ? 'bg-accent text-accent-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon
        size={20}
        strokeWidth={2}
        aria-hidden
        className={clsx(
          'shrink-0',
          live &&
            'animate-pulse text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.75)] dark:text-red-400',
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  )
}

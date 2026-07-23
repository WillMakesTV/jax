import clsx from 'clsx'
import type {NavItemConfig} from '../navigation'

interface NavItemProps {
  item: NavItemConfig
  active: boolean
  collapsed: boolean
  onSelect: () => void
  /**
   * When true the item draws no active background of its own — a shared
   * indicator behind the list provides it, and slides between items. The item
   * still colours its own text for the active state.
   */
  flat?: boolean
}

/**
 * A single sidebar navigation button. When the sidebar is collapsed the label
 * is hidden but remains accessible via `aria-label` and a native tooltip.
 */
export function NavItem({
  item,
  active,
  collapsed,
  onSelect,
  flat,
}: NavItemProps) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={clsx(
        'relative z-10 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        collapsed && 'justify-center',
        active
          ? flat
            ? 'text-accent-fg'
            : 'bg-accent text-accent-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon size={20} strokeWidth={2} aria-hidden className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  )
}

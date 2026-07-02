import clsx from 'clsx'
import {ChevronLeft, ChevronRight, Radio} from 'lucide-react'
import {PRIMARY_NAV, SETTINGS_NAV, type ViewId} from '../navigation'
import {NavItem} from './NavItem'

interface SidebarProps {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

/**
 * Fixed left navigation. Holds the app logo and the primary nav items, with the
 * Settings item pinned to the bottom. A chevron toggle straddles the right
 * border to collapse/expand the rail.
 */
export function Sidebar({
  activeView,
  onNavigate,
  collapsed,
  onToggleCollapsed,
}: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className={clsx(
        'relative z-10 flex h-full flex-col border-r border-edge bg-surface transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Collapse / expand toggle, straddling the right border and vertically
          aligned with the first nav item (header 64px + nav pad 8px + half
          item height 20px = 92px / 5.75rem). */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        aria-pressed={collapsed}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className="absolute top-[5.75rem] -right-3 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-fg-muted shadow-sm transition-colors hover:bg-surface-hover hover:text-fg"
      >
        {collapsed ? (
          <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
        ) : (
          <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
        )}
      </button>

      {/* Brand / logo */}
      <div
        className={clsx(
          'flex h-16 items-center gap-2.5 px-3',
          collapsed && 'justify-center',
        )}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
        >
          <Radio size={20} strokeWidth={2.25} />
        </span>
        {!collapsed && (
          <span className="truncate text-base font-semibold tracking-tight text-fg">
            Jax
          </span>
        )}
      </div>

      {/* Primary navigation. Extra right padding keeps the active item
          highlight clear of the chevron toggle that straddles the border. */}
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto py-2 pl-2 pr-4">
        {PRIMARY_NAV.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            active={activeView === item.id}
            collapsed={collapsed}
            onSelect={() => onNavigate(item.id)}
          />
        ))}
      </div>

      {/* Settings pinned to the bottom. Matches the primary list's right
          padding so all item highlights share the same inset. */}
      <div className="border-t border-edge py-2 pl-2 pr-4">
        <NavItem
          item={SETTINGS_NAV}
          active={activeView === SETTINGS_NAV.id}
          collapsed={collapsed}
          onSelect={() => onNavigate(SETTINGS_NAV.id)}
        />
      </div>
    </nav>
  )
}

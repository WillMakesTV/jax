import {ChevronDown, User} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import type {ViewId} from '../navigation'
import {useProfile} from '../profile/ProfileProvider'
import {Avatar} from './Avatar'

interface UserMenuProps {
  onNavigate: (view: ViewId) => void
}

/**
 * Top-right user menu. The trigger shows the user's avatar (Gravatar photo or
 * default icon) and name; the dropdown links to the Profile view.
 */
export function UserMenu({onNavigate}: UserMenuProps) {
  const {profile} = useProfile()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const trimmedName = profile.name.trim()
  const trimmedEmail = profile.email.trim()

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
        className="flex items-center gap-2 rounded-full p-1 pr-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
      >
        <Avatar email={profile.email} name={profile.name} size={32} />
        <span className="hidden max-w-[10rem] truncate sm:block">
          {trimmedName || 'Your profile'}
        </span>
        <ChevronDown size={16} aria-hidden className="text-fg-muted" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="User menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-edge bg-surface shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
            <Avatar email={profile.email} name={profile.name} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">
                {trimmedName || 'No name set'}
              </p>
              {trimmedEmail && (
                <p className="truncate text-xs text-fg-muted">{trimmedEmail}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onNavigate('profile')
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <User size={16} aria-hidden />
            Profile
          </button>
        </div>
      )}
    </div>
  )
}

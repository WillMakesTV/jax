import {X} from 'lucide-react'
import {useEffect, useRef, type ReactNode} from 'react'
import {createPortal} from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Optional element rendered to the left of the title (e.g. a logo). */
  icon?: ReactNode
  children: ReactNode
}

/**
 * Accessible modal dialog rendered into a portal. Closes on Escape and on
 * backdrop click, traps initial focus on the dialog, and restores focus to the
 * previously focused element on close.
 */
export function Modal({open, onClose, title, icon, children}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Prevent background scroll while open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Move focus into the dialog.
    dialogRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        // Close only when the backdrop itself is clicked.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-edge bg-surface shadow-2xl outline-none"
      >
        <div className="flex items-center gap-3 border-b border-edge px-5 py-4">
          {icon}
          <h2 className="flex-1 text-base font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

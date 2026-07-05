import type {ReactNode} from 'react'

interface PageHeaderProps {
  /** Optional — the primary route title now lives in the top bar. */
  title?: string
  description?: string
  actions?: ReactNode
}

/**
 * A view's sub-header: an optional description and actions. The primary route
 * title lives in the application top bar, so most views omit `title` here.
 */
export function PageHeader({title, description, actions}: PageHeaderProps) {
  if (!title && !description && !actions) return null
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        {title && (
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {title}
          </h1>
        )}
        {description && (
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  )
}

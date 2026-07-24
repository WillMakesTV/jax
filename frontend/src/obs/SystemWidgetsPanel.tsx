import {
  Bell,
  Check,
  Copy,
  FolderKanban,
  Handshake,
  LayoutGrid,
  ListChecks,
  MessagesSquare,
  Pencil,
  Power,
  type LucideIcon,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  GetSystemWidgets,
  SetSystemWidgetEnabled,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useDataChanged} from '../lib/dataChanged'

/** Icon per system widget, matched to what each overlay shows. */
const SYSTEM_ICONS: Record<string, LucideIcon> = {
  'unified-chat': MessagesSquare,
  sponsors: Handshake,
  'issue-tracker': ListChecks,
  'active-project': FolderKanban,
  'event-feed': Bell,
}

/**
 * The OBS section's System Widgets tab: the built-in Browser Sources the app
 * ships — fully implemented overlays that only need enabling and pointing OBS
 * at. Each can be switched off (which 404s its page) and, where its display is
 * template- or overlay-based, customized on its own details page.
 */
export function SystemWidgetsPanel({
  onOpenSystemWidget,
}: {
  /** Open a system widget's display page. */
  onOpenSystemWidget: (widget: main.SystemWidget) => void
}) {
  const [sysWidgets, setSysWidgets] = useState<main.SystemWidget[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    GetSystemWidgets()
      .then((s) => setSysWidgets(s ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  // Widgets toggled or customized elsewhere (e.g. an MCP client) appear
  // without a re-visit.
  useDataChanged(['system_widgets_disabled', 'system_widget_overrides'], load)

  // Which widget's Browser Source address was just copied, for feedback.
  const [copiedId, setCopiedId] = useState('')
  const copySource = async (sw: main.SystemWidget) => {
    if (!sw.sourceUrl) return
    try {
      await navigator.clipboard.writeText(sw.sourceUrl)
      setCopiedId(sw.id)
      window.setTimeout(
        () => setCopiedId((cur) => (cur === sw.id ? '' : cur)),
        2000,
      )
    } catch {
      // Clipboard unavailable; the details page still shows the address.
    }
  }

  // Switch a built-in widget on or off; off 404s its Browser Source page.
  const toggleSystem = async (sw: main.SystemWidget) => {
    setError('')
    try {
      const updated = await SetSystemWidgetEnabled(sw.id, !sw.enabled)
      setSysWidgets(updated ?? [])
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The system widget could not be switched.',
      )
    }
  }

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <p className="max-w-md text-sm text-fg-muted">
        Built-in overlays the app ships, enabled by default. Switch one off to
        take its Browser Source dark, or customize its display.
      </p>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sysWidgets.map((sw) => {
          const Icon = SYSTEM_ICONS[sw.id] ?? LayoutGrid
          return (
            <li
              key={sw.id}
              className="flex flex-col rounded-xl border border-edge bg-surface p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
                >
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">
                    {sw.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                    {sw.description}
                  </span>
                </div>
              </div>
              {/* CTAs sit at the card's foot in a three-up grid, aligned
                  across the row whatever each description's height. */}
              <div className="mt-auto grid grid-cols-3 gap-2 pt-4">
                {sw.editable && (
                  <button
                    type="button"
                    onClick={() => onOpenSystemWidget(sw)}
                    title="Customize this widget's display"
                    className="inline-flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    <Pencil size={12} aria-hidden className="shrink-0" />
                    <span className="truncate">
                      {sw.customized ? 'Edit display' : 'Customize'}
                    </span>
                  </button>
                )}
                {sw.enabled && sw.sourceUrl && (
                  <button
                    type="button"
                    onClick={() => void copySource(sw)}
                    title="Copy the OBS Browser Source address"
                    className="inline-flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    {copiedId === sw.id ? (
                      <Check size={12} aria-hidden className="shrink-0" />
                    ) : (
                      <Copy size={12} aria-hidden className="shrink-0" />
                    )}
                    <span className="truncate">
                      {copiedId === sw.id ? 'Copied' : 'Copy Browser Source'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void toggleSystem(sw)}
                  title={
                    sw.enabled
                      ? 'Disable this widget — its Browser Source page goes dark'
                      : 'Enable this widget'
                  }
                  className={`inline-flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    sw.enabled
                      ? 'bg-accent text-accent-fg hover:opacity-90'
                      : 'border border-edge bg-bg text-fg-muted hover:bg-surface-hover hover:text-fg'
                  }`}
                >
                  <Power size={12} aria-hidden className="shrink-0" />
                  <span className="truncate">
                    {sw.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

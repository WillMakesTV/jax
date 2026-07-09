import {Pencil, Sparkles, Type} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useEvents} from '../events/EventsProvider'
import {useLiveData} from '../live/LiveDataProvider'
import {
  computeTokenValues,
  loadCustomTokens,
  loadSmartSources,
  renderTemplate,
  type SmartSource,
} from '../lib/smartSources'

/**
 * The OBS Studio "Smart Sources" tab: a list of the Text (GDI+) sources
 * designated as smart. Editing a source's template and managing custom tokens
 * happen on their own pages (reached via the callbacks below) — the panel
 * itself only reads.
 */
export function SmartSourcesPanel({
  onEditSource,
  onOpenCustomTokens,
}: {
  /** Open the template-editor page for one smart source. */
  onEditSource: (name: string) => void
  /** Open the custom-tokens page. */
  onOpenCustomTokens: () => void
}) {
  const {platforms, obs, sourcesRev} = useLiveData()
  const {events} = useEvents()
  const [sources, setSources] = useState<Record<string, SmartSource>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  // A 1s tick keeps the live previews (viewers, uptime, time) fresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000)
    return () => window.clearInterval(id)
  }, [])

  // Reload when the set may have changed (e.g. a source toggled Smart from
  // Scenes). All editing happens on separate pages, so a plain disk read can
  // never clobber an in-progress edit here.
  useEffect(() => {
    loadSmartSources().then(setSources)
    loadCustomTokens().then(setCustom)
  }, [sourcesRev])

  const values = computeTokenValues(platforms, obs, events, new Date(), custom)
  const customCount = Object.keys(custom).length
  const names = Object.keys(sources)

  return (
    <div className="flex flex-col gap-4">
      {/* Content-area actions. */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onOpenCustomTokens}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          <Sparkles size={14} aria-hidden />
          Custom tokens
          {customCount > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 text-xs font-semibold text-accent">
              {customCount}
            </span>
          )}
        </button>
      </div>

      {names.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-surface px-6 py-16 text-center">
          <span
            aria-hidden
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-hover text-fg-muted"
          >
            <Sparkles size={24} />
          </span>
          <h2 className="text-base font-semibold text-fg">
            No smart sources yet
          </h2>
          <p className="mt-2 max-w-md text-sm text-fg-muted">
            On the Dashboard, open a scene and toggle a{' '}
            <span className="font-medium text-fg">Text (GDI+)</span> source as
            Smart. It will appear here, where you can build its text from live
            tokens the app keeps updated in OBS.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {names.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => onEditSource(name)}
                className="group flex w-full items-center gap-3 rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:bg-surface-hover"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
                >
                  <Type size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">
                    {name}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {renderTemplate(sources[name].template, values) || (
                      <span className="italic">empty</span>
                    )}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors group-hover:text-fg">
                  <Pencil size={13} aria-hidden />
                  Edit
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

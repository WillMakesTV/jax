import {Pencil, Plus, Sparkles, Trash2, Type} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {Modal} from '../components/Modal'
import {useEvents} from '../events/EventsProvider'
import {useLiveData} from '../live/LiveDataProvider'
import {
  computeTokenValues,
  EPISODE_NUMBER_TOKEN,
  EPISODE_TITLE_TOKEN,
  loadCustomTokens,
  loadSmartSources,
  renderTemplate,
  sanitizeTokenName,
  saveCustomTokens,
  saveSmartSources,
  SMART_TOKENS,
  type SmartSource,
} from '../lib/smartSources'

/**
 * The OBS Studio "Smart Sources" tab: a list of the Text (GDI+) sources
 * designated as smart, each opening an edit modal for its token template.
 * Custom tokens are managed from a top-right CTA.
 */
export function SmartSourcesPanel() {
  const {platforms, obs, sourcesRev, refreshObs} = useLiveData()
  const {events} = useEvents()
  const [sources, setSources] = useState<Record<string, SmartSource>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)

  // A 1s tick keeps the live previews (viewers, uptime, time) fresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000)
    return () => window.clearInterval(id)
  }, [])

  // Reload the smart-source set when it may have changed (e.g. a source
  // toggled Smart from Scenes), merging so an in-progress template edit — which
  // bumps sourcesRev via its own save — isn't clobbered by the disk read.
  useEffect(() => {
    loadSmartSources().then((disk) => {
      setSources((local) => {
        const merged: Record<string, SmartSource> = {}
        for (const key of Object.keys(disk)) {
          merged[key] = local[key] ?? disk[key]
        }
        return merged
      })
    })
  }, [sourcesRev])

  // Custom tokens are only edited here, so load them once. Reloading on every
  // sourcesRev bump (which our own saves trigger) would clobber a live edit.
  useEffect(() => {
    loadCustomTokens().then(setCustom)
  }, [])

  const persist = (next: Record<string, SmartSource>) => {
    setSources(next)
    saveSmartSources(next)
    refreshObs()
  }

  const persistCustom = (next: Record<string, string>) => {
    setCustom(next)
    saveCustomTokens(next)
    refreshObs()
  }

  const setTemplate = (name: string, template: string) =>
    persist({...sources, [name]: {template}})

  const remove = (name: string) => {
    const next = {...sources}
    delete next[name]
    persist(next)
  }

  const values = computeTokenValues(platforms, obs, events, new Date(), custom)
  // The auto-managed episode tokens already appear among the built-in chips.
  const customTokens = Object.keys(custom)
    .filter((n) => n !== EPISODE_TITLE_TOKEN && n !== EPISODE_NUMBER_TOKEN)
    .map((n) => `{${n}}`)
  const names = Object.keys(sources)

  return (
    <div className="flex flex-col gap-4">
      {/* Content-area actions. */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          <Sparkles size={14} aria-hidden />
          Custom tokens
          {customTokens.length > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 text-xs font-semibold text-accent">
              {customTokens.length}
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
                onClick={() => setEditing(name)}
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

      {/* Edit one smart source. */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ?? ''}
        icon={<Type size={18} aria-hidden className="text-fg-muted" />}
        maxWidthClass="max-w-xl"
      >
        {editing && sources[editing] && (
          <SmartSourceEditor
            template={sources[editing].template}
            preview={renderTemplate(sources[editing].template, values)}
            customTokens={customTokens}
            onChange={(t) => setTemplate(editing, t)}
            onRemove={() => {
              remove(editing)
              setEditing(null)
            }}
          />
        )}
      </Modal>

      {/* Manage custom tokens. */}
      <Modal
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Custom tokens"
        icon={<Sparkles size={18} aria-hidden className="text-fg-muted" />}
        maxWidthClass="max-w-xl"
      >
        <CustomTokensEditor
          custom={custom}
          values={values}
          onChange={persistCustom}
        />
      </Modal>
    </div>
  )
}

function SmartSourceEditor({
  template,
  preview,
  customTokens,
  onChange,
  onRemove,
}: {
  template: string
  preview: string
  customTokens: string[]
  onChange: (template: string) => void
  onRemove: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertToken = (token: string) => {
    const el = textareaRef.current
    if (!el) {
      onChange(`${template}${token}`)
      return
    }
    const start = el.selectionStart ?? template.length
    const end = el.selectionEnd ?? template.length
    onChange(template.slice(0, start) + token + template.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        ref={textareaRef}
        value={template}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        spellCheck={false}
        placeholder="e.g. {viewers} watching · up {uptime}"
        className="w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus:border-accent"
      />

      <div>
        <p className="mb-1.5 text-xs font-medium text-fg-muted">Tokens</p>
        <div className="flex flex-wrap gap-1.5">
          {SMART_TOKENS.map((t) => (
            <button
              key={t.token}
              type="button"
              onClick={() => insertToken(t.token)}
              title={t.label}
              className="rounded-md border border-edge bg-bg px-2 py-1 font-mono text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              {t.token}
            </button>
          ))}
          {customTokens.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => insertToken(t)}
              title="Custom token"
              className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-xs text-fg transition-colors hover:bg-accent/20"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-fg-muted">Preview</p>
        <div className="min-h-[2.25rem] whitespace-pre-wrap break-words rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg">
          {preview || (
            <span className="text-fg-muted">
              (empty — add some text or tokens above)
            </span>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <Trash2 size={13} aria-hidden />
          Remove smart source
        </button>
      </div>
    </div>
  )
}

/** Define reusable custom tokens (bare name → static value). */
function CustomTokensEditor({
  custom,
  values,
  onChange,
}: {
  custom: Record<string, string>
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')

  const add = () => {
    const name = sanitizeTokenName(newName)
    if (!name || values[`{${name}}`] !== undefined) return
    onChange({...custom, [name]: newValue})
    setNewName('')
    setNewValue('')
  }

  const update = (name: string, value: string) =>
    onChange({...custom, [name]: value})

  const remove = (name: string) => {
    const next = {...custom}
    delete next[name]
    onChange(next)
  }

  const names = Object.keys(custom)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-muted">
        Reusable placeholders with a value you set. Insert them like any token,
        e.g. <span className="font-mono">{'{sponsor}'}</span>.
      </p>

      {names.length > 0 && (
        <ul className="flex flex-col gap-2">
          {names.map((name) => (
            <li key={name} className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate font-mono text-xs text-fg-muted">
                {`{${name}}`}
              </span>
              <input
                value={custom[name]}
                onChange={(e) => update(name, e.target.value)}
                placeholder="Value"
                className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => remove(name)}
                title="Remove token"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="token_name"
          className="w-40 shrink-0 rounded-lg border border-edge bg-bg px-2.5 py-1.5 font-mono text-sm text-fg outline-none focus:border-accent"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="Value"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          <Plus size={14} aria-hidden />
          Add
        </button>
      </div>
    </div>
  )
}

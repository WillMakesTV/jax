import {ArrowLeft, Trash2} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useEvents} from '../events/EventsProvider'
import {useLiveData} from '../live/LiveDataProvider'
import {
  computeTokenValues,
  loadCustomTokens,
  loadSmartSources,
  renderTemplate,
  saveSmartSources,
  SMART_TOKENS,
  type SmartSource,
} from '../lib/smartSources'

/**
 * Edit one smart source's token template on its own page. Changes persist on
 * every edit (the app-wide updater pushes the rendered text into OBS), so
 * there is no explicit save — just the back button when done.
 */
export function EditSmartSource({
  sourceName,
  onBack,
}: {
  /** The OBS text source whose template is being edited. */
  sourceName: string
  onBack: () => void
}) {
  const {platforms, obs, refreshObs} = useLiveData()
  const {events} = useEvents()
  // null until the disk read resolves; the page owns the edit session after.
  const [sources, setSources] = useState<Record<string, SmartSource> | null>(
    null,
  )
  const [custom, setCustom] = useState<Record<string, string>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // A 1s tick keeps the live preview (viewers, uptime, time) fresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1_000)
    return () => window.clearInterval(id)
  }, [])

  // Load once on mount: this page is the only writer while it is open, so
  // re-reading on later revisions would only risk clobbering in-flight typing.
  useEffect(() => {
    loadSmartSources().then(setSources)
    loadCustomTokens().then(setCustom)
  }, [])

  const template = sources?.[sourceName]?.template

  const setTemplate = (t: string) => {
    if (!sources) return
    const next = {...sources, [sourceName]: {template: t}}
    setSources(next)
    saveSmartSources(next)
    refreshObs()
  }

  const remove = () => {
    if (!sources) return
    const next = {...sources}
    delete next[sourceName]
    saveSmartSources(next)
    refreshObs()
    onBack()
  }

  const insertToken = (token: string) => {
    if (template === undefined) return
    const el = textareaRef.current
    if (!el) {
      setTemplate(`${template}${token}`)
      return
    }
    const start = el.selectionStart ?? template.length
    const end = el.selectionEnd ?? template.length
    setTemplate(template.slice(0, start) + token + template.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  const values = computeTokenValues(platforms, obs, events, new Date(), custom)
  const customTokens = Object.keys(custom).map((n) => `{${n}}`)

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Smart Sources
      </button>

      <div className="flex max-w-2xl flex-col gap-4">
        {sources === null ? null : template === undefined ? (
          <p className="text-sm text-fg-muted">
            This source is no longer designated as smart. Head back and toggle
            it Smart again from a scene on the Dashboard.
          </p>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              Build the text for{' '}
              <span className="font-medium text-fg">{sourceName}</span> from
              live tokens. Changes save automatically and update in OBS while
              connected. You can also edit the text directly in OBS — your
              wording is kept, and only the{' '}
              <span className="font-mono">{'{tokens}'}</span> inside it are
              replaced with live values.
            </p>

            <textarea
              ref={textareaRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
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
              <p className="mb-1.5 text-xs font-medium text-fg-muted">
                Preview
              </p>
              <div className="min-h-[2.25rem] whitespace-pre-wrap break-words rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg">
                {renderTemplate(template, values) || (
                  <span className="text-fg-muted">
                    (empty — add some text or tokens above)
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={remove}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <Trash2 size={13} aria-hidden />
                Remove smart source
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

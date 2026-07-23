import {LayoutGrid, RotateCcw} from 'lucide-react'
import {useState} from 'react'
import {
  GetSystemWidgetDisplay,
  ResetSystemWidgetDisplay,
  SetSystemWidgetDisplay,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {JsxTemplateField} from '../components/JsxTemplateField'
import {Modal} from '../components/Modal'

interface SystemWidgetDisplayModalProps {
  open: boolean
  onClose: () => void
  /** The system widget whose display is being edited. */
  widget: main.SystemWidget | null
  /** Reload the panel after a save or reset (the customized flag changed). */
  onSaved?: () => void
}

/**
 * Edit a system widget's display — its JSX template, stylesheet and custom JS —
 * just as a producer's own widget is edited. The built-in look is the starting
 * point and Reset returns to it, so a customization is always reversible.
 */
export function SystemWidgetDisplayModal({
  open,
  onClose,
  widget,
  onSaved,
}: SystemWidgetDisplayModalProps) {
  const [template, setTemplate] = useState('')
  const [css, setCss] = useState('')
  const [js, setJs] = useState('')
  const [displayTab, setDisplayTab] = useState<'template' | 'css' | 'js'>(
    'template',
  )
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Load the widget's current display each time the dialog opens. Done
  // synchronously against the open transition (not in an effect) so the fields
  // never flash a previous widget's content.
  const [prevKey, setPrevKey] = useState('')
  const key = open && widget ? widget.id : ''
  if (key !== prevKey) {
    setPrevKey(key)
    if (key && widget) {
      setError('')
      setDisplayTab('template')
      setLoading(true)
      GetSystemWidgetDisplay(widget.id)
        .then((d) => {
          setTemplate(d.template)
          setCss(d.css)
          setJs(d.js)
        })
        .catch((err) => setError(String(err)))
        .finally(() => setLoading(false))
    }
  }

  const save = async () => {
    if (!widget) return
    setBusy(true)
    setError('')
    try {
      await SetSystemWidgetDisplay(widget.id, template, css, js)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!widget) return
    setBusy(true)
    setError('')
    try {
      const d = await ResetSystemWidgetDisplay(widget.id)
      setTemplate(d.template)
      setCss(d.css)
      setJs(d.js)
      onSaved?.()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={widget ? `Edit ${widget.name} display` : 'Edit display'}
      icon={<LayoutGrid size={18} aria-hidden className="text-fg-muted" />}
      maxWidthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          JSX that fully controls the widget's display, with a stylesheet and
          custom JS for animation. The built-in look is the starting point —
          Reset to default returns to it at any time.
        </p>

        <div className="flex items-center gap-1">
          {(['template', 'css', 'js'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setDisplayTab(tab)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                displayTab === tab
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
              }`}
            >
              {tab === 'template'
                ? 'Template'
                : tab === 'css'
                  ? 'CSS'
                  : 'JS / Logic'}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-fg-muted">Loading…</p>
        ) : displayTab === 'template' ? (
          <JsxTemplateField
            id="system-widget-template"
            value={template}
            onChange={setTemplate}
          />
        ) : displayTab === 'css' ? (
          <textarea
            value={css}
            onChange={(e) => setCss(e.target.value)}
            rows={12}
            spellCheck={false}
            aria-label="Widget stylesheet"
            className="w-full resize-y rounded-lg border border-edge bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
          />
        ) : (
          <textarea
            value={js}
            onChange={(e) => setJs(e.target.value)}
            rows={12}
            spellCheck={false}
            aria-label="Widget custom logic"
            className="w-full resize-y rounded-lg border border-edge bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
          />
        )}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy || loading}
            title="Discard customizations and return to the built-in display"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-accent disabled:opacity-50"
          >
            <RotateCcw size={14} aria-hidden />
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || loading}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save display'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

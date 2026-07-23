import {
  ArrowLeft,
  Check,
  Copy,
  MonitorPlay,
  Pencil,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  GenerateSystemWidgetDisplay,
  GetSystemWidgetDisplay,
  ResetSystemWidgetDisplay,
  SetSystemWidgetDisplay,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useAiQueue} from '../ai/AiQueueProvider'
import {JsxTemplateField} from '../components/JsxTemplateField'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {Modal} from '../components/Modal'

interface SystemWidgetDetailsProps {
  /** The system widget whose display is being edited. */
  widget: main.SystemWidget
  /** Return to the OBS Stream Widgets tab. */
  onBack: () => void
}

/**
 * The system-widget details page: edit a built-in widget's display just as a
 * producer's own widget is edited — a JSX template with CSS and JS for the
 * template widgets (Issue Tracker, Active Project), or CSS and JS layered onto
 * the fixed overlay for the page widgets (Unified Chat, Sponsors, Event Feed).
 * The AI writes the display from a description, using the same widget-display
 * generation the custom widgets use. Reset returns to the built-in look.
 */
export function SystemWidgetDetails({
  widget,
  onBack,
}: SystemWidgetDetailsProps) {
  const [template, setTemplate] = useState('')
  const [css, setCss] = useState('')
  const [js, setJs] = useState('')
  const [displayTab, setDisplayTab] = useState<'template' | 'css' | 'js'>(
    'template',
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genDesc, setGenDesc] = useState('')
  const queue = useAiQueue()

  // Page widgets (Unified Chat, Sponsors, Event Feed) are fixed overlays that
  // take producer CSS and JS layered onto their built-in design — no template.
  const isPage = widget.displayKind === 'page'
  const tabs: ('template' | 'css' | 'js')[] = isPage
    ? ['css', 'js']
    : ['template', 'css', 'js']

  const applyDisplay = (d: main.SystemWidgetDisplay) => {
    setTemplate(d.template)
    setCss(d.css)
    setJs(d.js)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDisplayTab(widget.displayKind === 'page' ? 'css' : 'template')
    GetSystemWidgetDisplay(widget.id)
      .then((d) => {
        if (!cancelled) applyDisplay(d)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [widget.id, widget.displayKind])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      applyDisplay(await SetSystemWidgetDisplay(widget.id, template, css, js))
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setSaving(true)
    setError('')
    try {
      applyDisplay(await ResetSystemWidgetDisplay(widget.id))
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const hasDisplay = Boolean(template.trim() || css.trim() || js.trim())
  const templateBusy = queue.jobs.some(
    (j) => j.kind === 'widget-template' && j.targetId === widget.id,
  )

  // Generation rides the AI queue; the backend stores the result and returns
  // the formatted display, so the editor just adopts it when the job settles.
  const generate = async () => {
    const desc = genDesc.trim()
    if (!desc) return
    setError('')
    setGenOpen(false)
    setGenDesc('')
    try {
      const d = await queue.enqueue({
        kind: 'widget-template',
        targetId: widget.id,
        title: widget.name,
        label: `Generating display — ${widget.name}`,
        doneDetail: `Widget display ready — ${widget.name}`,
        failDetail: 'Widget display failed',
        busyError: 'a display is already being generated for this widget',
        work: () => GenerateSystemWidgetDisplay(widget.id, desc),
      })
      applyDisplay(d)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The display could not be generated.',
      )
    }
  }

  const [copied, setCopied] = useState(false)
  const copySource = async () => {
    if (!widget.sourceUrl) return
    try {
      await navigator.clipboard.writeText(widget.sourceUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; the address still shows below.
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft size={15} aria-hidden />
          Back to widgets
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              {widget.name}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-fg-muted">
              {widget.description}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setGenOpen(true)}
            disabled={templateBusy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {hasDisplay ? (
              <Pencil size={14} aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )}
            {templateBusy
              ? 'Generating…'
              : hasDisplay
                ? 'Request Edits'
                : 'Generate with AI'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-fg-muted">
          {isPage
            ? "This overlay's design is built in. Add your own CSS and JS to restyle or extend it — they're layered on top of the overlay. Reset to default removes them."
            : "JSX that fully controls the widget's display, with a stylesheet and custom JS for animation. The built-in look is the starting point — Reset to default returns to it at any time."}
        </p>

        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
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
            rows={14}
            spellCheck={false}
            aria-label="Widget stylesheet"
            className="w-full resize-y rounded-lg border border-edge bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
          />
        ) : (
          <textarea
            value={js}
            onChange={(e) => setJs(e.target.value)}
            rows={14}
            spellCheck={false}
            aria-label="Widget custom logic"
            className="w-full resize-y rounded-lg border border-edge bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
          />
        )}
      </div>

      {/* Where the widget shows up in OBS: its locally served page. */}
      {widget.enabled && widget.sourceUrl && (
        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-3">
          <div className="flex items-center gap-2">
            <MonitorPlay
              size={16}
              aria-hidden
              className="shrink-0 text-accent"
            />
            <h2 className="text-sm font-semibold text-fg">Browser Source</h2>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-xs text-fg-muted">
              {widget.sourceUrl}
            </code>
            <button
              type="button"
              onClick={() => void copySource()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              {copied ? (
                <Check size={13} aria-hidden />
              ) : (
                <Copy size={13} aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void reset()}
          disabled={saving || loading}
          title="Discard customizations and return to the built-in display"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-accent disabled:opacity-50"
        >
          <RotateCcw size={14} aria-hidden />
          Reset to default
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            Back to widgets
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save display'}
          </button>
        </div>
      </div>

      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title={
          hasDisplay
            ? 'Request edits to the display'
            : "Generate the widget's display"
        }
        icon={
          hasDisplay ? (
            <Pencil size={18} aria-hidden />
          ) : (
            <Sparkles size={18} aria-hidden />
          )
        }
        maxWidthClass="max-w-lg"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            {isPage
              ? 'Describe how the overlay should look — the AI writes CSS (and any logic) layered onto its built-in design, revising what it wrote before.'
              : hasDisplay
                ? 'Describe what should change — the AI revises the current template, stylesheet, and logic with your edits, keeping everything you leave unmentioned.'
                : 'Describe the layout you want and the AI writes the JSX template, stylesheet, and any custom logic for this widget.'}
          </p>
          <MarkdownField
            id="system-widget-display-brief"
            value={genDesc}
            onChange={setGenDesc}
            placeholder="e.g. A compact lower-third bar: the status line big and bold, sliding in from the left when it changes…"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setGenOpen(false)}
              className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!genDesc.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={14} aria-hidden />
              {hasDisplay ? 'Apply edits' : 'Generate'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

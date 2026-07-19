import {
  Check,
  Copy,
  Image,
  LayoutGrid,
  MonitorPlay,
  Music,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  AddWidgetField,
  GenerateWidgetFieldImage,
  GenerateWidgetFieldSound,
  GenerateWidgetTemplate,
  GetStreamWidgets,
  GetWidgetFieldTypes,
  RemoveWidgetField,
  SaveStreamWidget,
  UploadWidgetFieldImage,
  UploadWidgetFieldSound,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useAiQueue} from '../ai/AiQueueProvider'
import {JsxTemplateField} from '../components/JsxTemplateField'
import {Modal} from '../components/Modal'
import {useDataChanged} from '../lib/dataChanged'
import {formatDate} from '../lib/format'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/** A starter template built from the widget's actual fields, shown as the
 *  editor's placeholder so the syntax is one copy away. */
const templateStarter = (
  w: main.StreamWidget,
  fields: main.WidgetField[],
): string => {
  const lines = fields.map((f) => `  <p>{fields['${f.label}']}</p>`)
  return [
    '<div className="widget">',
    '  <h2>{widget.name}</h2>',
    ...lines,
    '</div>',
  ].join('\n')
}

/**
 * A stream widget's own page, opened from the OBS section's Stream Widgets
 * tab: configure the widget here — its name and the fields it carries,
 * drawn from the field-type catalog (Manage Field Types on the tab).
 */
export function StreamWidgetDetails({
  widget,
  onBack,
}: {
  /** The widget being configured. */
  widget: main.StreamWidget
  onBack: () => void
}) {
  const [w, setW] = useState(widget)
  const [name, setName] = useState(widget.name)
  const [template, setTemplate] = useState(widget.template ?? '')
  const [css, setCss] = useState(widget.css ?? '')
  const [js, setJs] = useState(widget.js ?? '')
  const [displayTab, setDisplayTab] = useState<'template' | 'css' | 'js'>(
    'template',
  )
  const [genOpen, setGenOpen] = useState(false)
  const [genDesc, setGenDesc] = useState('')
  const [copied, setCopied] = useState(false)
  // Field values being edited, keyed by field id; unsaved edits live here.
  const [values, setValues] = useState<Record<string, string>>({})
  // Revision notes for image generation, keyed by field id.
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  // Lines to speak for sound-field TTS, keyed by field id.
  const [speech, setSpeech] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState('')
  const [types, setTypes] = useState<main.WidgetFieldType[]>([])
  const [addTypeId, setAddTypeId] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const queue = useAiQueue()

  // The navigation history hands us a snapshot; reload the live record so
  // edits from a previous visit (or elsewhere) are current.
  const load = useCallback(() => {
    GetStreamWidgets()
      .then((all) => {
        const fresh = (all ?? []).find((x) => x.id === widget.id)
        if (fresh) setW(fresh)
      })
      .catch(() => {})
    GetWidgetFieldTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
  }, [widget])

  useEffect(load, [load])
  useDataChanged(['stream_widgets', 'widget_field_types'], load)

  // Adopt the freshly reloaded record once, but never clobber typing.
  const [synced, setSynced] = useState(w)
  if (w !== synced) {
    setSynced(w)
    setName(w.name)
    setTemplate(w.template ?? '')
    setCss(w.css ?? '')
    setJs(w.js ?? '')
    setValues({})
  }

  const fields = w.fields ?? []
  const typeById = new Map(types.map((t) => [t.id, t]))
  const valueOf = (f: main.WidgetField) => values[f.id] ?? f.value

  const dirty =
    name.trim() !== w.name ||
    template !== (w.template ?? '') ||
    css !== (w.css ?? '') ||
    js !== (w.js ?? '') ||
    fields.some((f) => valueOf(f) !== f.value)

  const save = async () => {
    if (!name.trim()) {
      setError('Give the widget a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await SaveStreamWidget(
        main.StreamWidget.createFrom({
          ...w,
          name: name.trim(),
          template,
          css,
          js,
          fields: fields.map((f) => ({...f, value: valueOf(f)})),
        }),
      )
      setW(saved)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The widget could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  const addField = async () => {
    if (!addTypeId) return
    setError('')
    try {
      setW(await AddWidgetField(w.id, addTypeId, addLabel))
      setAddLabel('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The field could not be added.',
      )
    }
  }

  const removeField = async (fieldID: string) => {
    setError('')
    try {
      setW(await RemoveWidgetField(w.id, fieldID))
    } catch {
      // Non-fatal; the record reconciles on the next load.
    }
  }

  const uploadMedia = async (fieldID: string, kind: string) => {
    setError('')
    setUploading(fieldID)
    try {
      setW(
        await (kind === 'sound'
          ? UploadWidgetFieldSound(w.id, fieldID)
          : UploadWidgetFieldImage(w.id, fieldID)),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The file could not be uploaded.',
      )
    } finally {
      setUploading('')
    }
  }

  // Generation runs through the app-wide AI queue: the backend persists the
  // result, so navigating away mid-run loses nothing.
  const generateImage = async (f: main.WidgetField) => {
    setError('')
    try {
      const saved = await queue.enqueue({
        kind: 'widget-image',
        targetId: w.id,
        dedupe: f.id,
        title: w.name,
        label: `Generating ${f.label} — ${w.name || 'widget'}`,
        doneDetail: `Widget image ready — ${w.name || 'widget'}`,
        failDetail: 'Widget image failed',
        busyError: 'an image is already being generated for this field',
        work: () => GenerateWidgetFieldImage(w.id, f.id, feedback[f.id] ?? ''),
      })
      setW(saved)
      setFeedback((prev) => ({...prev, [f.id]: ''}))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The image could not be generated.',
      )
    }
  }

  const imageBusy = (fieldID: string) =>
    queue.jobs.some(
      (j) =>
        j.kind === 'widget-image' &&
        j.targetId === w.id &&
        j.dedupe === fieldID,
    )

  // Text-to-speech for sound fields, through the same queue: OpenAI TTS
  // with an API key, the local Windows synthesizer otherwise.
  const generateSpeech = async (f: main.WidgetField) => {
    const line = (speech[f.id] ?? '').trim()
    if (!line) return
    setError('')
    try {
      const saved = await queue.enqueue({
        kind: 'widget-sound',
        targetId: w.id,
        dedupe: f.id,
        title: w.name,
        label: `Speaking ${f.label} — ${w.name || 'widget'}`,
        doneDetail: `Widget sound ready — ${w.name || 'widget'}`,
        failDetail: 'Widget sound failed',
        busyError: 'a sound is already being generated for this field',
        work: () => GenerateWidgetFieldSound(w.id, f.id, line),
      })
      setW(saved)
      setSpeech((prev) => ({...prev, [f.id]: ''}))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The sound could not be generated.',
      )
    }
  }

  const soundBusy = (fieldID: string) =>
    queue.jobs.some(
      (j) =>
        j.kind === 'widget-sound' &&
        j.targetId === w.id &&
        j.dedupe === fieldID,
    )

  // Template generation also rides the AI queue; the backend stores the
  // result, so the modal can close as soon as the job is queued.
  const generateTemplate = async () => {
    const desc = genDesc.trim()
    if (!desc) return
    setError('')
    setGenOpen(false)
    setGenDesc('')
    try {
      const saved = await queue.enqueue({
        kind: 'widget-template',
        targetId: w.id,
        title: w.name,
        label: `Generating display — ${w.name || 'widget'}`,
        doneDetail: `Widget display ready — ${w.name || 'widget'}`,
        failDetail: 'Widget display failed',
        busyError: 'a display is already being generated for this widget',
        work: () => GenerateWidgetTemplate(w.id, desc),
      })
      setW(saved)
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

  const templateBusy = queue.jobs.some(
    (j) => j.kind === 'widget-template' && j.targetId === w.id,
  )

  const copySourceUrl = async () => {
    if (!w.sourceUrl) return
    try {
      await navigator.clipboard.writeText(w.sourceUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; the URL is still visible to copy by hand.
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
        >
          <LayoutGrid size={20} />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-fg">
            {w.name || 'Stream widget'}
          </h1>
          {w.createdAt && (
            <p className="text-xs text-fg-muted">
              Created {formatDate(w.createdAt)}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="widget-name" className={labelCls}>
          Widget name
        </label>
        <input
          id="widget-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Follower goal"
          className={field}
        />
      </div>

      {/* The widget's fields, drawn from the field-type catalog. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Fields</h2>
          <div className="flex items-center gap-2">
            <select
              value={addTypeId}
              onChange={(e) => setAddTypeId(e.target.value)}
              aria-label="Field type to add"
              className="rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
            >
              <option value="">Choose a field type…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder="Field name (optional)"
              aria-label="Name for the new field"
              className="w-40 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void addField()}
              disabled={!addTypeId}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus size={14} aria-hidden />
              Add field
            </button>
          </div>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No fields yet — pick a field type above to give this widget its
            content. Manage the available types from the Stream Widgets tab.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {fields.map((f) => {
              const t = typeById.get(f.typeId)
              const kind = t?.kind ?? ''
              const cap = t?.maxLength ?? 0
              const value = valueOf(f)
              return (
                <li
                  key={f.id}
                  className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
                    >
                      {kind === 'image' ? (
                        <Image size={14} />
                      ) : kind === 'sound' ? (
                        <Music size={14} />
                      ) : (
                        <Type size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {f.label}
                    </span>
                    {cap > 0 && (
                      <span className="shrink-0 text-xs text-fg-muted">
                        {[...value].length}/{cap}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeField(f.id)}
                      title="Remove field"
                      aria-label={`Remove field ${f.label}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>

                  {kind === 'image' ? (
                    <div className="flex flex-col gap-2">
                      {f.valueUrl && (
                        <img
                          src={f.valueUrl}
                          alt={f.label}
                          className="max-h-40 w-fit max-w-full rounded-lg border border-edge"
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void uploadMedia(f.id, kind)}
                          disabled={uploading === f.id}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                        >
                          <Upload size={14} aria-hidden />
                          {uploading === f.id ? 'Uploading…' : 'Upload'}
                        </button>
                        <input
                          value={feedback[f.id] ?? ''}
                          onChange={(e) =>
                            setFeedback((prev) => ({
                              ...prev,
                              [f.id]: e.target.value,
                            }))
                          }
                          placeholder={
                            f.valueUrl
                              ? 'Describe what to change (optional)…'
                              : 'Describe the image to generate (optional)…'
                          }
                          aria-label={`Generation notes for ${f.label}`}
                          className={`${field} min-w-40 flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => void generateImage(f)}
                          disabled={imageBusy(f.id)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <Sparkles size={14} aria-hidden />
                          {imageBusy(f.id)
                            ? 'Generating…'
                            : f.valueUrl
                              ? 'Revise with AI'
                              : 'Generate with AI'}
                        </button>
                      </div>
                      <p className="text-xs text-fg-muted">
                        Generation follows this widget's own skill — tune its
                        creative brief under Settings → Skills.
                      </p>
                    </div>
                  ) : kind === 'sound' ? (
                    <div className="flex flex-col gap-2">
                      {f.valueUrl && (
                        // The field's key remounts the player when the file
                        // changes, so a re-upload is picked up immediately.
                        <audio
                          key={f.valueUrl}
                          controls
                          src={f.valueUrl}
                          className="w-full max-w-md"
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void uploadMedia(f.id, kind)}
                          disabled={uploading === f.id}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
                        >
                          <Upload size={14} aria-hidden />
                          {uploading === f.id ? 'Uploading…' : 'Upload sound'}
                        </button>
                        <input
                          value={speech[f.id] ?? ''}
                          onChange={(e) =>
                            setSpeech((prev) => ({
                              ...prev,
                              [f.id]: e.target.value,
                            }))
                          }
                          placeholder="Or type a line to speak…"
                          aria-label={`Text to speak for ${f.label}`}
                          className={`${field} min-w-40 flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => void generateSpeech(f)}
                          disabled={
                            soundBusy(f.id) || !(speech[f.id] ?? '').trim()
                          }
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <Sparkles size={14} aria-hidden />
                          {soundBusy(f.id) ? 'Speaking…' : 'Speak it'}
                        </button>
                      </div>
                      <p className="text-xs text-fg-muted">
                        MP3, WAV, OGG and friends — played on stream when the
                        widget calls for it. Typed lines become speech via
                        OpenAI TTS (API key) or the local Windows voice.
                      </p>
                    </div>
                  ) : kind === 'message' ? (
                    <textarea
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({...prev, [f.id]: e.target.value}))
                      }
                      rows={3}
                      maxLength={cap > 0 ? cap : undefined}
                      placeholder="Markdown message shown on stream…"
                      className={`${field} resize-y`}
                    />
                  ) : (
                    <input
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({...prev, [f.id]: e.target.value}))
                      }
                      maxLength={cap > 0 ? cap : undefined}
                      placeholder="Status shown on stream…"
                      className={field}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* The widget's display: JSX template, stylesheet, and custom logic,
          hand-written or generated from a layout description. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Display</h2>
          <button
            type="button"
            onClick={() => setGenOpen(true)}
            disabled={templateBusy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles size={14} aria-hidden />
            {templateBusy ? 'Generating…' : 'Generate with AI'}
          </button>
        </div>
        <p className="text-xs text-fg-muted">
          JSX that fully controls the widget's display, with a stylesheet and
          custom JS for animation.{' '}
          <code className="rounded bg-surface px-1">widget</code> is the widget
          itself, <code className="rounded bg-surface px-1">fields</code> maps
          each field's label to its value (file fields give a URL), and{' '}
          <code className="rounded bg-surface px-1">playSound('Label')</code>{' '}
          plays a sound field.
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
        {displayTab === 'template' ? (
          <>
            <JsxTemplateField
              id="widget-template"
              value={template}
              onChange={setTemplate}
              placeholder={templateStarter(w, fields)}
            />
            <div className="rounded-lg border border-edge bg-surface px-3 py-2">
              <p className="text-xs font-medium text-fg">Available values</p>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <li className="font-mono text-xs text-fg-muted">
                  {'{widget.name}'}
                </li>
                {fields.map((f) => (
                  <li key={f.id} className="font-mono text-xs text-fg-muted">
                    {`{fields['${f.label}']}`}
                  </li>
                ))}
              </ul>
              {fields.length === 0 && (
                <p className="mt-1 text-xs text-fg-muted">
                  Add fields above and each one appears here as{' '}
                  <code className="rounded bg-bg px-1">
                    {"{fields['Label']}"}
                  </code>
                  .
                </p>
              )}
            </div>
          </>
        ) : displayTab === 'css' ? (
          <textarea
            value={css}
            onChange={(e) => setCss(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={'.widget {\n  font-size: 32px;\n  color: #fff;\n}'}
            aria-label="Widget stylesheet"
            className="w-full resize-y rounded-lg border border-edge bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
          />
        ) : (
          <textarea
            value={js}
            onChange={(e) => setJs(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={
              '// Runs after each render as (widget, fields, playSound, root).\n// The place for animations and timed behaviour.'
            }
            aria-label="Widget custom logic"
            className="w-full resize-y rounded-lg border border-edge bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-accent"
          />
        )}
      </div>

      {/* Where the widget shows up in OBS: its locally served page. */}
      {w.sourceUrl && (
        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-3">
          <div className="flex items-center gap-2">
            <MonitorPlay
              size={16}
              aria-hidden
              className="shrink-0 text-accent"
            />
            <h2 className="text-sm font-semibold text-fg">
              OBS Browser Source
            </h2>
          </div>
          <p className="text-xs text-fg-muted">
            Add a Browser Source in OBS pointed at this address — the page is
            served locally by Jax, renders this widget over a transparent
            background, and follows saved changes live.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-xs text-fg">
              {w.sourceUrl}
            </code>
            <button
              type="button"
              onClick={() => void copySourceUrl()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              {copied ? (
                <Check size={14} aria-hidden />
              ) : (
                <Copy size={14} aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex items-center gap-3">
        {dirty && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save widget'}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          Back to widgets
        </button>
      </div>

      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate the widget's display"
        icon={<Sparkles size={18} aria-hidden />}
        maxWidthClass="max-w-lg"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            Describe the layout you want and the AI writes the JSX template,
            stylesheet, and any custom logic — guided by this widget's skill and
            aware of its fields. The current display, if any, is revised rather
            than discarded.
          </p>
          <textarea
            value={genDesc}
            onChange={(e) => setGenDesc(e.target.value)}
            rows={5}
            autoFocus
            placeholder="e.g. A compact lower-third bar: the image on the left, the status line big and bold beside it, sliding in from the left when shown…"
            aria-label="Layout description"
            className={`${field} resize-y`}
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
              onClick={() => void generateTemplate()}
              disabled={!genDesc.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={14} aria-hidden />
              Generate
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

import {
  BookOpen,
  Check,
  Copy,
  Image,
  LayoutGrid,
  MonitorPlay,
  Music,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  AddWidgetField,
  DeleteStreamWidget,
  GenerateWidgetFieldImage,
  GenerateWidgetFieldSound,
  GenerateWidgetSkill,
  GenerateWidgetTemplate,
  GetStreamWidgets,
  GetWidgetFieldTypes,
  ListAppSkills,
  RemoveWidgetField,
  ResetAppSkill,
  ReviseWidgetSkill,
  SaveAppSkill,
  SaveStreamWidget,
  UploadWidgetFieldImage,
  UploadWidgetFieldSound,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useAiQueue} from '../ai/AiQueueProvider'
import {JsxTemplateField} from '../components/JsxTemplateField'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {Modal} from '../components/Modal'
import {
  formatJsxTemplate,
  formatWidgetCss,
  formatWidgetJs,
} from '../lib/formatTemplate'
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
  // The widget's own dynamic skill (stream-widget-<id>), editable in place.
  const [skill, setSkill] = useState<main.AppSkill | null>(null)
  const [skillDraft, setSkillDraft] = useState<string | null>(null)
  const [skillSaved, setSkillSaved] = useState(false)
  const [skillResetArmed, setSkillResetArmed] = useState(false)
  // The Request Edits modal: a markdown brief of what should change.
  const [editsOpen, setEditsOpen] = useState(false)
  const [editsRequest, setEditsRequest] = useState('')
  // Deleting asks for a second click before it happens.
  const [deleteArmed, setDeleteArmed] = useState(false)
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
    ListAppSkills()
      .then((skills) => {
        const own = (skills ?? []).find(
          (s) => s.id === `stream-widget-${widget.id}`,
        )
        setSkill(own ?? null)
      })
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
      let saved = await queue.enqueue({
        kind: 'widget-template',
        targetId: w.id,
        title: w.name,
        label: `Generating display — ${w.name || 'widget'}`,
        doneDetail: `Widget display ready — ${w.name || 'widget'}`,
        failDetail: 'Widget display failed',
        busyError: 'a display is already being generated for this widget',
        work: () => GenerateWidgetTemplate(w.id, desc),
      })
      // Run the generated display through real prettier and persist the
      // laid-out version; a syntax error leaves it as generated.
      try {
        const [template, css, js] = await Promise.all([
          formatJsxTemplate(saved.template ?? ''),
          formatWidgetCss(saved.css ?? ''),
          formatWidgetJs(saved.js ?? ''),
        ])
        if (
          template !== saved.template ||
          css !== saved.css ||
          js !== saved.js
        ) {
          saved = await SaveStreamWidget(
            main.StreamWidget.createFrom({...saved, template, css, js}),
          )
        }
      } catch {
        // Unformattable output still works on the Browser Source.
      }
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

  const saveSkill = async () => {
    if (!skill || skillDraft === null || skillDraft === skill.content) return
    setError('')
    try {
      const updated = await SaveAppSkill(skill.id, skillDraft)
      setSkill(updated)
      setSkillDraft(null)
      setSkillSaved(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The skill could not be saved.',
      )
    }
  }

  const resetSkill = async () => {
    if (!skill) return
    setError('')
    try {
      const updated = await ResetAppSkill(skill.id)
      setSkill(updated)
      setSkillDraft(null)
      setSkillResetArmed(false)
      setSkillSaved(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The skill could not be reset.',
      )
    }
  }

  // Rebuild the skill brief from the widget itself — fields, template,
  // styles, animations — through the AI queue; the backend stores it.
  const generateSkill = async () => {
    setError('')
    try {
      const updated = await queue.enqueue({
        kind: 'widget-skill',
        targetId: w.id,
        title: w.name,
        label: `Writing widget skill — ${w.name || 'widget'}`,
        doneDetail: `Widget skill ready — ${w.name || 'widget'}`,
        failDetail: 'Widget skill failed',
        busyError: 'a skill is already being generated for this widget',
        work: () => GenerateWidgetSkill(w.id),
      })
      setSkill(updated)
      setSkillDraft(null)
      setSkillSaved(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The skill could not be generated.',
      )
    }
  }

  // Requested edits revise the current skill (rather than rebuilding it
  // from the widget); same queue identity, so one skill job runs at a time.
  const requestSkillEdits = async () => {
    const request = editsRequest.trim()
    if (!request) return
    setError('')
    setEditsOpen(false)
    setEditsRequest('')
    try {
      const updated = await queue.enqueue({
        kind: 'widget-skill',
        targetId: w.id,
        title: w.name,
        label: `Revising widget skill — ${w.name || 'widget'}`,
        doneDetail: `Widget skill revised — ${w.name || 'widget'}`,
        failDetail: 'Widget skill revision failed',
        busyError: 'a skill is already being generated for this widget',
        work: () => ReviseWidgetSkill(w.id, request),
      })
      setSkill(updated)
      setSkillDraft(null)
      setSkillSaved(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The skill could not be revised.',
      )
    }
  }

  const skillBusy = queue.jobs.some(
    (j) => j.kind === 'widget-skill' && j.targetId === w.id,
  )

  const deleteWidget = async () => {
    setError('')
    try {
      await DeleteStreamWidget(w.id)
      onBack()
    } catch (err) {
      setDeleteArmed(false)
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err
            ? err
            : 'The widget could not be deleted.',
      )
    }
  }

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

      {/* The widget's own skill: the brief every image, sound, and template
          generation for this widget follows — editable right here, and the
          same document agents load over MCP (get_skill / save_skill). */}
      {skill && (
        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen size={16} aria-hidden className="shrink-0 text-accent" />
            <h2 className="text-sm font-semibold text-fg">Widget skill</h2>
            {skill.overridden && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                Customized
              </span>
            )}
            {skillDraft !== null && skillDraft !== skill.content && (
              <span className="text-[11px] font-medium text-fg-muted">
                Unsaved changes
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setEditsOpen(true)}
                disabled={skillBusy}
                title="Describe changes to how the widget works, looks, or animates — the AI revises the brief"
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <Pencil size={14} aria-hidden />
                Request Edits
              </button>
              <button
                type="button"
                onClick={() => void generateSkill()}
                disabled={skillBusy}
                title="Write the brief from the widget's fields, template, styles, and animations"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles size={14} aria-hidden />
                {skillBusy ? 'Generating…' : 'Generate'}
              </button>
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            The brief behind everything generated for this widget — images,
            spoken sounds, and the display template. AI agents read it over MCP
            before working with the widget, so edits here change how the widget
            is used everywhere.
          </p>
          <MarkdownField
            key={`${skill.id}:${skill.overridden}`}
            id="widget-skill"
            value={skillDraft ?? skill.content}
            onChange={(next) => {
              setSkillDraft(next)
              setSkillSaved(false)
            }}
            placeholder="Skill instructions in markdown…"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={skillDraft === null || skillDraft === skill.content}
              onClick={() => void saveSkill()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Save skill
            </button>
            {(skill.overridden ||
              (skillDraft !== null && skillDraft !== skill.content)) && (
              <button
                type="button"
                onClick={() =>
                  skillResetArmed ? void resetSkill() : setSkillResetArmed(true)
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  skillResetArmed
                    ? 'border-red-500/50 text-red-500 hover:bg-red-500/10'
                    : 'border-edge text-fg-muted hover:bg-surface-hover hover:text-fg'
                }`}
              >
                <RotateCcw size={14} aria-hidden />
                {skillResetArmed
                  ? 'Discard edits and reset?'
                  : 'Reset to default'}
              </button>
            )}
            {skillSaved &&
              (skillDraft === null || skillDraft === skill.content) && (
                <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
                  <Check size={16} aria-hidden />
                  Saved
                </span>
              )}
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
        <button
          type="button"
          onClick={() =>
            deleteArmed ? void deleteWidget() : setDeleteArmed(true)
          }
          onBlur={() => setDeleteArmed(false)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            deleteArmed
              ? 'border-red-500/50 text-red-500 hover:bg-red-500/10'
              : 'border-edge text-fg-muted hover:bg-surface-hover hover:text-fg'
          }`}
        >
          <Trash2 size={14} aria-hidden />
          {deleteArmed ? 'Really delete this widget?' : 'Delete widget'}
        </button>
      </div>

      <Modal
        open={editsOpen}
        onClose={() => setEditsOpen(false)}
        title="Request edits to the widget skill"
        icon={<Pencil size={18} aria-hidden />}
        maxWidthClass="max-w-lg"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            Describe what should change about how this widget works, looks, or
            animates. The AI revises the current brief with your edits —
            everything you don't mention stays as it is.
          </p>
          <MarkdownField
            id="widget-skill-edits"
            value={editsRequest}
            onChange={setEditsRequest}
            placeholder="e.g. The card should slide in from the right instead of popping, stay on screen twice as long, and use a calmer voice for spoken alerts…"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditsOpen(false)}
              className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void requestSkillEdits()}
              disabled={!editsRequest.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Pencil size={14} aria-hidden />
              Revise skill
            </button>
          </div>
        </div>
      </Modal>

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
          <MarkdownField
            id="widget-display-brief"
            value={genDesc}
            onChange={setGenDesc}
            placeholder="e.g. A compact lower-third bar: the image on the left, the status line big and bold beside it, sliding in from the left when shown…"
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

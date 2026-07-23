import {Image, Music, Plus, Sparkles, Trash2, Upload} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  AddSystemWidgetField,
  GenerateSystemWidgetFieldImage,
  GenerateSystemWidgetFieldSound,
  GetSystemWidgetFields,
  GetWidgetFieldTypes,
  RemoveSystemWidgetField,
  UploadSystemWidgetFieldImage,
  UploadSystemWidgetFieldSound,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useAiQueue} from '../ai/AiQueueProvider'
import {useDataChanged} from '../lib/dataChanged'

/**
 * The Assets section of a system widget's details page: named image and sound
 * assets the widget's display can draw on — the same field types a producer's
 * own widget uses. Several of one kind are allowed, told apart by name. A
 * template widget reads them through `fields['Name']` / `playSound('Name')`; a
 * fixed overlay reads them through `--asset-<name>` CSS variables and
 * `window.jaxAssets['Name']`.
 */
export function SystemWidgetAssets({
  widgetId,
  widgetName,
}: {
  widgetId: string
  widgetName: string
}) {
  const [fields, setFields] = useState<main.WidgetField[]>([])
  const [types, setTypes] = useState<main.WidgetFieldType[]>([])
  const [addTypeId, setAddTypeId] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [speech, setSpeech] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')
  const [removeArmedId, setRemoveArmedId] = useState('')
  const [error, setError] = useState('')
  const queue = useAiQueue()

  const load = useCallback(() => {
    GetSystemWidgetFields(widgetId)
      .then((f) => setFields(f ?? []))
      .catch(() => {})
  }, [widgetId])

  useEffect(() => {
    load()
    GetWidgetFieldTypes()
      .then((t) =>
        setTypes(
          (t ?? []).filter((x) => x.kind === 'image' || x.kind === 'sound'),
        ),
      )
      .catch(() => {})
  }, [load])
  useDataChanged(['system_widget_fields', 'widget_field_types'], load)

  const typeById = new Map(types.map((t) => [t.id, t]))

  const addField = async () => {
    const type = addTypeId || types[0]?.id
    if (!type) return
    if (!addLabel.trim()) {
      setError('Give the asset a name.')
      return
    }
    setError('')
    try {
      setFields(await AddSystemWidgetField(widgetId, type, addLabel.trim()))
      setAddLabel('')
    } catch (err) {
      setError(String(err))
    }
  }

  const removeField = async (fieldId: string) => {
    if (removeArmedId !== fieldId) {
      setRemoveArmedId(fieldId)
      window.setTimeout(
        () => setRemoveArmedId((cur) => (cur === fieldId ? '' : cur)),
        2500,
      )
      return
    }
    setRemoveArmedId('')
    setError('')
    try {
      setFields(await RemoveSystemWidgetField(widgetId, fieldId))
    } catch (err) {
      setError(String(err))
    }
  }

  const upload = async (fieldId: string, kind: string) => {
    setBusyId(fieldId)
    setError('')
    try {
      setFields(
        kind === 'sound'
          ? await UploadSystemWidgetFieldSound(widgetId, fieldId)
          : await UploadSystemWidgetFieldImage(widgetId, fieldId),
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusyId('')
    }
  }

  const imageBusy = (fieldId: string) =>
    queue.jobs.some((j) => j.kind === 'widget-image' && j.dedupe === fieldId)
  const soundBusy = (fieldId: string) =>
    queue.jobs.some((j) => j.kind === 'widget-sound' && j.dedupe === fieldId)

  const generateImage = async (f: main.WidgetField) => {
    setError('')
    try {
      setFields(
        await queue.enqueue({
          kind: 'widget-image',
          targetId: widgetId,
          dedupe: f.id,
          title: widgetName,
          label: `Generating ${f.label} — ${widgetName}`,
          doneDetail: `${f.label} ready — ${widgetName}`,
          failDetail: `${f.label} generation failed`,
          busyError: `${f.label} is already being generated`,
          work: () =>
            GenerateSystemWidgetFieldImage(
              widgetId,
              f.id,
              feedback[f.id] ?? '',
            ),
        }),
      )
    } catch (err) {
      if (err instanceof Error && err.message.includes('already being')) return
      setError(String(err))
    }
  }

  const generateSound = async (f: main.WidgetField) => {
    const line = (speech[f.id] ?? '').trim()
    if (!line) return
    setError('')
    try {
      setFields(
        await queue.enqueue({
          kind: 'widget-sound',
          targetId: widgetId,
          dedupe: f.id,
          title: widgetName,
          label: `Speaking ${f.label} — ${widgetName}`,
          doneDetail: `${f.label} ready — ${widgetName}`,
          failDetail: `${f.label} speech failed`,
          busyError: `${f.label} is already being spoken`,
          work: () => GenerateSystemWidgetFieldSound(widgetId, f.id, line),
        }),
      )
    } catch (err) {
      if (err instanceof Error && err.message.includes('already being')) return
      setError(String(err))
    }
  }

  const input =
    'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-fg">Assets</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Named image and sound assets this widget can use. Template widgets
          read them as{' '}
          <code className="rounded bg-surface px-1">{"fields['Name']"}</code>{' '}
          and <code className="rounded bg-surface px-1">playSound('Name')</code>
          ; fixed overlays read them as{' '}
          <code className="rounded bg-surface px-1">--asset-name</code> CSS
          variables and{' '}
          <code className="rounded bg-surface px-1">
            window.jaxAssets['Name']
          </code>
          .
        </p>
      </div>

      {/* Add an asset: a name is required, and several of one kind are fine. */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={addTypeId || types[0]?.id || ''}
          onChange={(e) => setAddTypeId(e.target.value)}
          aria-label="Asset type"
          className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={addLabel}
          onChange={(e) => setAddLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addField()
          }}
          placeholder="Asset name (required)"
          aria-label="Asset name"
          className={`${input} max-w-xs flex-1`}
        />
        <button
          type="button"
          onClick={() => void addField()}
          disabled={types.length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <Plus size={14} aria-hidden />
          Add asset
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge bg-surface px-4 py-6 text-center text-xs text-fg-muted">
          No assets yet. Add an image or sound above.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {fields.map((f) => {
            const kind = typeById.get(f.typeId)?.kind ?? 'image'
            return (
              <li
                key={f.id}
                className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-3"
              >
                <div className="flex items-center gap-2">
                  {kind === 'sound' ? (
                    <Music size={14} aria-hidden className="text-accent" />
                  ) : (
                    <Image size={14} aria-hidden className="text-accent" />
                  )}
                  <span className="flex-1 truncate text-sm font-medium text-fg">
                    {f.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeField(f.id)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                      removeArmedId === f.id
                        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                    }`}
                  >
                    <Trash2 size={12} aria-hidden />
                    {removeArmedId === f.id ? 'Confirm' : 'Remove'}
                  </button>
                </div>

                {kind === 'sound' ? (
                  <>
                    {f.valueUrl && (
                      <audio
                        key={f.valueUrl}
                        controls
                        src={f.valueUrl}
                        className="w-full"
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void upload(f.id, 'sound')}
                        disabled={busyId === f.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                      >
                        <Upload size={12} aria-hidden />
                        Upload sound
                      </button>
                      <input
                        value={speech[f.id] ?? ''}
                        onChange={(e) =>
                          setSpeech((s) => ({...s, [f.id]: e.target.value}))
                        }
                        placeholder="Type a line to speak"
                        aria-label="Line to speak"
                        className={`${input} min-w-0 flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => void generateSound(f)}
                        disabled={
                          soundBusy(f.id) || !(speech[f.id] ?? '').trim()
                        }
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Sparkles size={12} aria-hidden />
                        {soundBusy(f.id) ? 'Speaking…' : 'Speak it'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {f.valueUrl && (
                      <img
                        src={f.valueUrl}
                        alt={f.label}
                        className="max-h-40 w-fit rounded-lg border border-edge object-contain"
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void upload(f.id, 'image')}
                        disabled={busyId === f.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                      >
                        <Upload size={12} aria-hidden />
                        Upload
                      </button>
                      <input
                        value={feedback[f.id] ?? ''}
                        onChange={(e) =>
                          setFeedback((s) => ({...s, [f.id]: e.target.value}))
                        }
                        placeholder={
                          f.valueUrl
                            ? 'Describe a change to make'
                            : 'Describe the image to generate'
                        }
                        aria-label="Image description"
                        className={`${input} min-w-0 flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => void generateImage(f)}
                        disabled={imageBusy(f.id)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Sparkles size={12} aria-hidden />
                        {imageBusy(f.id)
                          ? 'Generating…'
                          : f.valueUrl
                            ? 'Revise with AI'
                            : 'Generate with AI'}
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

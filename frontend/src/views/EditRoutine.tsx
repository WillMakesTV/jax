import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  GetStreamdeckMultiActions,
  SaveRoutine,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {describeStep, END_ROUTINE, START_ROUTINE} from '../obs/routines'
import {useServices} from '../services/ServicesProvider'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/** A step being edited (plain shape; becomes main.RoutineStep on save). */
interface StepDraft {
  kind: string
  scene?: string
  target?: string
  source?: string
  sceneItemId?: number
  mode?: string
  delayMs?: number
  description?: string
}

/** The step kinds the builder can author (imported kinds still render). */
const STEP_KINDS: {kind: string; label: string}[] = [
  {kind: 'obs-scene', label: 'Switch scene'},
  {kind: 'delay', label: 'Wait'},
  {kind: 'obs-source', label: 'Toggle source'},
  {kind: 'obs-mute', label: 'Mute / unmute input'},
  {kind: 'obs-stream', label: 'Stream'},
  {kind: 'obs-record', label: 'Recording'},
]

/**
 * The routine form on its own page: create a new routine or edit an existing
 * one. A routine is either managed with Jax — its steps are authored here —
 * or managed with a Stream Deck Multi Action picked from the decks' profiles;
 * Jax replays that Multi Action's steps when the routine runs.
 *
 * The built-in Start/End Stream routines run in two phases around their
 * stream transition, so they get a "before" and an "after" section in both
 * managers. Custom routines have no transition and get a single step list.
 */
export function EditRoutine({
  routine,
  onBack,
  onSaved,
}: {
  /** The routine being edited, or null when creating a new one. */
  routine: main.Routine | null
  onBack: () => void
  onSaved: () => void
}) {
  const {statuses, obsRequest} = useServices()
  const obsConnected = statuses.obs.connected

  const isStart = routine?.trigger === START_ROUTINE
  const isEnd = routine?.trigger === END_ROUTINE
  const twoPhase = isStart || isEnd
  // The moment the built-in routine's phases wrap around, for section labels.
  const transition = isStart ? 'the stream starts' : 'the stream stops'

  const [name, setName] = useState(routine?.name ?? '')
  const [manager, setManager] = useState(routine?.manager ?? 'jax')
  const [beforeSteps, setBeforeSteps] = useState<StepDraft[]>(
    (routine?.steps ?? []).map((s) => ({...s})),
  )
  const [afterSteps, setAfterSteps] = useState<StepDraft[]>(
    (routine?.afterSteps ?? []).map((s) => ({...s})),
  )
  const [deckActionId, setDeckActionId] = useState(
    routine?.streamdeckActionId ?? '',
  )
  const [deckAfterActionId, setDeckAfterActionId] = useState(
    routine?.streamdeckAfterActionId ?? '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // OBS catalogues for the step builder's dropdowns.
  const [scenes, setScenes] = useState<string[]>([])
  const [inputs, setInputs] = useState<string[]>([])
  useEffect(() => {
    if (!obsConnected) return
    obsRequest<{scenes: {sceneName: string}[]}>('GetSceneList')
      .then((r) => setScenes((r.scenes ?? []).map((s) => s.sceneName).reverse()))
      .catch(() => {})
    obsRequest<{inputs: {inputName: string}[]}>('GetInputList')
      .then((r) => setInputs((r.inputs ?? []).map((i) => i.inputName)))
      .catch(() => {})
  }, [obsConnected, obsRequest])

  // Stream Deck Multi Actions, loaded while that manager is selected.
  const [deckActions, setDeckActions] = useState<main.StreamdeckMultiAction[]>(
    [],
  )
  const [deckError, setDeckError] = useState('')
  const [deckLoading, setDeckLoading] = useState(false)
  const loadDeckActions = () => {
    setDeckLoading(true)
    GetStreamdeckMultiActions()
      .then((a) => {
        setDeckActions(a ?? [])
        setDeckError(
          (a ?? []).length === 0
            ? 'No Multi Actions found on your Stream Deck. Create one in the Stream Deck app first.'
            : '',
        )
      })
      .catch((err) =>
        setDeckError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not read the Stream Deck profiles.',
        ),
      )
      .finally(() => setDeckLoading(false))
  }
  useEffect(() => {
    if (manager === 'streamdeck' && deckActions.length === 0) loadDeckActions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager])

  const save = async () => {
    if (!name.trim()) {
      setError('Give the routine a name.')
      return
    }
    if (manager === 'streamdeck' && !deckActionId && !deckAfterActionId) {
      setError('Choose a Stream Deck Multi Action for this routine.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const title = (id: string) =>
        deckActions.find((a) => a.id === id)?.title ?? ''
      await SaveRoutine(
        main.Routine.createFrom({
          id: routine?.id ?? '',
          name: name.trim(),
          trigger: routine?.trigger ?? '',
          builtIn: routine?.builtIn ?? false,
          manager,
          streamdeckActionId: manager === 'streamdeck' ? deckActionId : '',
          streamdeckTitle:
            manager === 'streamdeck'
              ? title(deckActionId) || routine?.streamdeckTitle || ''
              : '',
          streamdeckAfterActionId:
            manager === 'streamdeck' && twoPhase ? deckAfterActionId : '',
          streamdeckAfterTitle:
            manager === 'streamdeck' && twoPhase
              ? title(deckAfterActionId) || routine?.streamdeckAfterTitle || ''
              : '',
          steps: beforeSteps,
          afterSteps: twoPhase ? afterSteps : [],
          createdAt: routine?.createdAt ?? '',
        }),
      )
      onSaved()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the routine.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Routines
      </button>

      <div className="max-w-2xl">
        <p className="mb-6 text-sm text-fg-muted">
          {isStart
            ? 'This routine runs automatically when you press Go live: its "before" phase, then the stream starts, then its "after" phase.'
            : isEnd
              ? 'This routine runs automatically when you press Stop stream: its "before" phase, then the stream stops, then its "after" phase.'
              : 'A sequence of broadcast actions you can run from the Routines tab.'}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="flex flex-col gap-5"
        >
          <div>
            <label htmlFor="routine-name" className={labelCls}>
              Name
            </label>
            <input
              id="routine-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Start Stream"
              autoFocus={!routine}
              className={field}
            />
          </div>

          <div>
            <span className={labelCls}>Managed with</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ManagerCard
                selected={manager === 'jax'}
                onSelect={() => setManager('jax')}
                title="Manage with Jax"
                description="Build the step list here: scene switches, waits, mutes, and stream control."
              />
              <ManagerCard
                selected={manager === 'streamdeck'}
                onSelect={() => setManager('streamdeck')}
                title="Manage with Streamdeck"
                description="Pick a Multi Action from your Stream Deck; Jax replays its steps when the routine runs."
              />
            </div>
          </div>

          {manager === 'jax' ? (
            <>
              <StepsEditor
                legend={twoPhase ? `Before ${transition}` : 'Steps'}
                emptyNote={
                  twoPhase
                    ? `No steps yet — nothing extra happens before ${transition}.`
                    : 'No steps yet.'
                }
                steps={beforeSteps}
                setSteps={setBeforeSteps}
                scenes={scenes}
                inputs={inputs}
              />
              {twoPhase && (
                <StepsEditor
                  legend={`After ${transition}`}
                  emptyNote={`No steps yet — nothing extra happens after ${transition}.`}
                  steps={afterSteps}
                  setSteps={setAfterSteps}
                  scenes={scenes}
                  inputs={inputs}
                />
              )}
              {!obsConnected && (
                <p className="text-xs text-fg-muted">
                  Connect OBS in Settings → Services to pick scenes and inputs
                  from lists.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-fg-muted">
                  Multi Actions found across your Stream Deck profiles. Steps
                  Jax cannot replay run only when pressed on the deck itself.
                </p>
                <button
                  type="button"
                  onClick={loadDeckActions}
                  disabled={deckLoading}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                >
                  <RefreshCw size={12} aria-hidden />
                  {deckLoading ? 'Scanning…' : 'Rescan'}
                </button>
              </div>
              {deckError && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {deckError}
                </p>
              )}
              <DeckPicker
                legend={
                  twoPhase ? `Before ${transition}` : 'Stream Deck Multi Action'
                }
                actions={deckActions}
                value={deckActionId}
                onChange={setDeckActionId}
                allowNone={twoPhase}
              />
              {twoPhase && (
                <DeckPicker
                  legend={`After ${transition}`}
                  actions={deckActions}
                  value={deckAfterActionId}
                  onChange={setDeckAfterActionId}
                  allowNone
                />
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save routine'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ManagerCard({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-accent bg-accent/10'
          : 'border-edge bg-surface hover:bg-surface-hover'
      }`}
    >
      <span className="block text-sm font-semibold text-fg">{title}</span>
      <span className="mt-1 block text-xs text-fg-muted">{description}</span>
    </button>
  )
}

/** A radio-card list over the discovered Multi Actions for one phase. */
function DeckPicker({
  legend,
  actions,
  value,
  onChange,
  allowNone,
}: {
  legend: string
  actions: main.StreamdeckMultiAction[]
  value: string
  onChange: (id: string) => void
  /** Offer a "Nothing" card (the built-ins' phases are each optional). */
  allowNone?: boolean
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
      <legend className="px-1 text-sm font-semibold text-fg">{legend}</legend>
      <ul className="flex flex-col gap-2">
        {allowNone && (
          <li>
            <button
              type="button"
              onClick={() => onChange('')}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                value === ''
                  ? 'border-accent bg-accent/10'
                  : 'border-edge bg-bg hover:bg-surface-hover'
              }`}
            >
              <span className="text-sm font-semibold text-fg">Nothing</span>
              <span className="ml-2 text-xs text-fg-muted">
                Skip this phase.
              </span>
            </button>
          </li>
        )}
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              onClick={() => onChange(action.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                value === action.id
                  ? 'border-accent bg-accent/10'
                  : 'border-edge bg-bg hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-fg">
                  {action.title}
                </span>
                <span className="text-xs text-fg-muted">
                  {action.profile} · key {action.coordinates}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(action.steps ?? []).map((s, i) => (
                  <span
                    key={i}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      s.kind === 'unsupported'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-surface-hover text-fg-muted'
                    }`}
                  >
                    {describeStep(s)}
                    {s.kind === 'unsupported' && ' (deck only)'}
                  </span>
                ))}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}

/** The step builder for one phase of a Jax-managed routine. */
function StepsEditor({
  legend,
  emptyNote,
  steps,
  setSteps,
  scenes,
  inputs,
}: {
  legend: string
  emptyNote: string
  steps: StepDraft[]
  setSteps: (update: (all: StepDraft[]) => StepDraft[]) => void
  scenes: string[]
  inputs: string[]
}) {
  const updateStep = (i: number, patch: Partial<StepDraft>) =>
    setSteps((all) => all.map((s, j) => (j === i ? {...s, ...patch} : s)))
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((all) => {
      const j = i + dir
      if (j < 0 || j >= all.length) return all
      const next = [...all]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const removeStep = (i: number) =>
    setSteps((all) => all.filter((_, j) => j !== i))
  const addStep = () =>
    setSteps((all) => [
      ...all,
      {kind: 'obs-scene', scene: scenes[0] ?? '', target: 'program'},
    ])

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <legend className="px-1 text-sm font-semibold text-fg">{legend}</legend>
      {steps.length === 0 && <p className="text-xs text-fg-muted">{emptyNote}</p>}
      {steps.map((step, i) => (
        <StepRow
          key={i}
          step={step}
          scenes={scenes}
          inputs={inputs}
          onChange={(patch) => updateStep(i, patch)}
          onMoveUp={i > 0 ? () => moveStep(i, -1) : undefined}
          onMoveDown={i < steps.length - 1 ? () => moveStep(i, 1) : undefined}
          onRemove={() => removeStep(i)}
        />
      ))}
      <button
        type="button"
        onClick={addStep}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg transition-colors hover:bg-surface-hover"
      >
        <Plus size={12} aria-hidden />
        Add step
      </button>
    </fieldset>
  )
}

/** Text input that upgrades to a datalist-free select when options exist. */
function NameField({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string
  options: string[]
  placeholder: string
  onChange: (v: string) => void
}) {
  if (options.length === 0) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${field} min-w-32 flex-1`}
      />
    )
  }
  // A saved name may reference something OBS no longer has; keep it selectable.
  const opts = value && !options.includes(value) ? [value, ...options] : options
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${field} min-w-32 flex-1`}
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/** One editable step row in the Jax step builder. */
function StepRow({
  step,
  scenes,
  inputs,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: StepDraft
  scenes: string[]
  inputs: string[]
  onChange: (patch: Partial<StepDraft>) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemove: () => void
}) {
  const changeKind = (kind: string) => {
    // Blank every kind-specific field so a stale scene/source doesn't linger,
    // then seed the new kind's defaults.
    const base: StepDraft = {
      kind,
      scene: undefined,
      target: undefined,
      source: undefined,
      sceneItemId: undefined,
      mode: undefined,
      delayMs: undefined,
      description: undefined,
    }
    if (kind === 'obs-scene') Object.assign(base, {scene: scenes[0] ?? '', target: 'program'})
    if (kind === 'delay') base.delayMs = 3000
    if (kind === 'obs-source') Object.assign(base, {scene: scenes[0] ?? '', source: '', sceneItemId: 0, mode: 'toggle'})
    if (kind === 'obs-mute') Object.assign(base, {source: inputs[0] ?? '', mode: 'toggle'})
    if (kind === 'obs-stream' || kind === 'obs-record') base.mode = 'start'
    onChange(base)
  }

  const kindKnown = STEP_KINDS.some((k) => k.kind === step.kind)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-bg p-2">
      <select
        value={kindKnown ? step.kind : 'unsupported'}
        onChange={(e) => changeKind(e.target.value)}
        className={`${field} w-40 flex-none`}
        aria-label="Step type"
      >
        {STEP_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
        {!kindKnown && <option value="unsupported">Unsupported</option>}
      </select>

      {step.kind === 'obs-scene' && (
        <NameField
          value={step.scene ?? ''}
          options={scenes}
          placeholder="Scene name…"
          onChange={(scene) => onChange({scene})}
        />
      )}

      {step.kind === 'delay' && (
        <label className="flex items-center gap-1.5 text-sm text-fg-muted">
          <input
            type="number"
            min={0}
            step={0.5}
            value={(step.delayMs ?? 0) / 1000}
            onChange={(e) =>
              onChange({delayMs: Math.round(Number(e.target.value) * 1000)})
            }
            className={`${field} w-24`}
          />
          seconds
        </label>
      )}

      {step.kind === 'obs-source' && (
        <>
          <NameField
            value={step.scene ?? ''}
            options={scenes}
            placeholder="Scene name…"
            onChange={(scene) => onChange({scene, sceneItemId: 0})}
          />
          <input
            value={step.source ?? ''}
            onChange={(e) => onChange({source: e.target.value, sceneItemId: 0})}
            placeholder="Source name…"
            className={`${field} min-w-32 flex-1`}
          />
        </>
      )}

      {step.kind === 'obs-mute' && (
        <>
          <NameField
            value={step.source ?? ''}
            options={inputs}
            placeholder="Input name…"
            onChange={(source) => onChange({source})}
          />
          <select
            value={step.mode ?? 'toggle'}
            onChange={(e) => onChange({mode: e.target.value})}
            className={`${field} w-28 flex-none`}
            aria-label="Mute mode"
          >
            <option value="toggle">Toggle</option>
            <option value="mute">Mute</option>
            <option value="unmute">Unmute</option>
          </select>
        </>
      )}

      {(step.kind === 'obs-stream' || step.kind === 'obs-record') && (
        <select
          value={step.mode ?? 'toggle'}
          onChange={(e) => onChange({mode: e.target.value})}
          className={`${field} w-28 flex-none`}
          aria-label="Mode"
        >
          <option value="start">Start</option>
          <option value="stop">Stop</option>
          <option value="toggle">Toggle</option>
        </select>
      )}

      {!kindKnown && (
        <span className="flex-1 text-xs text-fg-muted">
          {step.description || step.kind}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!onMoveUp}
          aria-label="Move step up"
          className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
        >
          <ArrowUp size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!onMoveDown}
          aria-label="Move step down"
          className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
        >
          <ArrowDown size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove step"
          className="rounded p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-red-600 dark:hover:text-red-400"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
    </div>
  )
}

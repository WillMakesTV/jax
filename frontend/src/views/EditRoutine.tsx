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
  streamdeckActionId?: string
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
  {kind: 'update-smart-sources', label: 'Update episode info (title/number)'},
  {kind: 'apply-stream-info', label: 'Apply stream info'},
  {kind: 'streamdeck', label: 'Stream Deck Multi Action'},
]

/**
 * The routine form on its own page: create a new routine or edit an existing
 * one. A routine is a single ordered step list; besides OBS actions and
 * waits, a step can be one of the Stream Deck's Multi Actions — Jax replays
 * that Multi Action's own steps (re-read from the deck's profiles at run
 * time) in its place.
 *
 * The built-in Start/End Stream routines run in two phases around their
 * stream transition, so they get a "before" and an "after" step list. Custom
 * routines have no transition and get a single list.
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
  const [beforeSteps, setBeforeSteps] = useState<StepDraft[]>(
    (routine?.steps ?? []).map((s) => ({...s})),
  )
  const [afterSteps, setAfterSteps] = useState<StepDraft[]>(
    (routine?.afterSteps ?? []).map((s) => ({...s})),
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

  // Stream Deck Multi Actions for the streamdeck step kind's picker.
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
        setDeckError('')
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
  useEffect(loadDeckActions, [])

  const save = async () => {
    if (!name.trim()) {
      setError('Give the routine a name.')
      return
    }
    if (
      [...beforeSteps, ...afterSteps].some(
        (s) => s.kind === 'streamdeck' && !s.streamdeckActionId,
      )
    ) {
      setError('Choose a Multi Action for each Stream Deck step.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await SaveRoutine(
        main.Routine.createFrom({
          id: routine?.id ?? '',
          name: name.trim(),
          trigger: routine?.trigger ?? '',
          builtIn: routine?.builtIn ?? false,
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
            ? 'This routine runs automatically when you press Go live: its "before" steps, then the stream starts, then its "after" steps.'
            : isEnd
              ? 'This routine runs automatically when you press Stop stream: its "before" steps, then the stream stops, then its "after" steps.'
              : 'A sequence of broadcast actions you can run from the Routines tab.'}{' '}
          A step can also be one of your Stream Deck Multi Actions — Jax
          replays its steps in place.
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
              disabled={routine?.builtIn}
              title={
                routine?.builtIn
                  ? 'The built-in routines keep their names — only their steps can be edited.'
                  : undefined
              }
              className={`${field} disabled:cursor-not-allowed disabled:opacity-60`}
            />
            {routine?.builtIn && (
              <p className="mt-1.5 text-xs text-fg-muted">
                Built-in routine — the name is fixed, but every step is yours
                to change.
              </p>
            )}
          </div>

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
            deckActions={deckActions}
            deckError={deckError}
          />
          {twoPhase && (
            <StepsEditor
              legend={`After ${transition}`}
              emptyNote={`No steps yet — nothing extra happens after ${transition}.`}
              steps={afterSteps}
              setSteps={setAfterSteps}
              scenes={scenes}
              inputs={inputs}
              deckActions={deckActions}
              deckError={deckError}
            />
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            {!obsConnected && (
              <span>
                Connect OBS in Settings → Services to pick scenes and inputs
                from lists.
              </span>
            )}
            <button
              type="button"
              onClick={loadDeckActions}
              disabled={deckLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            >
              <RefreshCw size={12} aria-hidden />
              {deckLoading ? 'Scanning Stream Deck…' : 'Rescan Stream Deck'}
            </button>
          </div>

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

/** The step builder for one phase of a routine. */
function StepsEditor({
  legend,
  emptyNote,
  steps,
  setSteps,
  scenes,
  inputs,
  deckActions,
  deckError,
}: {
  legend: string
  emptyNote: string
  steps: StepDraft[]
  setSteps: (update: (all: StepDraft[]) => StepDraft[]) => void
  scenes: string[]
  inputs: string[]
  deckActions: main.StreamdeckMultiAction[]
  deckError: string
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
          deckActions={deckActions}
          deckError={deckError}
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

/** Text input that upgrades to a select when options exist. */
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

/** One editable step row in the step builder. */
function StepRow({
  step,
  scenes,
  inputs,
  deckActions,
  deckError,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: StepDraft
  scenes: string[]
  inputs: string[]
  deckActions: main.StreamdeckMultiAction[]
  deckError: string
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
      streamdeckActionId: undefined,
      description: undefined,
    }
    if (kind === 'obs-scene') Object.assign(base, {scene: scenes[0] ?? '', target: 'program'})
    if (kind === 'delay') base.delayMs = 3000
    if (kind === 'obs-source') Object.assign(base, {scene: scenes[0] ?? '', source: '', sceneItemId: 0, mode: 'toggle'})
    if (kind === 'obs-mute') Object.assign(base, {source: inputs[0] ?? '', mode: 'toggle'})
    if (kind === 'obs-stream' || kind === 'obs-record') base.mode = 'start'
    if (kind === 'streamdeck') Object.assign(base, {streamdeckActionId: '', description: ''})
    onChange(base)
  }

  const kindKnown = STEP_KINDS.some((k) => k.kind === step.kind)
  const chosenDeckAction =
    step.kind === 'streamdeck'
      ? deckActions.find((a) => a.id === step.streamdeckActionId)
      : undefined

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-edge bg-bg p-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kindKnown ? step.kind : 'unsupported'}
          onChange={(e) => changeKind(e.target.value)}
          className={`${field} w-44 flex-none`}
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
              onChange={(e) =>
                onChange({source: e.target.value, sceneItemId: 0})
              }
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

        {step.kind === 'update-smart-sources' && (
          <span className="min-w-32 flex-1 text-xs text-fg-muted">
            Pushes the planned stream&apos;s episode title and number to the
            series&apos; mapped text sources; skipped when the stream on the
            air isn&apos;t a planned one using smart sources.
          </span>
        )}

        {step.kind === 'apply-stream-info' && (
          <span className="min-w-32 flex-1 text-xs text-fg-muted">
            Pushes the planned stream&apos;s title and description to its
            channels — Twitch right away; YouTube needs the broadcast live, so
            place this after the stream starts. Skipped when the stream
            isn&apos;t a planned one.
          </span>
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

        {step.kind === 'streamdeck' && (
          <select
            value={step.streamdeckActionId ?? ''}
            onChange={(e) => {
              const chosen = deckActions.find((a) => a.id === e.target.value)
              onChange({
                streamdeckActionId: e.target.value,
                description: chosen?.title ?? step.description ?? '',
              })
            }}
            className={`${field} min-w-32 flex-1`}
            aria-label="Stream Deck Multi Action"
          >
            <option value="">
              {deckActions.length === 0
                ? 'No Multi Actions found…'
                : 'Choose a Multi Action…'}
            </option>
            {/* A saved reference may point at a Multi Action the scan no
                longer finds; keep it selectable so the step isn't lost. */}
            {step.streamdeckActionId &&
              !deckActions.some((a) => a.id === step.streamdeckActionId) && (
                <option value={step.streamdeckActionId}>
                  {step.description || 'Missing Multi Action'} (not found)
                </option>
              )}
            {deckActions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} — {a.profile} · key {a.coordinates}
              </option>
            ))}
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

      {/* What the chosen Multi Action will do; deck-only steps are flagged. */}
      {step.kind === 'streamdeck' && chosenDeckAction && (
        <div className="flex flex-wrap gap-1 pl-1">
          {(chosenDeckAction.steps ?? []).map((s, i) => (
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
      )}
      {step.kind === 'streamdeck' && deckError && (
        <p className="pl-1 text-xs text-red-600 dark:text-red-400">
          {deckError}
        </p>
      )}
    </div>
  )
}

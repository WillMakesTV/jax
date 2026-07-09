import {
  ApplyStreamInfo,
  ApplyStreamInfoForPlan,
  EndStreamSession,
  GetActiveStreamSession,
  GetPlannedStreams,
  GetPlanSessions,
  GetRoutines,
  GetStreamdeckMultiActions,
  PressHotkey,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {pushEpisodeText} from '../lib/smartSources'

/**
 * Routine execution. A routine's normalized steps (authored in Jax, or parsed
 * from a Stream Deck Multi Action by the backend — see streamdeck.go) are
 * replayed over the app's obs-websocket connection. The Stream Deck software
 * has no API to press a button remotely, so "managed with Streamdeck" means
 * Jax re-reads the Multi Action from the Stream Deck's profile files at run
 * time and performs the steps itself; steps Jax cannot perform (third-party
 * plugins like Philips Hue) are skipped and reported.
 */

/** The ServicesProvider's obsRequest shape. */
export type ObsRequest = <T = Record<string, unknown>>(
  type: string,
  data?: Record<string, unknown>,
) => Promise<T>

/** IDs/triggers of the two built-in routines (mirrors routines.go). */
export const START_ROUTINE = 'start-stream'
export const END_ROUTINE = 'end-stream'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A human label for one step, used in lists and previews. */
export function describeStep(step: main.RoutineStep): string {
  switch (step.kind) {
    case 'obs-scene':
      return `Switch scene to “${step.scene}”`
    case 'obs-source':
      return `Toggle source “${step.source}” in “${step.scene}”`
    case 'obs-mute':
      return step.mode === 'mute'
        ? `Mute “${step.source}”`
        : step.mode === 'unmute'
          ? `Unmute “${step.source}”`
          : `Toggle mute on “${step.source}”`
    case 'obs-stream':
      return step.mode === 'start'
        ? 'Start the stream'
        : step.mode === 'stop'
          ? 'Stop the stream'
          : 'Toggle the stream'
    case 'obs-record':
      return step.mode === 'start'
        ? 'Start recording'
        : step.mode === 'stop'
          ? 'Stop recording'
          : 'Toggle recording'
    case 'delay':
      return `Wait ${((step.delayMs ?? 0) / 1000).toLocaleString()}s`
    case 'hotkey':
      return `Press ${step.description || 'a hotkey'}`
    case 'update-smart-sources':
      return 'Update episode info (mapped text sources)'
    case 'apply-stream-info':
      return 'Apply stream info (title, description, tags & category)'
    case 'streamdeck':
      return `Stream Deck: “${step.description || 'Multi Action'}”`
    default:
      return step.description || 'Unsupported step'
  }
}

/**
 * A routine's two phases, ready to run: `before` runs ahead of the built-in
 * routines' stream transition, `after` once the stream has started/stopped.
 * Custom routines have no transition and only use `before`. Warnings collect
 * anything that could not be resolved (e.g. a deleted Multi Action).
 */
export interface RoutinePhases {
  before: main.RoutineStep[]
  after: main.RoutineStep[]
  warnings: string[]
}

/**
 * Resolve the steps a routine will run right now. Stream Deck Multi Action
 * steps are expanded into the Multi Action's own steps, re-read from the
 * deck's profile files on every run so edits made in the Stream Deck app are
 * always picked up; a missing Multi Action skips that step with a warning.
 */
export async function resolveRoutinePhases(
  routine: main.Routine,
): Promise<RoutinePhases> {
  const warnings: string[] = []
  const all = [...(routine.steps ?? []), ...(routine.afterSteps ?? [])]

  let actions: main.StreamdeckMultiAction[] = []
  if (all.some((s) => s.kind === 'streamdeck')) {
    try {
      actions = (await GetStreamdeckMultiActions()) ?? []
    } catch (err) {
      warnings.push(
        err instanceof Error && err.message
          ? err.message
          : 'Could not read the Stream Deck profiles.',
      )
    }
  }

  const expand = (steps: main.RoutineStep[]): main.RoutineStep[] =>
    (steps ?? []).flatMap((s) => {
      if (s.kind !== 'streamdeck') return [s]
      const match = actions.find((a) => a.id === s.streamdeckActionId)
      if (!match) {
        warnings.push(
          `The Stream Deck Multi Action “${
            s.description || 'Multi Action'
          }” was not found — its steps were skipped.`,
        )
        return []
      }
      return match.steps ?? []
    })

  return {
    before: expand(routine.steps ?? []),
    after: expand(routine.afterSteps ?? []),
    warnings,
  }
}

/** Perform one step. Unsupported steps report themselves via the return. */
async function runStep(
  step: main.RoutineStep,
  obsRequest: ObsRequest,
  opts: RunRoutineOptions = {},
): Promise<string | null> {
  switch (step.kind) {
    case 'delay':
      await sleep(step.delayMs ?? 0)
      return null

    case 'hotkey':
      // A Stream Deck Hotkey button: the backend synthesizes the keystroke
      // system-wide, exactly as pressing the deck button would.
      await PressHotkey(
        step.vkey ?? 0,
        Boolean(step.ctrl),
        Boolean(step.shift),
        Boolean(step.alt),
        Boolean(step.win),
      )
      return null

    case 'obs-scene': {
      // The Stream Deck OBS plugin's "preview" target only differs from
      // "program" while studio mode is on; mirror that behaviour.
      let studioMode = false
      if (step.target === 'preview') {
        try {
          const r = await obsRequest<{studioModeEnabled: boolean}>(
            'GetStudioModeEnabled',
          )
          studioMode = Boolean(r.studioModeEnabled)
        } catch {
          studioMode = false
        }
      }
      await obsRequest(
        studioMode ? 'SetCurrentPreviewScene' : 'SetCurrentProgramScene',
        {sceneName: step.scene},
      )
      return null
    }

    case 'obs-source': {
      let itemId = step.sceneItemId ?? 0
      if (!itemId) {
        const r = await obsRequest<{sceneItemId: number}>('GetSceneItemId', {
          sceneName: step.scene,
          sourceName: step.source,
        })
        itemId = r.sceneItemId
      }
      const {sceneItemEnabled} = await obsRequest<{sceneItemEnabled: boolean}>(
        'GetSceneItemEnabled',
        {sceneName: step.scene, sceneItemId: itemId},
      )
      await obsRequest('SetSceneItemEnabled', {
        sceneName: step.scene,
        sceneItemId: itemId,
        sceneItemEnabled: !sceneItemEnabled,
      })
      return null
    }

    case 'obs-mute':
      if (step.mode === 'mute' || step.mode === 'unmute') {
        await obsRequest('SetInputMute', {
          inputName: step.source,
          inputMuted: step.mode === 'mute',
        })
      } else {
        await obsRequest('ToggleInputMute', {inputName: step.source})
      }
      return null

    case 'obs-stream':
      await obsRequest(
        step.mode === 'start'
          ? 'StartStream'
          : step.mode === 'stop'
            ? 'StopStream'
            : 'ToggleStream',
      )
      return null

    case 'obs-record':
      await obsRequest(
        step.mode === 'start'
          ? 'StartRecord'
          : step.mode === 'stop'
            ? 'StopRecord'
            : 'ToggleRecord',
      )
      return null

    case 'update-smart-sources':
      return updateEpisodeSmartSources(obsRequest, Boolean(opts.test))

    case 'apply-stream-info': {
      // Push the on-air planned stream's info to its channels: Twitch's
      // channel info, and YouTube's live broadcast (or, off the air, its
      // upcoming default/scheduled broadcast — what YouTube Studio edits
      // offline). The backend no-ops when no planned stream is on the air —
      // except in a test, which pushes the ready-to-go-live plan's info for
      // real; both platforms simply apply it to the next stream.
      if (opts.test) {
        const session = await GetActiveStreamSession()
        if (!session.active || !session.planId) {
          const plan = await nextPlannedStream()
          if (!plan) {
            return 'Test: no planned stream is ready to go live, so no stream info was applied.'
          }
          const warnings = (await ApplyStreamInfoForPlan(plan.id)) ?? []
          return [
            `Test: applied “${plan.title}” stream info to its channels.`,
            ...warnings,
          ].join(' · ')
        }
      }
      const warnings = (await ApplyStreamInfo()) ?? []
      return warnings.length > 0 ? warnings.join(' · ') : null
    }

    default:
      return `Skipped (Stream Deck only): ${step.description || step.kind}`
  }
}

/**
 * The "Update episode info" step: write the on-air planned stream's episode
 * title and "Episode N" directly into the OBS text sources mapped on the
 * series' edit page — plain text, no tokens or templates involved.
 *
 * Going live with a plan opens its stream session before the Start routine
 * runs, so the step sees the new episode. When no planned stream is on the
 * air the step is a silent no-op — except in a test, which rehearses with the
 * planned stream that is ready to go live, exactly what the real go-live
 * would show.
 */
async function updateEpisodeSmartSources(
  obsRequest: ObsRequest,
  test: boolean,
): Promise<string | null> {
  const session = await GetActiveStreamSession()
  if (session.active) {
    if (!session.title && session.episode <= 0) return null
    await pushEpisodeText(obsRequest, session.title, session.episode)
    return null
  }
  if (!test) return null

  const plan = await nextPlannedStream()
  if (!plan) {
    return 'Test: no planned stream is ready to go live, so the episode text sources were left as-is.'
  }
  if (!plan.title && plan.episodeNumber <= 0) return null
  const wrote = await pushEpisodeText(obsRequest, plan.title, plan.episodeNumber)
  if (!wrote) {
    return 'Test: no episode text sources are mapped — choose them on the series’ edit page.'
  }
  return `Test: episode sources show “${plan.title}”${
    plan.episodeNumber > 0 ? ` (Episode ${plan.episodeNumber})` : ''
  } from the upcoming plan.`
}

/**
 * The planned stream a test should rehearse with: the newest plan that has
 * not been broadcast yet — the same card "Go Live with Planned Stream" puts
 * on top with its Go Live button ready.
 */
async function nextPlannedStream(): Promise<main.PlannedStream | null> {
  try {
    const [plans, sessions] = await Promise.all([
      GetPlannedStreams(),
      GetPlanSessions(),
    ])
    const broadcast = new Set((sessions ?? []).map((s) => s.planId))
    return (plans ?? []).find((p) => !broadcast.has(p.id)) ?? null
  } catch {
    return null
  }
}

/**
 * Run a list of steps in order. A failing step does not abort the routine;
 * every problem is collected and returned as human-readable warnings.
 */
export async function runSteps(
  steps: main.RoutineStep[],
  obsRequest: ObsRequest,
  opts: RunRoutineOptions = {},
): Promise<string[]> {
  const warnings: string[] = []
  for (const step of steps) {
    try {
      const skipped = await runStep(step, obsRequest, opts)
      if (skipped) warnings.push(skipped)
    } catch (err) {
      warnings.push(
        `${describeStep(step)} failed${
          err instanceof Error && err.message ? `: ${err.message}` : ''
        }`,
      )
    }
  }
  return warnings
}

export interface RunRoutineOptions {
  /**
   * Test mode: rehearse the routine without touching the broadcast. Every
   * step runs as usual except stream start/stop/toggle steps (and the
   * built-ins' implied stream transition), which are skipped and reported,
   * and the End routine leaves the stream session open.
   */
  test?: boolean
}

/**
 * Run one routine: its before-steps, then — for the built-in routines — the
 * stream transition, then its after-steps. A broken or missing phase only
 * produces warnings; the built-ins' stream transition itself is guaranteed
 * (unless testing, which never starts or stops the stream).
 */
export async function runRoutine(
  routine: main.Routine,
  obsRequest: ObsRequest,
  opts: RunRoutineOptions = {},
): Promise<string[]> {
  const warnings: string[] = []
  let phases: RoutinePhases = {before: [], after: [], warnings: []}
  try {
    phases = await resolveRoutinePhases(routine)
    warnings.push(...phases.warnings)
  } catch (err) {
    warnings.push(
      err instanceof Error && err.message
        ? err.message
        : 'The routine could not be loaded.',
    )
  }
  if (opts.test) {
    const holdStream = (steps: main.RoutineStep[]) =>
      steps.filter((s) => {
        if (s.kind !== 'obs-stream') return true
        warnings.push(`Test: skipped “${describeStep(s)}”.`)
        return false
      })
    phases = {
      ...phases,
      before: holdStream(phases.before),
      after: holdStream(phases.after),
    }
  }
  warnings.push(...(await runSteps(phases.before, obsRequest, opts)))
  if (opts.test) {
    if (routine.trigger === START_ROUTINE) {
      warnings.push('Test: the stream was not started.')
    } else if (routine.trigger === END_ROUTINE) {
      warnings.push('Test: the stream was not stopped.')
    }
  } else {
    warnings.push(
      ...(await impliedStreamTransition(routine.trigger, phases.before, obsRequest)),
    )
  }
  warnings.push(...(await runSteps(phases.after, obsRequest, opts)))
  // Ending the broadcast closes the open stream session (the record a
  // planned stream's chat and transcript are attached to). A test is not an
  // ending: whatever is on the air stays attached to its session.
  if (routine.trigger === END_ROUTINE && !opts.test) {
    await EndStreamSession().catch(() => {})
  }
  return warnings
}

/**
 * Run the built-in routine behind the app's Go live / Stop stream buttons.
 */
export async function runStreamRoutine(
  trigger: typeof START_ROUTINE | typeof END_ROUTINE,
  obsRequest: ObsRequest,
): Promise<string[]> {
  let routine: main.Routine | undefined
  try {
    routine = ((await GetRoutines()) ?? []).find((r) => r.trigger === trigger)
  } catch {
    // Fall through: the stream transition must happen regardless.
  }
  if (!routine) return impliedStreamTransition(trigger, [], obsRequest)
  return runRoutine(routine, obsRequest)
}

/** Start/stop the stream for a built-in routine when no step already has. */
async function impliedStreamTransition(
  trigger: string,
  steps: main.RoutineStep[],
  obsRequest: ObsRequest,
): Promise<string[]> {
  if (trigger !== START_ROUTINE && trigger !== END_ROUTINE) return []
  if (steps.some((s) => s.kind === 'obs-stream')) return []
  try {
    await obsRequest(trigger === START_ROUTINE ? 'StartStream' : 'StopStream')
  } catch (err) {
    // Already in the requested state (e.g. a Run of "Start Stream" while
    // live) is not worth surfacing; anything else is.
    const message = err instanceof Error ? err.message : ''
    if (!/already/i.test(message)) {
      return [
        trigger === START_ROUTINE
          ? `Could not start the stream${message ? `: ${message}` : ''}`
          : `Could not stop the stream${message ? `: ${message}` : ''}`,
      ]
    }
  }
  return []
}

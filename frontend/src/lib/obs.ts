// Minimal obs-websocket v5 client: performs the connection handshake and
// returns the live socket. See the protocol spec:
// https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

export interface ObsConfig {
  host: string
  port: number
  password: string
}

const OP_HELLO = 0
const OP_IDENTIFY = 1
const OP_IDENTIFIED = 2
const OP_REIDENTIFY = 3
const OP_EVENT = 5
const OP_REQUEST = 6
const OP_REQUEST_RESPONSE = 7

// Event-subscription bits (protocol EventSubscription enum).
const EVENTS_SCENES = 1 << 2
const EVENTS_INPUTS = 1 << 3
const EVENTS_SCENE_ITEMS = 1 << 7
const EVENTS_INPUT_VOLUME_METERS = 1 << 16

/**
 * Always-on subscriptions: input mute changes, scene switches, and scene-item
 * (source) changes. All are low-volume, so they stay subscribed continuously
 * to drive near-real-time UI (mixer, scene switcher, source visibility).
 */
export const OBS_EVENTS_BASE =
  EVENTS_INPUTS | EVENTS_SCENES | EVENTS_SCENE_ITEMS
/** Base plus the high-volume per-input volume meters (~20 events/s). */
export const OBS_EVENTS_WITH_METERS =
  OBS_EVENTS_BASE | EVENTS_INPUT_VOLUME_METERS

/**
 * Change the identified socket's event subscriptions (Reidentify). Used to
 * switch the high-volume volume-meter stream on only while a meter UI is
 * actually on screen.
 */
export function setObsEventSubscriptions(
  ws: WebSocket,
  eventSubscriptions: number,
): void {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({op: OP_REIDENTIFY, d: {eventSubscriptions}}))
}

/**
 * Listen for one OBS event type on an identified socket. Returns the
 * unsubscribe function. Uses addEventListener, so it coexists with pending
 * requests and other listeners.
 */
export function onObsEvent<T = Record<string, unknown>>(
  ws: WebSocket,
  eventType: string,
  handler: (data: T) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    let message: {op: number; d: any}
    try {
      message = JSON.parse(event.data as string)
    } catch {
      return
    }
    if (message.op === OP_EVENT && message.d?.eventType === eventType) {
      handler((message.d.eventData ?? {}) as T)
    }
  }
  ws.addEventListener('message', onMessage)
  return () => ws.removeEventListener('message', onMessage)
}

// ---------------------------------------------------------------------------
// Audio input capture devices
// ---------------------------------------------------------------------------

/** One audio input capture device (microphone) in OBS. */
export interface ObsMic {
  name: string
  muted: boolean
  /**
   * Whether the source is live in the current program output
   * (`obs_source_active`). A global audio device is always active; a mic that
   * is only a scene item is active only while its scene is on program. Defaults
   * to true when OBS doesn't report it, so transcription never stops silently.
   */
  active: boolean
}

/** Input kinds that are microphones ("Audio Input Capture") per platform. */
const INPUT_CAPTURE_KINDS = new Set([
  'wasapi_input_capture', // Windows
  'coreaudio_input_capture', // macOS
  'pulse_input_capture', // Linux (PulseAudio)
  'alsa_input_capture', // Linux (ALSA)
])

/** OBS input kind for "Application Audio Capture" (the Music candidates). */
export const APP_AUDIO_KIND = 'wasapi_process_output_capture'

/** A designatable primary-source role, or null when a source is none of them. */
export type SourceRole = 'camera' | 'mic' | 'music'

/** Classify an OBS input kind into a designatable primary-source role. */
export function sourceRole(kind: string): SourceRole | null {
  if (CAMERA_KINDS.has(kind)) return 'camera'
  if (INPUT_CAPTURE_KINDS.has(kind)) return 'mic'
  if (kind === APP_AUDIO_KIND) return 'music'
  return null
}

/**
 * List OBS's audio input capture devices and their mute state. `request` is
 * the ServicesProvider's obsRequest.
 */
export async function fetchObsMics(
  request: <T>(type: string, data?: Record<string, unknown>) => Promise<T>,
): Promise<ObsMic[]> {
  const {inputs} = await request<{
    inputs: {inputName: string; inputKind: string}[]
  }>('GetInputList')
  const mics = (inputs ?? []).filter((i) =>
    INPUT_CAPTURE_KINDS.has(i.inputKind),
  )
  return Promise.all(
    mics.map(async (i) => {
      const [{inputMuted}, active] = await Promise.all([
        request<{inputMuted: boolean}>('GetInputMute', {
          inputName: i.inputName,
        }),
        // videoActive is obs_source_active — despite the name it reports audio
        // sources too: true when the mic is live in the current program scene.
        request<{videoActive: boolean}>('GetSourceActive', {
          sourceName: i.inputName,
        })
          .then((r) => r.videoActive)
          // Fail open: if OBS can't report activity, assume active rather than
          // silently dropping the transcript for the whole stream.
          .catch(() => true),
      ])
      return {name: i.inputName, muted: inputMuted, active}
    }),
  )
}

// ---------------------------------------------------------------------------
// Cameras (video capture devices)
//
// A "primary camera" is designated per scene (see lib/sceneCameras). It is a
// source placed in that scene, so its on/off state is the scene item's
// visibility — toggled per scene, and surfaced for whichever scene is active.
// ---------------------------------------------------------------------------

/** OBS input kinds that are video capture devices (webcams), per platform. */
export const CAMERA_KINDS = new Set([
  'dshow_input', // Windows (Video Capture Device)
  'av_capture_input', // macOS
  'av_capture_input_v2', // macOS (newer)
  'v4l2_input', // Linux
])

/** The primary camera of a scene: a source item and its visibility. */
export interface ObsCamera {
  name: string
  enabled: boolean
  sceneName: string
  sceneItemId: number
}

/**
 * Resolve a scene's designated primary camera to its live visibility state,
 * or null when none is designated or the source is not present in the scene.
 */
export async function fetchObsCamera(
  request: <T>(type: string, data?: Record<string, unknown>) => Promise<T>,
  sceneName: string,
  sourceName: string,
): Promise<ObsCamera | null> {
  if (!sceneName || !sourceName) return null
  try {
    const {sceneItemId} = await request<{sceneItemId: number}>(
      'GetSceneItemId',
      {sceneName, sourceName},
    )
    const {sceneItemEnabled} = await request<{sceneItemEnabled: boolean}>(
      'GetSceneItemEnabled',
      {sceneName, sceneItemId},
    )
    return {name: sourceName, enabled: sceneItemEnabled, sceneName, sceneItemId}
  } catch {
    return null
  }
}

/** Camera-kind sources present in a scene, deduped. */
export async function fetchSceneCameraSources(
  request: <T>(type: string, data?: Record<string, unknown>) => Promise<T>,
  sceneName: string,
): Promise<string[]> {
  if (!sceneName) return []
  const [{inputs}, {sceneItems}] = await Promise.all([
    request<{inputs: {inputName: string; inputKind: string}[]}>('GetInputList'),
    request<{sceneItems: {sourceName: string}[]}>('GetSceneItemList', {
      sceneName,
    }),
  ])
  const cameraInputs = new Set(
    (inputs ?? [])
      .filter((i) => CAMERA_KINDS.has(i.inputKind))
      .map((i) => i.inputName),
  )
  const inScene = (sceneItems ?? [])
    .map((i) => i.sourceName)
    .filter((n) => cameraInputs.has(n))
  return [...new Set(inScene)]
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return new Uint8Array(digest)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** auth = base64(sha256(base64(sha256(password + salt)) + challenge)) */
async function authString(
  password: string,
  salt: string,
  challenge: string,
): Promise<string> {
  const secret = toBase64(await sha256Bytes(password + salt))
  return toBase64(await sha256Bytes(secret + challenge))
}

/**
 * Send a request over an identified OBS socket and resolve with its response
 * data. Correlates by requestId, so concurrent requests are safe, and uses
 * addEventListener so it never clobbers the socket's own handlers.
 */
export function obsRequest<T = Record<string, unknown>>(
  ws: WebSocket,
  requestType: string,
  requestData?: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) {
      reject(new Error('OBS is not connected.'))
      return
    }
    const requestId = crypto.randomUUID()

    const cleanup = () => {
      window.clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
    }
    const onMessage = (event: MessageEvent) => {
      let message: {op: number; d: any}
      try {
        message = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (
        message.op !== OP_REQUEST_RESPONSE ||
        message.d?.requestId !== requestId
      ) {
        return
      }
      cleanup()
      const status = message.d.requestStatus
      if (status?.result) {
        resolve((message.d.responseData ?? {}) as T)
      } else {
        reject(
          new Error(status?.comment || `OBS request failed: ${requestType}`),
        )
      }
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`OBS request timed out: ${requestType}`))
    }, timeoutMs)

    ws.addEventListener('message', onMessage)
    ws.send(
      JSON.stringify({
        op: OP_REQUEST,
        d: {requestType, requestId, requestData},
      }),
    )
  })
}

/**
 * The display name of the device an OBS audio input captures, from the
 * input's own property list ('' when OBS uses the OS default). The
 * transcriber sidecar opens the same device by this name.
 */
export async function obsMicDeviceLabel(
  request: <T>(type: string, data?: Record<string, unknown>) => Promise<T>,
  micName: string,
): Promise<string> {
  const settings = await request<{
    inputSettings: Record<string, unknown>
  }>('GetInputSettings', {inputName: micName})
  const obsDeviceId = String(settings.inputSettings?.device_id ?? 'default')
  if (obsDeviceId === 'default') return ''

  try {
    const props = await request<{
      propertyItems: {itemName: string; itemValue: unknown}[]
    }>('GetInputPropertiesListPropertyItems', {
      inputName: micName,
      propertyName: 'device_id',
    })
    return (
      props.propertyItems?.find((i) => String(i.itemValue) === obsDeviceId)
        ?.itemName ?? ''
    )
  } catch {
    return '' // property introspection unavailable; use the default device
  }
}

/**
 * Connect to an OBS instance and complete the v5 handshake (including auth when
 * the server requires it). Resolves with the open WebSocket once Identified, or
 * rejects with a human-readable error.
 */
export function connectObs(config: ObsConfig): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(`ws://${config.host}:${config.port}`)
    } catch {
      reject(new Error('Invalid OBS host or port.'))
      return
    }

    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      try {
        ws.close()
      } catch {
        // ignore
      }
      reject(new Error(message))
    }

    ws.onerror = () =>
      fail(
        'Could not reach OBS. Make sure OBS is running and its WebSocket server is enabled (Tools → WebSocket Server Settings).',
      )

    ws.onclose = (event) =>
      fail(
        event.reason ||
          'OBS closed the connection. Check the host, port, and password.',
      )

    ws.onmessage = async (event) => {
      let message: {op: number; d: any}
      try {
        message = JSON.parse(event.data as string)
      } catch {
        return
      }

      if (message.op === OP_HELLO) {
        const hello = message.d
        const identify: Record<string, unknown> = {
          rpcVersion: hello.rpcVersion ?? 1,
          eventSubscriptions: OBS_EVENTS_BASE,
        }
        if (hello.authentication) {
          if (!config.password) {
            fail('This OBS instance requires a password.')
            return
          }
          try {
            identify.authentication = await authString(
              config.password,
              hello.authentication.salt,
              hello.authentication.challenge,
            )
          } catch {
            fail('Failed to compute the authentication response.')
            return
          }
        }
        ws.send(JSON.stringify({op: OP_IDENTIFY, d: identify}))
      } else if (message.op === OP_IDENTIFIED) {
        settled = true
        // Hand the live socket back to the caller, clearing handshake handlers.
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        resolve(ws)
      }
    }
  })
}

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
          eventSubscriptions: 0,
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

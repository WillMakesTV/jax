import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  DisconnectService,
  GetServiceConfig,
  GetServiceStatuses,
  SaveServiceConfig,
} from '../../wailsjs/go/main/App'
import {
  connectObs,
  obsRequest as sendObsRequest,
  onObsEvent as attachObsEvent,
  setObsEventSubscriptions,
  OBS_EVENTS_BASE,
  OBS_EVENTS_WITH_METERS,
  type ObsConfig,
} from '../lib/obs'
import type {ServiceId} from './services'

export interface ServiceStatus {
  connected: boolean
  account: string
}

/**
 * Connection config persisted (in the SQLite-backed store) so the modals
 * prefill and OBS can reconnect on launch. Client IDs are not secrets; the
 * Google client secret and OBS password are stored for usability — acceptable
 * for a local single-user app, but a future version should move secrets to the
 * OS keychain.
 */
export interface ServiceConfigs {
  twitchClientId: string
  youtubeClientId: string
  youtubeClientSecret: string
  kickClientId: string
  kickClientSecret: string
  facebookAppId: string
  facebookClientToken: string
  xClientId: string
  xClientSecret: string
  tiktokClientKey: string
  tiktokClientSecret: string
  obsHost: string
  obsPort: string
  obsPassword: string
  /** Reconnect to OBS automatically on launch (set while connected). */
  obsAutoConnect: boolean
}

const DEFAULT_CONFIGS: ServiceConfigs = {
  twitchClientId: '',
  youtubeClientId: '',
  youtubeClientSecret: '',
  kickClientId: '',
  kickClientSecret: '',
  facebookAppId: '',
  facebookClientToken: '',
  xClientId: '',
  xClientSecret: '',
  tiktokClientKey: '',
  tiktokClientSecret: '',
  obsHost: 'localhost',
  obsPort: '4455',
  obsPassword: '',
  obsAutoConnect: false,
}

const EMPTY_STATUS: ServiceStatus = {connected: false, account: ''}

/** How often to probe for OBS while it is unreachable. */
const OBS_RETRY_MS = 10_000

const emptyStatuses = (): Record<ServiceId, ServiceStatus> => ({
  twitch: {...EMPTY_STATUS},
  youtube: {...EMPTY_STATUS},
  kick: {...EMPTY_STATUS},
  facebook: {...EMPTY_STATUS},
  instagram: {...EMPTY_STATUS},
  x: {...EMPTY_STATUS},
  tiktok: {...EMPTY_STATUS},
  obs: {...EMPTY_STATUS},
  anthropic: {...EMPTY_STATUS},
  openai: {...EMPTY_STATUS},
})

interface ServicesContextValue {
  statuses: Record<ServiceId, ServiceStatus>
  configs: ServiceConfigs
  updateConfigs: (partial: Partial<ServiceConfigs>) => void
  setStatus: (id: ServiceId, status: ServiceStatus) => void
  connectObsService: (config: ObsConfig) => Promise<void>
  disconnect: (id: ServiceId) => Promise<void>
  /**
   * Send a request to the connected OBS instance (obs-websocket v5 request
   * types, e.g. "GetStats"). Rejects when OBS is not connected.
   */
  obsRequest: <T = Record<string, unknown>>(
    type: string,
    data?: Record<string, unknown>,
  ) => Promise<T>
  /**
   * Listen for one OBS event type on the current connection. Returns the
   * unsubscribe function (a no-op when OBS is not connected). Re-subscribe
   * when the OBS connection status changes.
   */
  onObsEvent: <T = Record<string, unknown>>(
    eventType: string,
    handler: (data: T) => void,
  ) => () => void
  /**
   * Toggle the high-volume InputVolumeMeters event stream. Enable it only
   * while a meter UI is on screen; it fires ~20 events per second.
   */
  setObsMeterEvents: (enabled: boolean) => void
}

const ServicesContext = createContext<ServicesContextValue | undefined>(
  undefined,
)

export function ServicesProvider({children}: {children: ReactNode}) {
  const [statuses, setStatuses] = useState<Record<ServiceId, ServiceStatus>>(
    emptyStatuses,
  )
  const [configs, setConfigs] = useState<ServiceConfigs>(DEFAULT_CONFIGS)
  const obsSocket = useRef<WebSocket | null>(null)

  const setStatus = useCallback((id: ServiceId, status: ServiceStatus) => {
    setStatuses((prev) => ({...prev, [id]: status}))
  }, [])

  const updateConfigs = useCallback((partial: Partial<ServiceConfigs>) => {
    setConfigs((prev) => {
      const next = {...prev, ...partial}
      SaveServiceConfig(next).catch(() => {
        // Ignore persistence failures; the session value still applies.
      })
      return next
    })
  }, [])

  // Load persisted connection config from the SQLite-backed store on mount.
  useEffect(() => {
    let cancelled = false
    GetServiceConfig()
      .then((stored) => {
        if (cancelled || !stored) return
        setConfigs({...DEFAULT_CONFIGS, ...stored})
      })
      .catch(() => {
        // Backend unavailable (e.g. plain Vite dev); keep the defaults.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Hydrate OAuth-backed service statuses from the Go backend on mount.
  useEffect(() => {
    GetServiceStatuses()
      .then((result) => {
        setStatuses((prev) => {
          const next = {...prev}
          for (const s of result) {
            if (
              s.name === 'twitch' ||
              s.name === 'youtube' ||
              s.name === 'kick' ||
              s.name === 'facebook' ||
              s.name === 'instagram' ||
              s.name === 'x' ||
              s.name === 'tiktok' ||
              s.name === 'anthropic' ||
              s.name === 'openai'
            ) {
              next[s.name] = {connected: s.connected, account: s.account}
            }
          }
          return next
        })
      })
      .catch(() => {
        // Backend unavailable (e.g. plain Vite dev); leave defaults.
      })
  }, [])

  const connectObsService = useCallback(
    async (config: ObsConfig) => {
      const socket = await connectObs(config)
      obsSocket.current = socket
      setStatus('obs', {
        connected: true,
        account: `${config.host}:${config.port}`,
      })
      // Remember to re-establish this connection on the next launch.
      updateConfigs({obsAutoConnect: true})
      // Reflect unexpected drops in the UI.
      socket.onclose = () => {
        if (obsSocket.current === socket) {
          obsSocket.current = null
          setStatus('obs', {...EMPTY_STATUS})
        }
      }
    },
    [setStatus, updateConfigs],
  )

  // Establish the OBS connection on launch and keep watching: while OBS is
  // unreachable (not running yet), probe again every OBS_RETRY_MS until it
  // becomes available. The same loop resumes when a connection drops mid-
  // session. A manual disconnect clears obsAutoConnect and opts out.
  const obsConnecting = useRef(false)
  useEffect(() => {
    if (!configs.obsAutoConnect || statuses.obs.connected) return
    let cancelled = false

    const tryConnect = () => {
      if (cancelled || obsConnecting.current) return
      obsConnecting.current = true
      connectObsService({
        host: configs.obsHost.trim() || 'localhost',
        port: Number(configs.obsPort) || 4455,
        password: configs.obsPassword,
      })
        .catch(() => {
          // OBS unreachable; the next tick probes again.
        })
        .finally(() => {
          obsConnecting.current = false
        })
    }

    tryConnect()
    const id = window.setInterval(tryConnect, OBS_RETRY_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [
    configs.obsAutoConnect,
    configs.obsHost,
    configs.obsPort,
    configs.obsPassword,
    statuses.obs.connected,
    connectObsService,
  ])

  const obsRequest = useCallback(
    async <T,>(type: string, data?: Record<string, unknown>): Promise<T> => {
      const socket = obsSocket.current
      if (!socket) throw new Error('OBS is not connected.')
      return sendObsRequest<T>(socket, type, data)
    },
    [],
  )

  const onObsEvent = useCallback(
    <T,>(eventType: string, handler: (data: T) => void): (() => void) => {
      const socket = obsSocket.current
      if (!socket) return () => {}
      return attachObsEvent<T>(socket, eventType, handler)
    },
    [],
  )

  const setObsMeterEvents = useCallback((enabled: boolean) => {
    const socket = obsSocket.current
    if (!socket) return
    setObsEventSubscriptions(
      socket,
      enabled ? OBS_EVENTS_WITH_METERS : OBS_EVENTS_BASE,
    )
  }, [])

  const disconnect = useCallback(
    async (id: ServiceId) => {
      if (id === 'obs') {
        const socket = obsSocket.current
        obsSocket.current = null
        if (socket) {
          socket.onclose = null
          try {
            socket.close()
          } catch {
            // ignore
          }
        }
        setStatus('obs', {...EMPTY_STATUS})
        // A manual disconnect also opts out of reconnecting on launch.
        updateConfigs({obsAutoConnect: false})
        return
      }
      try {
        await DisconnectService(id)
      } catch {
        // ignore backend errors on disconnect
      }
      setStatus(id, {...EMPTY_STATUS})
    },
    [setStatus, updateConfigs],
  )

  const value = useMemo<ServicesContextValue>(
    () => ({
      statuses,
      configs,
      updateConfigs,
      setStatus,
      connectObsService,
      disconnect,
      obsRequest,
      onObsEvent,
      setObsMeterEvents,
    }),
    [
      statuses,
      configs,
      updateConfigs,
      setStatus,
      connectObsService,
      disconnect,
      obsRequest,
      onObsEvent,
      setObsMeterEvents,
    ],
  )

  return (
    <ServicesContext.Provider value={value}>
      {children}
    </ServicesContext.Provider>
  )
}

export function useServices(): ServicesContextValue {
  const context = useContext(ServicesContext)
  if (!context) {
    throw new Error('useServices must be used within a ServicesProvider')
  }
  return context
}

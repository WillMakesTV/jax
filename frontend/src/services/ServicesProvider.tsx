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
  obsHost: 'localhost',
  obsPort: '4455',
  obsPassword: '',
  obsAutoConnect: false,
}

const EMPTY_STATUS: ServiceStatus = {connected: false, account: ''}

const emptyStatuses = (): Record<ServiceId, ServiceStatus> => ({
  twitch: {...EMPTY_STATUS},
  youtube: {...EMPTY_STATUS},
  obs: {...EMPTY_STATUS},
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
            if (s.name === 'twitch' || s.name === 'youtube') {
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

  // Re-establish the OBS connection on launch when one was active last session.
  // One attempt only; failures are silent (OBS may simply not be running).
  const obsAutoTried = useRef(false)
  useEffect(() => {
    if (
      obsAutoTried.current ||
      !configs.obsAutoConnect ||
      statuses.obs.connected
    ) {
      return
    }
    obsAutoTried.current = true
    connectObsService({
      host: configs.obsHost.trim() || 'localhost',
      port: Number(configs.obsPort) || 4455,
      password: configs.obsPassword,
    }).catch(() => {
      // OBS unreachable; the user can connect manually from Settings.
    })
  }, [configs, statuses.obs.connected, connectObsService])

  const obsRequest = useCallback(
    async <T,>(type: string, data?: Record<string, unknown>): Promise<T> => {
      const socket = obsSocket.current
      if (!socket) throw new Error('OBS is not connected.')
      return sendObsRequest<T>(socket, type, data)
    },
    [],
  )

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
    }),
    [
      statuses,
      configs,
      updateConfigs,
      setStatus,
      connectObsService,
      disconnect,
      obsRequest,
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

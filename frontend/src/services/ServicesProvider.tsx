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
  GetServiceStatuses,
} from '../../wailsjs/go/main/App'
import {connectObs, type ObsConfig} from '../lib/obs'
import type {ServiceId} from './services'

export interface ServiceStatus {
  connected: boolean
  account: string
}

/**
 * Connection config persisted for convenience so the modals prefill. Client IDs
 * are not secrets; the Google client secret and OBS password are stored here
 * for usability — acceptable for a local single-user app, but a future version
 * should move secrets to the OS keychain.
 */
export interface ServiceConfigs {
  twitchClientId: string
  youtubeClientId: string
  youtubeClientSecret: string
  obsHost: string
  obsPort: string
  obsPassword: string
}

const DEFAULT_CONFIGS: ServiceConfigs = {
  twitchClientId: '',
  youtubeClientId: '',
  youtubeClientSecret: '',
  obsHost: 'localhost',
  obsPort: '4455',
  obsPassword: '',
}

const EMPTY_STATUS: ServiceStatus = {connected: false, account: ''}
const CONFIG_KEY = 'jax:services-config'

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
}

const ServicesContext = createContext<ServicesContextValue | undefined>(
  undefined,
)

const readConfigs = (): ServiceConfigs => {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return {...DEFAULT_CONFIGS, ...JSON.parse(raw)}
  } catch {
    // ignore
  }
  return {...DEFAULT_CONFIGS}
}

export function ServicesProvider({children}: {children: ReactNode}) {
  const [statuses, setStatuses] = useState<Record<ServiceId, ServiceStatus>>(
    emptyStatuses,
  )
  const [configs, setConfigs] = useState<ServiceConfigs>(readConfigs)
  const obsSocket = useRef<WebSocket | null>(null)

  const setStatus = useCallback((id: ServiceId, status: ServiceStatus) => {
    setStatuses((prev) => ({...prev, [id]: status}))
  }, [])

  const updateConfigs = useCallback((partial: Partial<ServiceConfigs>) => {
    setConfigs((prev) => {
      const next = {...prev, ...partial}
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
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
      // Reflect unexpected drops in the UI.
      socket.onclose = () => {
        if (obsSocket.current === socket) {
          obsSocket.current = null
          setStatus('obs', {...EMPTY_STATUS})
        }
      }
    },
    [setStatus],
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
        return
      }
      try {
        await DisconnectService(id)
      } catch {
        // ignore backend errors on disconnect
      }
      setStatus(id, {...EMPTY_STATUS})
    },
    [setStatus],
  )

  const value = useMemo<ServicesContextValue>(
    () => ({
      statuses,
      configs,
      updateConfigs,
      setStatus,
      connectObsService,
      disconnect,
    }),
    [statuses, configs, updateConfigs, setStatus, connectObsService, disconnect],
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

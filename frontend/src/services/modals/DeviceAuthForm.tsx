import {ExternalLink} from 'lucide-react'
import {useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react'
import type {main} from '../../../wailsjs/go/models'
import {useServices} from '../ServicesProvider'
import type {ServiceDef} from '../services'
import {ConnectedPanel, Field, PrimaryButton, fieldInputClass} from './shared'

interface DeviceAuthFormProps {
  service: ServiceDef
  requiresSecret: boolean
  /** Hint shown under the Client ID field (e.g. where to register the app). */
  clientIdHint: ReactNode
  start: (
    clientId: string,
    clientSecret: string,
  ) => Promise<main.DeviceCodeInfo>
  poll: (
    deviceCode: string,
    clientId: string,
    clientSecret: string,
  ) => Promise<main.AuthPollResult>
}

export function DeviceAuthForm({
  service,
  requiresSecret,
  clientIdHint,
  start,
  poll,
}: DeviceAuthFormProps) {
  const {statuses, configs, updateConfigs, setStatus, disconnect} =
    useServices()
  const status = statuses[service.id]
  const isYouTube = service.id === 'youtube'

  const [clientId, setClientId] = useState(
    isYouTube ? configs.youtubeClientId : configs.twitchClientId,
  )
  const [clientSecret, setClientSecret] = useState(configs.youtubeClientSecret)
  const [phase, setPhase] = useState<'config' | 'awaiting'>('config')
  const [info, setInfo] = useState<main.DeviceCodeInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const poller = useRef<{cancelled: boolean; timer: number | undefined}>({
    cancelled: false,
    timer: undefined,
  })

  // Stop polling if the modal/form unmounts.
  useEffect(() => {
    const ref = poller.current
    return () => {
      ref.cancelled = true
      if (ref.timer) window.clearTimeout(ref.timer)
    }
  }, [])

  if (status.connected) {
    return (
      <ConnectedPanel
        label="Connected as"
        account={status.account}
        onDisconnect={() => disconnect(service.id)}
      />
    )
  }

  const saveConfig = () => {
    if (isYouTube) {
      updateConfigs({
        youtubeClientId: clientId,
        youtubeClientSecret: clientSecret,
      })
    } else {
      updateConfigs({twitchClientId: clientId})
    }
  }

  const schedulePoll = (
    deviceCode: string,
    intervalSec: number,
    deadline: number,
  ) => {
    poller.current.timer = window.setTimeout(async () => {
      if (poller.current.cancelled) return
      if (Date.now() > deadline) {
        setError('The code expired before authorization. Please try again.')
        setPhase('config')
        return
      }
      try {
        const result = await poll(
          deviceCode,
          clientId.trim(),
          clientSecret.trim(),
        )
        if (poller.current.cancelled) return
        if (result.status === 'complete') {
          setStatus(service.id, {connected: true, account: result.account})
        } else if (result.status === 'error') {
          setError(result.message || 'Authorization failed.')
          setPhase('config')
        } else {
          const next =
            result.message === 'slow_down' ? intervalSec + 5 : intervalSec
          schedulePoll(deviceCode, next, deadline)
        }
      } catch (err) {
        if (poller.current.cancelled) return
        setError(err instanceof Error ? err.message : 'Authorization failed.')
        setPhase('config')
      }
    }, intervalSec * 1000)
  }

  const onConnect = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    saveConfig()
    try {
      const deviceInfo = await start(clientId.trim(), clientSecret.trim())
      setInfo(deviceInfo)
      setPhase('awaiting')
      poller.current.cancelled = false
      const interval = deviceInfo.interval > 0 ? deviceInfo.interval : 5
      const ttl = deviceInfo.expiresIn > 0 ? deviceInfo.expiresIn : 900
      schedulePoll(deviceInfo.deviceCode, interval, Date.now() + ttl * 1000)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not start authorization.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'awaiting' && info) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          A browser window has opened to authorize {service.name}. If prompted,
          enter this code:
        </p>
        <div className="rounded-lg border border-edge bg-bg px-4 py-3 text-center">
          <span className="select-all font-mono text-2xl font-bold tracking-[0.3em] text-fg">
            {info.userCode}
          </span>
        </div>
        <a
          href={info.verificationUri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-accent underline"
        >
          <ExternalLink size={14} aria-hidden />
          Open the authorization page
        </a>
        <p className="text-sm text-fg-muted">
          Waiting for you to approve access…
        </p>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    )
  }

  const connectDisabled =
    busy || !clientId.trim() || (requiresSecret && !clientSecret.trim())

  return (
    <form onSubmit={onConnect} className="space-y-4">
      <p className="text-sm text-fg-muted">
        {service.description} You'll approve access in your browser.
      </p>

      <Field label="Client ID" htmlFor={`${service.id}-client-id`} hint={clientIdHint}>
        <input
          id={`${service.id}-client-id`}
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Your app's Client ID"
          className={fieldInputClass}
          autoComplete="off"
        />
      </Field>

      {requiresSecret && (
        <Field label="Client Secret" htmlFor={`${service.id}-client-secret`}>
          <input
            id={`${service.id}-client-secret`}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Your app's Client Secret"
            className={fieldInputClass}
            autoComplete="off"
          />
        </Field>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <PrimaryButton type="submit" disabled={connectDisabled}>
        {busy ? 'Starting…' : 'Connect'}
      </PrimaryButton>
    </form>
  )
}

import {useState, type FormEvent} from 'react'
import {useServices} from '../ServicesProvider'
import {ConnectedPanel, Field, PrimaryButton, fieldInputClass} from './shared'

export function ObsConnectForm({onClose}: {onClose: () => void}) {
  const {statuses, configs, updateConfigs, connectObsService, disconnect} =
    useServices()
  const status = statuses.obs

  const [host, setHost] = useState(configs.obsHost)
  const [port, setPort] = useState(configs.obsPort)
  const [password, setPassword] = useState(configs.obsPassword)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (status.connected) {
    return (
      <ConnectedPanel
        label="Connected to OBS at"
        account={status.account}
        onDisconnect={() => disconnect('obs')}
      />
    )
  }

  const onConnect = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    updateConfigs({obsHost: host, obsPort: port, obsPassword: password})
    try {
      await connectObsService({
        host: host.trim() || 'localhost',
        port: Number(port) || 4455,
        password,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to OBS.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onConnect} className="space-y-4">
      <p className="text-sm text-fg-muted">
        Enable OBS's WebSocket server under{' '}
        <span className="text-fg">Tools → WebSocket Server Settings</span>, then
        enter its address and password.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Host" htmlFor="obs-host">
            <input
              id="obs-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="localhost"
              className={fieldInputClass}
              autoComplete="off"
            />
          </Field>
        </div>
        <Field label="Port" htmlFor="obs-port">
          <input
            id="obs-port"
            type="text"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="4455"
            className={fieldInputClass}
            autoComplete="off"
          />
        </Field>
      </div>

      <Field
        label="Password"
        htmlFor="obs-password"
        hint="Leave blank if authentication is disabled in OBS."
      >
        <input
          id="obs-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="WebSocket password"
          className={fieldInputClass}
          autoComplete="off"
        />
      </Field>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <PrimaryButton type="submit" disabled={busy}>
        {busy ? 'Connecting…' : 'Connect'}
      </PrimaryButton>
    </form>
  )
}

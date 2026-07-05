import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'

/**
 * Inline stream controls: start/stop the OBS broadcast with a confirm step.
 * Rendered beneath the program preview, so it stays compact and horizontal.
 */
export function StreamControls() {
  const {statuses, obsRequest} = useServices()
  const {obs} = useLiveData()

  const connected = statuses.obs.connected
  const streaming = Boolean(obs?.outputActive)

  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Drop a pending confirmation when the stream state changes underneath it
  // (e.g. the stream was started/stopped from OBS itself).
  useEffect(() => {
    setConfirming(false)
  }, [streaming])

  const toggleStream = async () => {
    setBusy(true)
    setError('')
    try {
      await obsRequest(streaming ? 'StopStream' : 'StartStream')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The OBS request failed.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!connected) {
    return (
      <p className="text-xs text-fg-muted">
        Connect OBS in Settings → Services to control the stream.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs text-fg-muted">
            {streaming ? 'End the broadcast?' : 'Go live now?'}
          </span>
          <button
            type="button"
            onClick={() => void toggleStream()}
            disabled={busy}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50',
              streaming ? 'bg-red-600 text-white' : 'bg-accent text-accent-fg',
            )}
          >
            {busy ? 'Working…' : streaming ? 'Confirm stop' : 'Confirm go live'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
            streaming
              ? 'border border-red-600/50 text-red-600 hover:bg-red-600/10 dark:text-red-400'
              : 'bg-accent text-accent-fg transition-opacity hover:opacity-90',
          )}
        >
          {streaming ? 'Stop streaming' : 'Start streaming'}
        </button>
      )}
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}

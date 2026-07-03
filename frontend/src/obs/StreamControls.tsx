import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'

/**
 * Stream controls: start/stop the OBS broadcast with a confirm step. Lives in
 * the OBS tab's Controls tab; the status pill in the card header reflects the
 * outcome when the next stats poll lands.
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-sm text-fg-muted">
        {connected
          ? streaming
            ? 'You are live. Stopping ends the broadcast on every connected channel fed by OBS.'
            : 'Start the broadcast right from the dashboard when you are ready to go live.'
          : 'Connect OBS in Settings → Services to control the stream.'}
      </p>

      {connected && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => void toggleStream()}
                disabled={busy}
                className={clsx(
                  'rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50',
                  streaming ? 'bg-red-600 text-white' : 'bg-accent text-accent-fg',
                )}
              >
                {busy ? 'Working…' : streaming ? 'Confirm stop' : 'Confirm go live'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-lg border border-edge bg-bg px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={clsx(
                'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                streaming
                  ? 'border border-red-600/50 text-red-600 hover:bg-red-600/10 dark:text-red-400'
                  : 'bg-accent text-accent-fg transition-opacity hover:opacity-90',
              )}
            >
              {streaming ? 'Stop streaming' : 'Start streaming'}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

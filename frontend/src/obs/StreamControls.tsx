import {useEffect, useState} from 'react'
import {useLiveData} from '../live/LiveDataProvider'
import {END_ROUTINE, runStreamRoutine} from './routines'
import {useServices} from '../services/ServicesProvider'

/**
 * Inline stop control beneath the program preview: end a running OBS broadcast
 * (running the built-in End Stream routine's steps first) with a confirm step.
 * Going live is done from the top-bar Go Live button, so this only appears
 * while the stream is on the air — there is no start button here.
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
  // (e.g. the stream was stopped from OBS itself).
  useEffect(() => {
    setConfirming(false)
  }, [streaming])

  const stopStream = async () => {
    setBusy(true)
    setError('')
    try {
      const warnings = await runStreamRoutine(END_ROUTINE, obsRequest)
      setError(warnings.join(' · '))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The OBS request failed.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  // Only a stop control, and only while live — starting the stream is done
  // from the top-bar Go Live button.
  if (!connected || !streaming) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-xs text-fg-muted">End the broadcast?</span>
          <button
            type="button"
            onClick={() => void stopStream()}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Confirm stop'}
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
          className="rounded-lg border border-red-600/50 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
        >
          Stop streaming
        </button>
      )}
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}

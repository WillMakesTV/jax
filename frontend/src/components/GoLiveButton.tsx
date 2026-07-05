import {Radio, Square} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'

/**
 * Top-bar Go Live / Stop Stream CTA. Starts or stops the OBS broadcast with a
 * confirm step. Enabled once OBS and at least one channel are connected;
 * hidden entirely when OBS is not connected.
 */
export function GoLiveButton() {
  const {statuses, obsRequest} = useServices()
  const {obs} = useLiveData()

  const obsConnected = statuses.obs.connected
  const channelConnected =
    statuses.twitch.connected || statuses.youtube.connected
  const streaming = Boolean(obs?.outputActive)
  const reconnecting = Boolean(obs?.outputReconnecting)

  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  // Drop a pending confirmation when the stream state flips underneath it.
  useEffect(() => setConfirming(false), [streaming])

  if (!obsConnected) return null

  const toggle = async () => {
    setBusy(true)
    try {
      await obsRequest(streaming ? 'StopStream' : 'StartStream')
    } catch {
      // The button state reflects the real status on the next poll.
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  // Ready to go live once a channel is connected (stopping is always allowed).
  const canAct = streaming || channelConnected

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50',
            streaming ? 'bg-red-600 text-white' : 'bg-accent text-accent-fg',
          )}
        >
          {busy ? 'Working…' : streaming ? 'Confirm stop' : 'Confirm go live'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={!canAct}
      title={
        canAct
          ? undefined
          : 'Connect Twitch or YouTube in Settings → Services to go live.'
      }
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        streaming
          ? 'bg-red-600 text-white hover:opacity-90'
          : reconnecting
            ? 'bg-red-600/80 text-white'
            : 'bg-accent text-accent-fg hover:opacity-90',
      )}
    >
      {streaming ? (
        <>
          <Square size={14} aria-hidden />
          Stop stream
        </>
      ) : (
        <>
          <Radio size={14} aria-hidden />
          {reconnecting ? 'Reconnecting…' : 'Go live'}
        </>
      )}
    </button>
  )
}

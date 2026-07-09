import {Link2} from 'lucide-react'
import {useState} from 'react'
import {ConnectInstagram} from '../../../wailsjs/go/main/App'
import {useServices} from '../ServicesProvider'
import {ConnectedPanel, PrimaryButton} from './shared'

/**
 * Instagram connect form. Instagram rides the Facebook Page connection: the
 * Page's linked Instagram Business account is addressed with the same Page
 * token, so there is no separate sign-in — just a link step once Facebook is
 * connected.
 */
export function InstagramConnectForm() {
  const {statuses, setStatus, disconnect} = useServices()
  const status = statuses.instagram
  const facebookConnected = statuses.facebook.connected

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (status.connected) {
    return (
      <ConnectedPanel
        label="Connected as"
        account={status.account}
        onDisconnect={() => disconnect('instagram')}
      />
    )
  }

  if (!facebookConnected) {
    return (
      <p className="text-sm text-fg-muted">
        Instagram Live is accessed through your Facebook Page&apos;s linked
        Instagram Business account. Connect <strong>Facebook</strong> in
        Settings → Services first, then return here.
      </p>
    )
  }

  const connect = () => {
    setBusy(true)
    setError('')
    ConnectInstagram()
      .then((s) =>
        setStatus('instagram', {connected: s.connected, account: s.account}),
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Links the Instagram Business account attached to your connected
        Facebook Page ({statuses.facebook.account}). The account must be an
        Instagram <strong>Business or Creator</strong> account linked to the
        Page.
      </p>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <PrimaryButton type="button" onClick={connect} disabled={busy}>
        <Link2 size={14} aria-hidden />
        {busy ? 'Linking…' : 'Link Instagram account'}
      </PrimaryButton>
    </div>
  )
}

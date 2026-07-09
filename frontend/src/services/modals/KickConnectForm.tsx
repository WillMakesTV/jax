import {Copy, ExternalLink} from 'lucide-react'
import {useEffect, useRef, useState, type FormEvent} from 'react'
import {
  CancelKickAuth,
  KickRedirectURI,
  PollKickAuth,
  StartKickAuth,
} from '../../../wailsjs/go/main/App'
import {useServices} from '../ServicesProvider'
import type {ServiceDef} from '../services'
import {ConnectedPanel, Field, PrimaryButton, errorMessage, fieldInputClass} from './shared'

/**
 * Kick connect form. Kick's API has no device-code flow, so the sign-in is
 * authorization-code + PKCE through the browser: the backend runs a one-shot
 * loopback listener on a fixed port and the browser redirects back to it.
 * The redirect URI shown here must be registered verbatim on the Kick app
 * (dev.kick.com); the form polls PollKickAuth until the callback lands.
 */
export function KickConnectForm({service}: {service: ServiceDef}) {
  const {statuses, configs, updateConfigs, setStatus, disconnect} =
    useServices()
  const status = statuses.kick

  const [clientId, setClientId] = useState(configs.kickClientId)
  const [clientSecret, setClientSecret] = useState(configs.kickClientSecret)
  const [redirectUri, setRedirectUri] = useState('')
  const [copied, setCopied] = useState(false)
  const [phase, setPhase] = useState<'config' | 'awaiting'>('config')
  const [authorizeUrl, setAuthorizeUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    KickRedirectURI()
      .then(setRedirectUri)
      .catch(() => {})
  }, [])

  const poller = useRef<{cancelled: boolean; timer: number | undefined}>({
    cancelled: false,
    timer: undefined,
  })

  // Stop polling (and free the callback port) when the form unmounts.
  useEffect(() => {
    const ref = poller.current
    return () => {
      ref.cancelled = true
      if (ref.timer) window.clearTimeout(ref.timer)
      CancelKickAuth().catch(() => {})
    }
  }, [])

  if (status.connected) {
    return (
      <ConnectedPanel
        label="Connected as"
        account={status.account}
        onDisconnect={() => disconnect('kick')}
      />
    )
  }

  const schedulePoll = (deadline: number) => {
    poller.current.timer = window.setTimeout(async () => {
      if (poller.current.cancelled) return
      if (Date.now() > deadline) {
        setError('The sign-in timed out. Please try again.')
        setPhase('config')
        CancelKickAuth().catch(() => {})
        return
      }
      try {
        const result = await PollKickAuth()
        if (poller.current.cancelled) return
        if (result.status === 'complete') {
          setStatus('kick', {connected: true, account: result.account})
        } else if (result.status === 'error') {
          setError(result.message || 'Authorization failed.')
          setPhase('config')
        } else {
          schedulePoll(deadline)
        }
      } catch (err) {
        if (poller.current.cancelled) return
        setError(errorMessage(err, 'Authorization failed.'))
        setPhase('config')
      }
    }, 2000)
  }

  const onConnect = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    updateConfigs({kickClientId: clientId, kickClientSecret: clientSecret})
    try {
      const url = await StartKickAuth(clientId.trim(), clientSecret.trim())
      setAuthorizeUrl(url)
      setPhase('awaiting')
      poller.current.cancelled = false
      schedulePoll(Date.now() + 5 * 60 * 1000)
    } catch (err) {
      setError(errorMessage(err, 'Could not start authorization.'))
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'awaiting') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          A browser window has opened to authorize {service.name}. Approve
          access there and you&apos;ll be connected automatically.
        </p>
        {authorizeUrl && (
          <a
            href={authorizeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-accent underline"
          >
            <ExternalLink size={14} aria-hidden />
            Open the authorization page
          </a>
        )}
        <p className="text-sm text-fg-muted">
          Waiting for you to approve access…
        </p>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    )
  }

  const connectDisabled = busy || !clientId.trim() || !clientSecret.trim()

  return (
    <form onSubmit={onConnect} className="space-y-4">
      <p className="text-sm text-fg-muted">
        {service.description} You&apos;ll approve access in your browser.
      </p>

      <Field
        label="Client ID"
        htmlFor="kick-client-id"
        hint={
          <>
            From your app on the{' '}
            <a
              href="https://kick.com/settings/developer"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              Kick developer settings
            </a>{' '}
            page.
          </>
        }
      >
        <input
          id="kick-client-id"
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Your app's Client ID"
          className={fieldInputClass}
          autoComplete="off"
        />
      </Field>

      <Field label="Client Secret" htmlFor="kick-client-secret">
        <input
          id="kick-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Your app's Client Secret"
          className={fieldInputClass}
          autoComplete="off"
        />
      </Field>

      {/* The Kick app must whitelist this exact redirect URI. */}
      {redirectUri && (
        <Field label="Redirect URI" htmlFor="kick-redirect-uri">
          <div className="flex items-center gap-2">
            <input
              id="kick-redirect-uri"
              type="text"
              readOnly
              value={redirectUri}
              onFocus={(e) => e.target.select()}
              className={fieldInputClass + ' font-mono text-xs'}
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(redirectUri).catch(() => {})
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              }}
              title="Copy the redirect URI"
              className="shrink-0 rounded-lg border border-edge bg-bg px-2.5 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              {copied ? '✓' : <Copy size={13} aria-hidden />}
            </button>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Add this exact URI to your Kick app&apos;s redirect URLs — the
            sign-in fails without it.
          </p>
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

import {Copy, ExternalLink} from 'lucide-react'
import {useEffect, useRef, useState, type FormEvent} from 'react'
import {
  CancelXAuth,
  PollXAuth,
  StartXAuth,
  XRedirectURI,
} from '../../../wailsjs/go/main/App'
import {useServices} from '../ServicesProvider'
import type {ServiceDef} from '../services'
import {
  ConnectedPanel,
  Field,
  PrimaryButton,
  errorMessage,
  fieldInputClass,
} from './shared'

/**
 * X connect form: authorization-code + PKCE through the browser, with the
 * backend's one-shot loopback listener catching the redirect (same pattern
 * as Kick, on its own fixed port). The redirect URI shown here must be
 * registered verbatim on the X app; the Client Secret is only needed when
 * the X app is a confidential client.
 */
export function XConnectForm({service}: {service: ServiceDef}) {
  const {statuses, configs, updateConfigs, setStatus, disconnect} =
    useServices()
  const status = statuses.x

  const [clientId, setClientId] = useState(configs.xClientId)
  const [clientSecret, setClientSecret] = useState(configs.xClientSecret)
  const [redirectUri, setRedirectUri] = useState('')
  const [copied, setCopied] = useState(false)
  const [phase, setPhase] = useState<'config' | 'awaiting'>('config')
  const [authorizeUrl, setAuthorizeUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    XRedirectURI()
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
      CancelXAuth().catch(() => {})
    }
  }, [])

  if (status.connected) {
    return (
      <ConnectedPanel
        label="Connected as"
        account={status.account}
        onDisconnect={() => disconnect('x')}
      />
    )
  }

  const schedulePoll = (deadline: number) => {
    poller.current.timer = window.setTimeout(async () => {
      if (poller.current.cancelled) return
      if (Date.now() > deadline) {
        setError('The sign-in timed out. Please try again.')
        setPhase('config')
        CancelXAuth().catch(() => {})
        return
      }
      try {
        const result = await PollXAuth()
        if (poller.current.cancelled) return
        if (result.status === 'complete') {
          setStatus('x', {connected: true, account: result.account})
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
    updateConfigs({xClientId: clientId, xClientSecret: clientSecret})
    try {
      const url = await StartXAuth(clientId.trim(), clientSecret.trim())
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

  const connectDisabled = busy || !clientId.trim()

  return (
    <form onSubmit={onConnect} className="space-y-4">
      <p className="text-sm text-fg-muted">
        {service.description} You&apos;ll approve access in your browser.
      </p>

      <Field
        label="Client ID"
        htmlFor="x-client-id"
        hint={
          <>
            The OAuth 2.0 Client ID from your app&apos;s &ldquo;Keys and
            tokens&rdquo; page on the{' '}
            <a
              href="https://developer.x.com/en/portal/dashboard"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              X developer portal
            </a>
            .
          </>
        }
      >
        <input
          id="x-client-id"
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Your app's OAuth 2.0 Client ID"
          className={fieldInputClass}
          autoComplete="off"
        />
      </Field>

      <Field label="Client Secret (only for confidential clients)" htmlFor="x-client-secret">
        <input
          id="x-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Leave empty for a Native/Public app"
          className={fieldInputClass}
          autoComplete="off"
        />
      </Field>

      {/* The X app must whitelist this exact redirect URI. */}
      {redirectUri && (
        <Field label="Redirect URI" htmlFor="x-redirect-uri">
          <div className="flex items-center gap-2">
            <input
              id="x-redirect-uri"
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
            Add this exact URI to your X app&apos;s Callback URLs (User
            authentication settings) — the sign-in fails without it.
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

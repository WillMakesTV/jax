import {KeyRound, Sparkles} from 'lucide-react'
import {useState} from 'react'

/**
 * Wails rejects bound-method promises with the Go error *string*, not an
 * Error object, so both shapes must be handled to surface the real cause.
 */
const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}
import {
  ConnectAnthropicAPIKey,
  ConnectAnthropicAccount,
} from '../../../wailsjs/go/main/App'
import {useServices} from '../ServicesProvider'
import {ConnectedPanel, Field, fieldInputClass} from './shared'

/**
 * Connect Anthropic either with a Claude account (recommended — covers Pro,
 * Max, Team, and Enterprise plans via the Anthropic CLI's browser sign-in) or
 * with a Console API key.
 */
export function AnthropicConnectForm() {
  const {statuses, setStatus, disconnect} = useServices()
  const status = statuses.anthropic

  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'account' | 'key' | null>(null)
  const [error, setError] = useState('')

  if (status.connected) {
    return (
      <ConnectedPanel
        label="Connected as"
        account={status.account}
        onDisconnect={() => disconnect('anthropic')}
      />
    )
  }

  const connectAccount = async () => {
    setBusy('account')
    setError('')
    try {
      const result = await ConnectAnthropicAccount()
      setStatus('anthropic', {connected: true, account: result.account})
    } catch (err) {
      setError(messageOf(err, 'Could not sign in with Claude.'))
    } finally {
      setBusy(null)
    }
  }

  const connectKey = async () => {
    setBusy('key')
    setError('')
    try {
      const result = await ConnectAnthropicAPIKey(apiKey)
      setStatus('anthropic', {connected: true, account: result.account})
    } catch (err) {
      setError(messageOf(err, 'Could not validate the API key.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-fg-muted">
          Sign in with your Claude account — Pro, Max, Team, and Enterprise
          plans all work. Your default browser opens to approve access.
        </p>
        <p className="mt-1.5 text-xs text-fg-muted">
          Sign-in is brokered by Anthropic's CLI (
          <span className="font-mono">ant</span>) — Anthropic doesn't allow
          apps to run it directly. If the CLI isn't installed yet, it is
          installed automatically first (
          <a
            href="https://platform.claude.com/docs/en/cli-sdks-libraries/cli/quickstart"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            via Go
          </a>
          ), so the first sign-in can take a minute or two.
        </p>
        <button
          type="button"
          onClick={() => void connectAccount()}
          disabled={busy !== null}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Sparkles size={15} aria-hidden />
          {busy === 'account'
            ? 'Waiting for the browser sign-in…'
            : 'Sign in with Claude (recommended)'}
        </button>
        {busy === 'account' && (
          <p className="mt-2 text-xs text-fg-muted">
            Complete the sign-in in your browser — this dialog updates when
            it's done. (A first-time CLI install happens before the browser
            opens and can take a minute.)
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-fg-muted">
        <span className="h-px flex-1 bg-edge" aria-hidden />
        or
        <span className="h-px flex-1 bg-edge" aria-hidden />
      </div>

      <div>
        <Field
          label="API key"
          htmlFor="anthropic-api-key"
          hint="From the Anthropic Console (console.anthropic.com). Billed per use, separate from a Claude subscription."
        >
          <input
            id="anthropic-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && apiKey.trim()) void connectKey()
            }}
            placeholder="sk-ant-…"
            spellCheck={false}
            autoComplete="off"
            className={fieldInputClass}
          />
        </Field>
        <button
          type="button"
          onClick={() => void connectKey()}
          disabled={busy !== null || !apiKey.trim()}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <KeyRound size={15} aria-hidden />
          {busy === 'key' ? 'Checking the key…' : 'Connect with API key'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

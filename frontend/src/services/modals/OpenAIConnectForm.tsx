import {KeyRound, Loader2, Sparkles} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  ConnectOpenAIAPIKey,
  ConnectOpenAIAccount,
} from '../../../wailsjs/go/main/App'
import {EventsOn} from '../../../wailsjs/runtime/runtime'
import {useServices} from '../ServicesProvider'
import {ConnectedPanel, Field, fieldInputClass} from './shared'

/** Backend progress stages emitted while ConnectOpenAIAccount runs. */
type ConnectStage = 'signin' | 'verifying'

const STAGE_LABELS: Record<ConnectStage, string> = {
  signin: 'Finish the sign-in in your browser…',
  verifying: 'Verifying the connection…',
}

/**
 * Wails rejects bound-method promises with the Go error *string*, not an
 * Error object, so both shapes must be handled to surface the real cause.
 */
const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

/**
 * Connect OpenAI either with a ChatGPT account (recommended — covers Plus,
 * Pro, Team, and Enterprise plans via the Codex CLI's browser sign-in) or
 * with a platform API key. Mirrors AnthropicConnectForm.
 */
export function OpenAIConnectForm() {
  const {statuses, setStatus, disconnect} = useServices()
  const status = statuses.openai

  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'account' | 'key' | null>(null)
  const [stage, setStage] = useState<ConnectStage | null>(null)
  const [error, setError] = useState('')

  // The backend narrates the account flow (browser sign-in, verification) so
  // the button can show what it is waiting for.
  useEffect(() => EventsOn('openai:connect', (s: ConnectStage) => setStage(s)), [])

  if (status.connected) {
    return (
      <ConnectedPanel
        label="Connected as"
        account={status.account}
        masked
        onDisconnect={() => disconnect('openai')}
      />
    )
  }

  const connectAccount = async () => {
    setBusy('account')
    setStage(null)
    setError('')
    try {
      const result = await ConnectOpenAIAccount()
      setStatus('openai', {connected: true, account: result.account})
    } catch (err) {
      setError(messageOf(err, 'Could not sign in with ChatGPT.'))
    } finally {
      setBusy(null)
      setStage(null)
    }
  }

  const connectKey = async () => {
    setBusy('key')
    setError('')
    try {
      const result = await ConnectOpenAIAPIKey(apiKey)
      setStatus('openai', {connected: true, account: result.account})
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
          Use your ChatGPT account — Plus, Pro, Team, and Enterprise plans all
          work. AI features run through Codex on your subscription: no API
          project, no per-token billing.
        </p>
        <p className="mt-1.5 text-xs text-fg-muted">
          OpenAI only permits subscription sign-in inside Codex, so this links
          the account the Codex CLI on this computer is signed in with. Not
          signed in yet? Your browser opens to complete the sign-in, and the
          connection is verified with a live check before it is saved.
        </p>
        <button
          type="button"
          onClick={() => void connectAccount()}
          disabled={busy !== null}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'account' ? (
            <Loader2 size={15} aria-hidden className="animate-spin" />
          ) : (
            <Sparkles size={15} aria-hidden />
          )}
          {busy === 'account'
            ? (stage && STAGE_LABELS[stage]) || 'Linking your ChatGPT account…'
            : 'Use my ChatGPT account (recommended)'}
        </button>
        {busy === 'account' && stage === 'signin' && (
          <p className="mt-2 text-xs text-fg-muted" role="status">
            A browser window has opened — sign in with your ChatGPT account
            there. This dialog updates by itself once you finish.
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
          htmlFor="openai-api-key"
          hint="From the OpenAI platform (platform.openai.com). Billed per use, separate from a ChatGPT subscription."
        >
          <input
            id="openai-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && apiKey.trim()) void connectKey()
            }}
            placeholder="sk-…"
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

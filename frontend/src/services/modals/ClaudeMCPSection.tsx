import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Plug,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  GetMCPStatus,
  RecycleMCPToken,
  SetupClaudeMCP,
} from '../../../wailsjs/go/main/App'
import type {main} from '../../../wailsjs/go/models'

const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

/** One Claude client's configuration state, as a compact status chip. */
function TargetRow({target}: {target: main.MCPTargetStatus}) {
  let label = 'Not connected'
  let tone = 'text-fg-muted'
  if (!target.installed && !target.configured) {
    label = 'Not installed'
  } else if (target.configured && target.current) {
    label = 'Connected'
    tone = 'text-green-600 dark:text-green-400'
  } else if (target.configured) {
    label = 'Needs update'
    tone = 'text-amber-600 dark:text-amber-400'
  }
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-fg">{target.name}</span>
      <span className={tone}>{label}</span>
    </div>
  )
}

/**
 * Post-connection section of the Anthropic modal: registers the app's
 * built-in MCP server with Claude Code and Claude Desktop (one button covers
 * both), shows the access token, and lets the user recycle it. Setup and
 * recycling rewrite the clients' config files, which they only read at
 * launch — hence the restart notice.
 */
export function ClaudeMCPSection() {
  const [status, setStatus] = useState<main.MCPStatus | null>(null)
  const [busy, setBusy] = useState<'setup' | 'recycle' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    GetMCPStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  if (!status) return null

  const bothCurrent =
    status.claudeCode.configured &&
    status.claudeCode.current &&
    status.claudeDesktop.configured &&
    status.claudeDesktop.current

  const setup = async () => {
    setBusy('setup')
    setError('')
    setNotice('')
    try {
      setStatus(await SetupClaudeMCP())
      setNotice(
        'Connected. Restart Claude Desktop and any open Claude Code sessions so they pick up the connection.',
      )
    } catch (err) {
      setError(messageOf(err, 'Could not update the Claude configuration.'))
      GetMCPStatus().then(setStatus).catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }

  const recycle = async () => {
    setBusy('recycle')
    setError('')
    setNotice('')
    try {
      setStatus(await RecycleMCPToken())
      setNotice(
        'Token recycled and the Claude configurations were updated. Restart Claude Desktop and any open Claude Code sessions to reconnect.',
      )
    } catch (err) {
      setError(messageOf(err, 'Could not recycle the token.'))
      GetMCPStatus().then(setStatus).catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(status.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy — reveal the token and copy it manually.')
    }
  }

  return (
    <div className="space-y-3 border-t border-edge pt-4">
      <div>
        <p className="text-sm font-medium text-fg">Claude apps</p>
        <p className="mt-1 text-xs text-fg-muted">
          Give Claude Code and Claude Desktop access to your streams, plans,
          series, projects, transcripts, and chat through the app&apos;s
          built-in MCP server ({status.toolCount} tools). One button sets up
          both.
        </p>
      </div>

      <div className="space-y-1.5 rounded-lg border border-edge bg-bg px-3 py-2.5">
        <TargetRow target={status.claudeCode} />
        <TargetRow target={status.claudeDesktop} />
      </div>

      <button
        type="button"
        onClick={() => void setup()}
        disabled={busy !== null}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Plug size={15} aria-hidden />
        {busy === 'setup'
          ? 'Updating Claude configurations…'
          : bothCurrent
            ? 'Reconnect Claude Code & Claude Desktop'
            : 'Connect Claude Code & Claude Desktop'}
      </button>

      <div>
        <p className="mb-1.5 text-xs font-medium text-fg-muted">
          MCP access token
        </p>
        <div className="flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
            {revealed ? status.token : '•'.repeat(24)}
          </span>
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide the token' : 'Show the token'}
            title={revealed ? 'Hide the token' : 'Show the token'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {revealed ? (
              <EyeOff size={14} aria-hidden />
            ) : (
              <Eye size={14} aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => void copyToken()}
            aria-label="Copy the token"
            title="Copy the token"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {copied ? (
              <Check
                size={14}
                aria-hidden
                className="text-green-600 dark:text-green-400"
              />
            ) : (
              <Copy size={14} aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => void recycle()}
            disabled={busy !== null}
            aria-label="Recycle the token"
            title="Recycle the token (generates a new one and updates the Claude configurations)"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              aria-hidden
              className={busy === 'recycle' ? 'animate-spin' : undefined}
            />
          </button>
        </div>
        <p className="mt-1.5 text-xs text-fg-muted">
          Authenticates Claude&apos;s MCP connection to this app. Recycling
          replaces it everywhere it is configured.
        </p>
      </div>

      {notice && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

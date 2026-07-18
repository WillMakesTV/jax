import {Sparkles} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  ChatAppAbout,
  GetAppAbout,
  SetAppAbout,
} from '../../../wailsjs/go/main/App'
import {DescriptionChat, type ChatTurn} from '../../components/DescriptionChat'
import {MarkdownField} from '../../components/markdown/MarkdownField'
import {Modal} from '../../components/Modal'

/**
 * Settings → About: the app's own description — what Jax is and what it can
 * do — written with the same description-building chat projects use. The
 * chat runs with the live app-documentation MCP tools attached, so the
 * portrait it writes is grounded in the actual build; the result also feeds
 * describe_app for MCP clients. Formerly kept as a regular "Project Jax…"
 * project, whose description the first load adopts.
 */
export function AboutTab() {
  const [about, setAbout] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  // The chat's transcript survives the modal closing.
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([])

  useEffect(() => {
    let cancelled = false
    GetAppAbout()
      .then((v) => {
        if (cancelled) return
        setAbout(v)
        setSaved(v)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (value: string) => {
    setError('')
    try {
      await SetAppAbout(value)
      setSaved(value)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the description.',
      )
    }
  }

  const dirty = about !== saved

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <section
        aria-labelledby="about-app-heading"
        className="rounded-xl border border-edge bg-surface p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="about-app-heading"
              className="text-base font-semibold text-fg"
            >
              About Jax
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              The app&apos;s own description — what Jax is and what it can do.
              MCP clients read it through{' '}
              <code className="text-xs">describe_app</code>, so keeping it
              current keeps every connected AI accurate about the application.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            <Sparkles size={14} aria-hidden className="text-accent" />
            Build the description
          </button>
        </div>

        {!loaded ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <>
            <MarkdownField
              id="app-about-description"
              value={about}
              onChange={setAbout}
              onDone={() => void save(about)}
              placeholder="What is Jax? Features, workflows, integrations… — or talk it through in the Build the description chat."
            />
            {dirty && (
              <button
                type="button"
                onClick={() => void save(about)}
                className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                Save description
              </button>
            )}
          </>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </section>

      <Modal
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Build the description"
        icon={<Sparkles size={18} aria-hidden className="text-accent" />}
        maxWidthClass="max-w-xl"
      >
        <DescriptionChat
          messages={chatMessages}
          onMessages={setChatMessages}
          send={(history, message) => ChatAppAbout(history, message)}
          emptyHint="Talk the app through — the chat can read Jax's live documentation (pages, functions, models) while you talk, so the About page stays true to the real build."
          onDescription={(markdown) => {
            setAbout(markdown)
            void save(markdown)
          }}
        />
      </Modal>
    </div>
  )
}

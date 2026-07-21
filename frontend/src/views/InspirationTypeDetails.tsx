import {Loader2, Save, Sparkles} from 'lucide-react'
import {useState} from 'react'
import {
  GenerateInspirationTypeBrief,
  SaveInspirationType,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {PageHeader} from '../components/PageHeader'
import {inspirationError} from './Inspiration'

/**
 * One inspiration type: the lens a tagged channel is studied through. The
 * brief edited here is the same document the type publishes as an
 * application skill (Settings → Skills), and it rides along with the takeaway
 * extraction for every channel carrying this type.
 */
export function InspirationTypeDetails({
  type,
  onSaved,
}: {
  /** The type being edited; null starts a new one. */
  type: main.InspirationType | null
  /** Called with the stored type after a save. */
  onSaved: (type: main.InspirationType) => void
}) {
  const [name, setName] = useState(type?.name ?? '')
  const [summary, setSummary] = useState(type?.summary ?? '')
  const [brief, setBrief] = useState(type?.brief ?? '')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const save = async () => {
    setBusy('save')
    setError('')
    setNote('')
    try {
      const stored = await SaveInspirationType(
        main.InspirationType.createFrom({
          id: type?.id ?? '',
          name,
          summary,
          brief,
          createdAt: type?.createdAt ?? '',
          updatedAt: type?.updatedAt ?? '',
        }),
      )
      onSaved(stored)
      setNote('Saved — this type now steers the channels tagged with it.')
    } catch (err) {
      setError(inspirationError(err, 'That type could not be saved.'))
    } finally {
      setBusy('')
    }
  }

  const draft = async () => {
    setBusy('draft')
    setError('')
    setNote('')
    try {
      // The summary doubles as the producer's notes for the drafting pass.
      setBrief(await GenerateInspirationTypeBrief(name, summary))
      setNote('Drafted — read it through and edit before saving.')
    } catch (err) {
      setError(inspirationError(err, 'The brief could not be drafted.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        description={
          type
            ? 'Its brief is also an application skill — editing here edits that skill.'
            : 'A new lens: what channels tagged with it are studied for.'
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void draft()}
              disabled={busy !== '' || !name.trim()}
              title="Draft the brief with AI from the name and summary"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {busy === 'draft' ? (
                <Loader2 size={14} aria-hidden className="animate-spin" />
              ) : (
                <Sparkles size={14} aria-hidden />
              )}
              Draft with AI
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== '' || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'save' ? (
                <Loader2 size={14} aria-hidden className="animate-spin" />
              ) : (
                <Save size={14} aria-hidden />
              )}
              Save type
            </button>
          </div>
        }
      />

      <div className="flex max-w-4xl flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Editing Style"
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Summary</span>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="How the video is cut, graded, paced, and packaged."
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Brief</span>
          <p className="text-xs text-fg-muted">
            What to look for, what to skip, and what a takeaway under this lens
            should read like. It is sent with every extraction for a tagged
            channel, so keep it specific and short.
          </p>
          <MarkdownField
            id="inspiration-type-brief"
            value={brief}
            onChange={setBrief}
            placeholder="Study this channel for…"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {note && <p className="text-sm text-fg-muted">{note}</p>}
      </div>
    </div>
  )
}

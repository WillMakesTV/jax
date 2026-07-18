import {
  ArrowLeft,
  Check,
  CornerDownRight,
  File,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import clsx from 'clsx'
import {
  AddProjectAssets,
  ChatProjectDescription,
  DeleteProjectAsset,
  DeleteProjectDoc,
  GetProjects,
  SaveProject,
  SaveProjectDoc,
  UpdateProjectAsset,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {DescriptionChat, type ChatTurn} from '../components/DescriptionChat'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {Modal} from '../components/Modal'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

type ProjectTab = 'overview' | 'files' | 'docs'

/**
 * A project's own page: create a new project, or view/edit an existing one
 * across three tabs — Overview (title + markdown description), Files
 * (uploaded assets, each with a description), and Docs (a nestable tree of
 * markdown documents).
 */
export function ProjectDetails({
  project,
  onBack,
}: {
  /** The project being viewed, or null when creating a new one. */
  project: main.Project | null
  onBack: () => void
}) {
  const [proj, setProj] = useState<main.Project | null>(project)
  const [tab, setTab] = useState<ProjectTab>('overview')

  // The navigation history hands us a snapshot; reload the live record so
  // files/docs edited on a previous visit are current.
  useEffect(() => {
    if (!project) return
    GetProjects()
      .then((all) => {
        const fresh = (all ?? []).find((p) => p.id === project.id)
        if (fresh) setProj(fresh)
      })
      .catch(() => {})
  }, [project])

  const tabs: {id: ProjectTab; label: string}[] = [
    {id: 'overview', label: 'Overview'},
    {
      id: 'files',
      label: `Files${proj?.assets?.length ? ` (${proj.assets.length})` : ''}`,
    },
    {
      id: 'docs',
      label: `Docs${proj?.docs?.length ? ` (${proj.docs.length})` : ''}`,
    },
  ]

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Projects
      </button>

      {!proj ? (
        <CreateProjectForm onCreated={setProj} onCancel={onBack} />
      ) : (
        <div className="flex flex-col gap-6">
          <div
            role="tablist"
            aria-label="Project sections"
            className="flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.id
                    ? 'bg-accent text-accent-fg'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <OverviewSection project={proj} onChange={setProj} />
          )}
          {tab === 'files' && (
            <FilesSection project={proj} onChange={setProj} />
          )}
          {tab === 'docs' && <DocsSection project={proj} onChange={setProj} />}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Creation: a title is all it takes
// ---------------------------------------------------------------------------

function CreateProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: (project: main.Project) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!title.trim()) {
      setError('Give the project a title.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await SaveProject(
        main.Project.createFrom({
          id: '',
          title: title.trim(),
          description: '',
          createdAt: '',
          assets: [],
          docs: [],
        }),
      )
      onCreated(saved)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not create the project.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
      className="flex max-w-2xl flex-col gap-5"
    >
      <p className="text-sm text-fg-muted">
        A project is a body of work — a launch, a build, a campaign. A title is
        all it takes to start; the description is talked through with the AI
        right after.
      </p>

      <div>
        <label htmlFor="project-title" className={labelCls}>
          Title
        </label>
        <input
          id="project-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Chatter Bot v2 launch"
          autoFocus
          className={field}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Overview: click-to-edit title + description, and the brief chat
// ---------------------------------------------------------------------------

function OverviewSection({
  project,
  onChange,
}: {
  project: main.Project
  onChange: (project: main.Project) => void
}) {
  const [description, setDescription] = useState(project.description)
  const [error, setError] = useState('')
  // The brief chat lives in a modal behind a CTA; its transcript is held
  // here so closing the dialog doesn't lose the conversation.
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([])

  // Adopt the freshly reloaded record (see ProjectDetails) once, but never
  // clobber in-progress typing: only sync when the record itself changes.
  const [synced, setSynced] = useState(project)
  if (project !== synced) {
    setSynced(project)
    setDescription(project.description)
  }

  // Assets/docs are preserved by the backend regardless of what is sent.
  const persist = async (fields: {title?: string; description?: string}) => {
    const saved = await SaveProject(
      main.Project.createFrom({
        id: project.id,
        title: fields.title ?? project.title,
        description: fields.description ?? description,
        createdAt: project.createdAt,
        assets: [],
        docs: [],
      }),
    )
    onChange(saved)
  }

  const saveDescription = async (value: string) => {
    setError('')
    try {
      await persist({description: value})
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the description.',
      )
    }
  }

  const dirty = description !== project.description

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <EditableTitle
        value={project.title}
        onSave={(title) => persist({title})}
      />

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-fg">Description</span>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            <Sparkles size={14} aria-hidden className="text-accent" />
            Build the description
          </button>
        </div>
        <MarkdownField
          id="project-description"
          value={description}
          onChange={setDescription}
          onDone={() => void saveDescription(description)}
          placeholder="What is this project? Goals, links, context… — or talk it through in the Build the description chat."
        />
        {dirty && (
          <button
            type="button"
            onClick={() => void saveDescription(description)}
            className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            Save description
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

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
          send={(history, message) =>
            ChatProjectDescription(project.id, history, message)
          }
          emptyHint="Talk the project through — what it is, who it's for, what done looks like. The description writes itself onto the Overview page as you go, and the chat can look up any detail of the app while you talk."
          onDescription={(markdown) => {
            setDescription(markdown)
            void saveDescription(markdown)
          }}
        />
      </Modal>
    </div>
  )
}

/** The project's title: read-only until the hover Edit CTA is clicked. */
function EditableTitle({
  value,
  onSave,
}: {
  value: string
  onSave: (title: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!draft.trim()) {
      setError('Give the project a title.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the title.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="group flex items-center gap-2">
        <h2 className="min-w-0 break-words text-xl font-bold text-fg">
          {value}
        </h2>
        <button
          type="button"
          onClick={() => {
            setDraft(value)
            setError('')
            setEditing(true)
          }}
          title="Edit title"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-xs font-medium text-fg-muted opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg"
        >
          <Pencil size={12} aria-hidden />
          Edit
        </button>
      </div>
    )
  }

  return (
    <div>
      <label htmlFor="project-title" className={labelCls}>
        Title
      </label>
      <div className="flex items-center gap-2">
        <input
          id="project-title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void save()
            }
            if (e.key === 'Escape') setEditing(false)
          }}
          autoFocus
          className={field}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          title="Save title"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Check size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          title="Cancel"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Files: uploaded assets, each with a description
// ---------------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

function FilesSection({
  project,
  onChange,
}: {
  project: main.Project
  onChange: (project: main.Project) => void
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const assets = project.assets ?? []

  const addFiles = async () => {
    setAdding(true)
    setError('')
    try {
      onChange(await AddProjectAssets(project.id))
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not add the files.',
      )
    } finally {
      setAdding(false)
    }
  }

  const removeAsset = async (assetID: string) => {
    try {
      onChange(await DeleteProjectAsset(project.id, assetID))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-fg-muted">
          Files, images, and assets that belong to this project. Describe each
          one so its purpose is clear later.
        </p>
        <button
          type="button"
          onClick={() => void addFiles()}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Upload size={14} aria-hidden />
          {adding ? 'Adding…' : 'Add files'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {assets.length === 0 ? (
        <button
          type="button"
          onClick={() => void addFiles()}
          disabled={adding}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
          >
            <Paperclip size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              Add the project's first files
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              Logos, screenshots, briefs, spreadsheets — anything the project
              needs on hand.
            </p>
          </div>
        </button>
      ) : (
        <ul className="flex flex-col gap-3">
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              onDescribe={async (description) =>
                onChange(
                  await UpdateProjectAsset(project.id, asset.id, description),
                )
              }
              onDelete={() => void removeAsset(asset.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function AssetRow({
  asset,
  onDescribe,
  onDelete,
}: {
  asset: main.ProjectAsset
  onDescribe: (description: string) => Promise<void>
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(asset.description)
  const [saving, setSaving] = useState(false)
  const dirty = draft !== asset.description
  const isImage = IMAGE_EXT.test(asset.name)

  const save = async () => {
    setSaving(true)
    try {
      await onDescribe(draft)
    } catch {
      // Keep the draft so the save can be retried.
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex gap-4 rounded-xl border border-edge bg-surface p-4">
      {isImage ? (
        <img
          src={asset.mediaUrl}
          alt={asset.description || asset.name}
          className="h-20 w-20 shrink-0 rounded-lg border border-edge object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-edge bg-bg text-fg-muted"
        >
          <File size={28} />
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">
              {asset.name}
            </p>
            <p className="text-xs text-fg-muted">
              {formatSize(asset.sizeBytes)}
            </p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            title="Remove file"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="What is this file for?"
            className={`${field} resize-y`}
          />
          {dirty && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Docs: a nestable tree of markdown documents
// ---------------------------------------------------------------------------

/** A doc being edited; id '' means it has not been saved yet. */
interface DocDraft {
  id: string
  parentId: string
  title: string
  content: string
}

function DocsSection({
  project,
  onChange,
}: {
  project: main.Project
  onChange: (project: main.Project) => void
}) {
  const docs = useMemo(() => project.docs ?? [], [project.docs])
  const [draft, setDraft] = useState<DocDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Children grouped under their parent, preserving stored order.
  const byParent = useMemo(() => {
    const map = new Map<string, main.ProjectDoc[]>()
    for (const d of docs) {
      const key = d.parentId ?? ''
      map.set(key, [...(map.get(key) ?? []), d])
    }
    return map
  }, [docs])

  const openDoc = (doc: main.ProjectDoc) =>
    setDraft({
      id: doc.id,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
    })

  const newDoc = (parentId: string) =>
    setDraft({id: '', parentId, title: '', content: ''})

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) {
      setError('Give the doc a title.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const before = new Set(docs.map((d) => d.id))
      const updated = await SaveProjectDoc(
        project.id,
        main.ProjectDoc.createFrom({
          id: draft.id,
          parentId: draft.parentId,
          title: draft.title.trim(),
          content: draft.content,
          createdAt: '',
        }),
      )
      onChange(updated)
      // A newly created doc stays open for further editing under its real id.
      const created = (updated.docs ?? []).find((d) => !before.has(d.id))
      if (created) openDoc(created)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the doc.',
      )
    } finally {
      setSaving(false)
    }
  }

  const removeDoc = async (docID: string) => {
    try {
      onChange(await DeleteProjectDoc(project.id, docID))
      if (draft?.id === docID) setDraft(null)
    } catch {
      // Non-fatal; the tree reconciles on the next load.
    }
  }

  const renderBranch = (parentId: string, depth: number) => {
    const children = byParent.get(parentId) ?? []
    if (children.length === 0) return null
    return (
      <ul className={clsx('flex flex-col gap-0.5', depth > 0 && 'ml-4')}>
        {children.map((doc) => (
          <li key={doc.id}>
            <div
              className={clsx(
                'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                draft?.id === doc.id
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg hover:bg-surface-hover',
              )}
            >
              <button
                type="button"
                onClick={() => openDoc(doc)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm font-medium"
              >
                {depth > 0 && (
                  <CornerDownRight
                    size={12}
                    aria-hidden
                    className="shrink-0 text-fg-muted"
                  />
                )}
                <FileText size={13} aria-hidden className="shrink-0" />
                <span className="truncate">{doc.title}</span>
              </button>
              <button
                type="button"
                onClick={() => newDoc(doc.id)}
                title="Add a doc under this one"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Plus size={13} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => void removeDoc(doc.id)}
                title="Delete doc (children move up a level)"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
            {renderBranch(doc.id, depth + 1)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Tree */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
        <button
          type="button"
          onClick={() => newDoc('')}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          <Plus size={14} aria-hidden />
          New doc
        </button>
        {docs.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No docs yet. Write the project's documentation as markdown pages and
            nest them to build a structure.
          </p>
        ) : (
          <nav
            aria-label="Project docs"
            className="rounded-xl border border-edge bg-surface p-2"
          >
            {renderBranch('', 0)}
          </nav>
        )}
      </div>

      {/* Editor */}
      <div className="min-w-0 flex-1">
        {!draft ? (
          docs.length > 0 && (
            <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
              Select a doc to read or edit it, or start a new one.
            </p>
          )
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4"
          >
            {draft.parentId && (
              <p className="text-xs text-fg-muted">
                Nested under{' '}
                <span className="font-medium text-fg">
                  {docs.find((d) => d.id === draft.parentId)?.title ?? '…'}
                </span>
              </p>
            )}
            <div>
              <label htmlFor="doc-title" className={labelCls}>
                Title
              </label>
              <input
                id="doc-title"
                value={draft.title}
                onChange={(e) => setDraft({...draft, title: e.target.value})}
                placeholder="e.g. Getting started"
                autoFocus={!draft.id}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="doc-content" className={labelCls}>
                Content
              </label>
              <MarkdownField
                id="doc-content"
                value={draft.content}
                onChange={(content) => setDraft({...draft, content})}
                placeholder="Write this page's documentation in markdown…"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save doc'}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
              >
                Close
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

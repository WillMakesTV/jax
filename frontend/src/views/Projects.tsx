import {FileText, FolderKanban, Paperclip, Plus, Trash2} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {DeleteProject, GetProjects} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {PageHeader} from '../components/PageHeader'
import {useDataChanged} from '../lib/dataChanged'

/**
 * The Projects section: creatable bodies of work (a launch, a build, a
 * campaign) with their own description, files, and documentation. Each card
 * opens the project's page (see ProjectDetails).
 */
export function Projects({
  onOpenProject,
}: {
  /** Open a project's page (null = create a new project). */
  onOpenProject: (project: main.Project | null) => void
}) {
  const [projects, setProjects] = useState<main.Project[]>([])

  const load = useCallback(() => {
    GetProjects()
      .then((p) => setProjects(p ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  // Projects saved elsewhere (e.g. an MCP client) appear without a re-visit.
  useDataChanged(['projects'], load)

  const remove = async (id: string) => {
    try {
      await DeleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        description="Group your work into projects — each with its own description, files, and docs."
        actions={
          projects.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenProject(null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={14} aria-hidden />
              New project
            </button>
          )
        }
      />

      {projects.length === 0 ? (
        <button
          type="button"
          onClick={() => onOpenProject(null)}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover sm:w-1/2"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            <FolderKanban size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              Create a project
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              A launch, a build, a campaign — gather its description, files,
              and documentation in one place.
            </p>
          </div>
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => onOpenProject(p)}
              onDelete={() => void remove(p.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: main.Project
  onOpen: () => void
  onDelete: () => void
}) {
  const files = project.assets?.length ?? 0
  const docs = project.docs?.length ?? 0
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="flex h-full cursor-pointer flex-col rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
            >
              <FolderKanban size={16} />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
              {project.title}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="Delete project"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>

        {project.description && (
          <p className="mt-2 line-clamp-2 text-sm text-fg-muted">
            {project.description}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
            <Paperclip size={11} aria-hidden />
            {files} {files === 1 ? 'file' : 'files'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
            <FileText size={11} aria-hidden />
            {docs} {docs === 1 ? 'doc' : 'docs'}
          </span>
        </div>
      </div>
    </li>
  )
}

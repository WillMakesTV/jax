import {createContext, useCallback, useContext, useMemo, type ReactNode} from 'react'
import {
  GenerateProjectThumbnail,
  SetProjectThumbnail,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useAiQueue} from '../ai/AiQueueProvider'

/** One project cover-image generation, queued or in flight. */
export interface ProjectThumbJob {
  projectId: string
  /** Project title for busy-state copy. */
  title: string
}

interface ProjectThumbsContextValue {
  jobs: ProjectThumbJob[]
  /**
   * Generate (or revise) a project's cover image. The run lives in the
   * app-wide AI queue (see AiQueueProvider), so it survives navigating away
   * and reports through the status bar; the finished image is persisted
   * onto the project right here for the same reason. Rejects when a run for
   * the project is already queued or in flight.
   */
  generate: (
    projectId: string,
    title: string,
    feedback: string,
    currentFile: string,
  ) => Promise<main.Project>
}

const ProjectThumbsContext = createContext<
  ProjectThumbsContextValue | undefined
>(undefined)

export function ProjectThumbsProvider({children}: {children: ReactNode}) {
  const queue = useAiQueue()

  const jobs = useMemo<ProjectThumbJob[]>(
    () =>
      queue.jobs
        .filter((j) => j.kind === 'project-image')
        .map((j) => ({projectId: j.targetId, title: j.title})),
    [queue.jobs],
  )

  const generate = useCallback(
    (projectId: string, title: string, feedback: string, currentFile: string) =>
      queue.enqueue({
        kind: 'project-image',
        targetId: projectId,
        title,
        label: `Generating project image — ${title || 'project'}`,
        doneDetail: `Project image ready — ${title || 'project'}`,
        failDetail: 'The project image failed',
        busyError: 'an image is already being generated for this project',
        work: async () => {
          const t = await GenerateProjectThumbnail(
            projectId,
            feedback,
            currentFile,
          )
          // Persist here, not on the page: the page may be long gone.
          return SetProjectThumbnail(projectId, t.file)
        },
      }),
    [queue],
  )

  const value = useMemo<ProjectThumbsContextValue>(
    () => ({jobs, generate}),
    [jobs, generate],
  )

  return (
    <ProjectThumbsContext.Provider value={value}>
      {children}
    </ProjectThumbsContext.Provider>
  )
}

export function useProjectThumbs(): ProjectThumbsContextValue {
  const context = useContext(ProjectThumbsContext)
  if (!context) {
    throw new Error(
      'useProjectThumbs must be used within a ProjectThumbsProvider',
    )
  }
  return context
}

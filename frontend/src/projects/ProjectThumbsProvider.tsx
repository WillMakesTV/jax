import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  GenerateProjectThumbnail,
  SetProjectThumbnail,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'

/** One project cover-image generation in flight. */
export interface ProjectThumbJob {
  projectId: string
  /** Project title for status-bar copy. */
  title: string
}

/** End-of-run message shown after a run finishes. */
export interface ProjectThumbNotice {
  state: 'done' | 'error'
  detail: string
  projectId: string
}

interface ProjectThumbsContextValue {
  jobs: ProjectThumbJob[]
  notice: ProjectThumbNotice | null
  /**
   * Generate (or revise) a project's cover image. Owned here — not by the
   * project page — so the run and its status-bar chip survive navigating
   * away; the finished image is persisted onto the project right here for
   * the same reason. Rejects when a run for the project is already in
   * flight.
   */
  generate: (
    projectId: string,
    title: string,
    feedback: string,
    currentFile: string,
  ) => Promise<main.Project>
  /** Clear the lingering done/error notice — clicking it counts as read. */
  dismissNotice: () => void
}

const ProjectThumbsContext = createContext<
  ProjectThumbsContextValue | undefined
>(undefined)

/**
 * How long the done/error notice lingers: generation often finishes while
 * the producer is elsewhere, so the green chip stays around long enough to
 * be seen and clicked (like the other AI status chips).
 */
const NOTICE_MS = 600_000

export function ProjectThumbsProvider({children}: {children: ReactNode}) {
  const [jobs, setJobs] = useState<ProjectThumbJob[]>([])
  const [notice, setNotice] = useState<ProjectThumbNotice | null>(null)
  const noticeTimer = useRef<number>()

  const showNotice = useCallback((n: ProjectThumbNotice) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(n)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  const generate = useCallback(
    async (
      projectId: string,
      title: string,
      feedback: string,
      currentFile: string,
    ) => {
      let added = false
      setJobs((prev) => {
        if (prev.some((j) => j.projectId === projectId)) return prev
        added = true
        return [...prev, {projectId, title}]
      })
      if (!added) {
        throw new Error('an image is already being generated for this project')
      }
      // A fresh run supersedes the previous run's lingering notice.
      window.clearTimeout(noticeTimer.current)
      setNotice(null)
      try {
        const t = await GenerateProjectThumbnail(
          projectId,
          feedback,
          currentFile,
        )
        // Persist here, not on the page: the page may be long gone.
        const saved = await SetProjectThumbnail(projectId, t.file)
        showNotice({
          state: 'done',
          detail: `Project image ready — ${title || 'project'}`,
          projectId,
        })
        return saved
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : ''
        showNotice({
          state: 'error',
          detail: message
            ? `Project image failed — ${message}`
            : `Project image failed — ${title || 'project'}`,
          projectId,
        })
        throw err
      } finally {
        setJobs((prev) => prev.filter((j) => j.projectId !== projectId))
      }
    },
    [showNotice],
  )

  const dismissNotice = useCallback(() => {
    window.clearTimeout(noticeTimer.current)
    setNotice(null)
  }, [])

  const value = useMemo<ProjectThumbsContextValue>(
    () => ({jobs, notice, generate, dismissNotice}),
    [jobs, notice, generate, dismissNotice],
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

import {CalendarClock, FolderKanban, Layers} from 'lucide-react'
import {PageHeader} from '../components/PageHeader'

/**
 * The Projects section — a placeholder for now. Projects will be creatable
 * bodies of work (a launch, a build, a campaign) that stream plans reference,
 * the way plans already reference content series.
 */
export function Projects() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader description="Group your work into projects and reference them when planning a stream." />

      <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-edge bg-surface p-10 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/15 text-accent"
        >
          <FolderKanban size={28} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-fg">
            Projects are coming soon
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
            This is where you will create projects — a launch, a build, a
            campaign — and attach them to stream plans so every broadcast
            carries its project's context.
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-3 py-1">
            <CalendarClock size={12} aria-hidden />
            Referenced when planning a stream
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg px-3 py-1">
            <Layers size={12} aria-hidden />
            Works alongside content series
          </span>
        </div>
      </div>
    </div>
  )
}

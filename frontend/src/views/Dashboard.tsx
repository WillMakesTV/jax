import {CalendarClock, Clapperboard, Radio} from 'lucide-react'
import {PageHeader} from '../components/PageHeader'
import type {ViewId} from '../navigation'

interface DashboardProps {
  onNavigate: (view: ViewId) => void
}

interface SummaryCard {
  label: string
  value: string
  hint: string
}

const SUMMARY: SummaryCard[] = [
  {label: 'Planned streams', value: '0', hint: 'No streams planned yet'},
  {label: 'Videos', value: '0', hint: 'No videos yet'},
  {label: 'Channel sources', value: '0', hint: 'No sources connected'},
]

interface QuickAction {
  view: ViewId
  title: string
  description: string
  icon: typeof Radio
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    view: 'stream-planning',
    title: 'Plan a stream',
    description: 'Outline your next broadcast and its channel source.',
    icon: CalendarClock,
  },
  {
    view: 'videos',
    title: 'Manage videos',
    description: 'Review and organise your produced video content.',
    icon: Clapperboard,
  },
]

export function Dashboard({onNavigate}: DashboardProps) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Dashboard"
        description="An overview of your brand production workspace."
      />

      <section
        aria-label="Summary"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        {SUMMARY.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-edge bg-surface p-5"
          >
            <p className="text-sm font-medium text-fg-muted">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-fg">{card.value}</p>
            <p className="mt-1 text-xs text-fg-muted">{card.hint}</p>
          </div>
        ))}
      </section>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Quick actions
      </h2>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.view}
              type="button"
              onClick={() => onNavigate(action.view)}
              className="flex items-start gap-4 rounded-xl border border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
              >
                <Icon size={20} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-fg">
                  {action.title}
                </span>
                <span className="mt-1 block text-sm text-fg-muted">
                  {action.description}
                </span>
              </span>
            </button>
          )
        })}
      </section>
    </div>
  )
}

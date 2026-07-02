import {CalendarClock} from 'lucide-react'
import {PageHeader} from '../components/PageHeader'
import {Placeholder} from '../components/Placeholder'

export function StreamPlanning() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Stream Planning"
        description="Plan upcoming streams and link them to a channel source."
      />
      <Placeholder
        icon={CalendarClock}
        message="Stream planning is coming soon. You'll be able to create and schedule streams here."
      />
    </div>
  )
}

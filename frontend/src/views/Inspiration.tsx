import {Lightbulb} from 'lucide-react'
import {PageHeader} from '../components/PageHeader'
import {Placeholder} from '../components/Placeholder'

/**
 * The Inspiration section: the place ideas land before they become plans —
 * references, clips, and prompts worth coming back to. A placeholder for now;
 * the collection itself lands later.
 */
export function Inspiration() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader description="Where ideas land before they become plans — references, clips, and prompts worth keeping." />
      <Placeholder
        icon={Lightbulb}
        message="Inspiration is on the way: a place to collect the ideas, references, and clips a stream or video grows out of."
      />
    </div>
  )
}

import {Clapperboard} from 'lucide-react'
import {PageHeader} from '../components/PageHeader'
import {Placeholder} from '../components/Placeholder'

export function Videos() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Videos"
        description="Browse and manage your produced video content."
      />
      <Placeholder
        icon={Clapperboard}
        message="Video management is coming soon. Your produced videos will appear here."
      />
    </div>
  )
}

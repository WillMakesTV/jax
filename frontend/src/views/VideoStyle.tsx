import {Palette} from 'lucide-react'
import {PageHeader} from '../components/PageHeader'
import {Placeholder} from '../components/Placeholder'

/**
 * Video Style: how our videos are meant to look and sound — the reference the
 * planning and editing work is held to. Not built yet; the page exists so the
 * Videos page's CTA has somewhere to land.
 */
export function VideoStyle() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader description="The look and sound our videos are cut to." />
      <Placeholder
        icon={Palette}
        message="Video style lives here soon: the pacing, the titles, the colour and the sound every video is held to."
      />
    </div>
  )
}

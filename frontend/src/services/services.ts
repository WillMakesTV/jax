import {ObsIcon, TwitchIcon, YouTubeIcon} from '../components/brand/BrandIcons'

export type ServiceId = 'twitch' | 'youtube' | 'obs'

interface BrandIconComponent {
  (props: {size?: number; className?: string; title?: string}): JSX.Element
}

export interface ServiceDef {
  id: ServiceId
  name: string
  description: string
  /** Brand colour used for the logo tile background (logo is rendered white). */
  brand: string
  Icon: BrandIconComponent
}

/** Display name for a platform/service id, falling back to the id itself. */
export function platformName(id: string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id
}

export const SERVICES: ServiceDef[] = [
  {
    id: 'twitch',
    name: 'Twitch',
    description: 'Stream and account access on Twitch.tv.',
    brand: '#9146FF',
    Icon: TwitchIcon,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Connect your YouTube channel.',
    brand: '#FF0000',
    Icon: YouTubeIcon,
  },
  {
    id: 'obs',
    name: 'OBS Studio',
    description: 'Control OBS over its local WebSocket.',
    brand: '#302E31',
    Icon: ObsIcon,
  },
]

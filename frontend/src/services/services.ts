import {
  AnthropicIcon,
  ObsIcon,
  TwitchIcon,
  YouTubeIcon,
} from '../components/brand/BrandIcons'

export type ServiceId = 'twitch' | 'youtube' | 'obs' | 'anthropic'

/**
 * Coarse grouping used to split services across settings tabs: 'ai' services
 * render on the AI tab, everything else on Services.
 */
export type ServiceCategoryId = 'channels' | 'production' | 'ai'

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
  category: ServiceCategoryId
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
    category: 'channels',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Connect your YouTube channel.',
    brand: '#FF0000',
    Icon: YouTubeIcon,
    category: 'channels',
  },
  {
    id: 'obs',
    name: 'OBS Studio',
    description: 'Control OBS over its local WebSocket.',
    brand: '#302E31',
    Icon: ObsIcon,
    category: 'production',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude account or API key for AI features.',
    brand: '#D97757',
    Icon: AnthropicIcon,
    category: 'ai',
  },
]

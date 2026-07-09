import {
  AnthropicIcon,
  FacebookIcon,
  XIcon,
  TikTokIcon,
  InstagramIcon,
  KickIcon,
  ObsIcon,
  OpenAIIcon,
  TwitchIcon,
  YouTubeIcon,
} from '../components/brand/BrandIcons'

export type ServiceId =
  | 'twitch'
  | 'youtube'
  | 'kick'
  | 'facebook'
  | 'instagram'
  | 'x'
  | 'tiktok'
  | 'obs'
  | 'anthropic'
  | 'openai'

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
  /**
   * Keep the connected account identifier (e.g. an email) off the service
   * card and masked behind an eye toggle in the connect dialog.
   */
  privateAccount?: boolean
}

/** Display name for a platform/service id, falling back to the id itself. */
export function platformName(id: string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id
}

/**
 * Whether any broadcast channel (category 'channels') is connected — the
 * one place the "is a channel connected?" chain lives, so adding a platform
 * never means touching every consumer again.
 */
export function anyChannelConnected(
  statuses: Partial<Record<ServiceId, {connected: boolean}>>,
): boolean {
  return SERVICES.some(
    (s) => s.category === 'channels' && statuses[s.id]?.connected,
  )
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
    id: 'kick',
    name: 'Kick',
    description: 'Connect your Kick.com channel.',
    brand: '#53FC18',
    Icon: KickIcon,
    category: 'channels',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Connect a Facebook Page for live videos.',
    brand: '#0866FF',
    Icon: FacebookIcon,
    category: 'channels',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Instagram Live via your Facebook Page.',
    brand: '#E4405F',
    Icon: InstagramIcon,
    category: 'channels',
  },
  {
    id: 'x',
    name: 'X',
    description: 'Post go-live announcements to X.',
    brand: '#000000',
    Icon: XIcon,
    category: 'channels',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Post go-live announcements to TikTok.',
    brand: '#010101',
    Icon: TikTokIcon,
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
    privateAccount: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'ChatGPT account or API key for AI features.',
    brand: '#000000',
    Icon: OpenAIIcon,
    category: 'ai',
    privateAccount: true,
  },
]

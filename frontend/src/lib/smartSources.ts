import {SetSetting} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {type LiveEventItem} from '../events/EventsProvider'
import {type ObsMetrics} from '../live/LiveDataProvider'
import {formatCompact, formatDurationMs} from './format'
import {SETTING_KEYS, loadSetting, saveSetting} from './settings'

// ---------------------------------------------------------------------------
// Smart Sources
//
// A "smart source" is an OBS Text (GDI+) source whose text the app renders
// from a template of tokens (e.g. "{viewers} watching") replaced with live
// values and pushed into OBS. Configs are a map of source name → template.
// ---------------------------------------------------------------------------

/** OBS input kinds that are GDI+ text sources (Windows). */
export const TEXT_GDIPLUS_KINDS = new Set([
  'text_gdiplus_v3',
  'text_gdiplus_v2',
  'text_gdiplus',
])

export interface SmartSource {
  template: string
}

// The on-air episode's identity flows through two auto-managed custom tokens:
// going live with a planned stream (and the "Update episode info" routine
// step) writes their values, and any smart-source template referencing them
// renders through the same pipeline as every other token — one consistent
// mechanism instead of per-series source mappings.
export const EPISODE_TITLE_TOKEN = 'episode_title'
export const EPISODE_NUMBER_TOKEN = 'episode_number'

/** Window event that asks the app-wide updater to re-render immediately
 *  (e.g. right after a routine step rewrote the episode tokens). */
export const SMART_SOURCES_REFRESH_EVENT = 'jax:smart-sources-refresh'

/** One insertable token and what it resolves to. */
export const SMART_TOKENS: {token: string; label: string}[] = [
  {token: '{viewers}', label: 'Total live viewers'},
  {token: '{live_channels}', label: 'Number of live channels'},
  {token: '{uptime}', label: 'Stream uptime'},
  {token: '{title}', label: 'Stream title'},
  {token: '{category}', label: 'Category / game'},
  {token: '{channel}', label: 'Channel name'},
  {token: '{followers}', label: 'Followers'},
  {token: '{subscribers}', label: 'Subscribers'},
  {token: '{latest_follower}', label: 'Latest follower'},
  {token: '{latest_sub}', label: 'Latest subscriber'},
  {token: '{time}', label: 'Current time'},
  {token: '{date}', label: 'Current date'},
  {token: `{${EPISODE_TITLE_TOKEN}}`, label: "On-air episode's title (auto-updated from the stream plan)"},
  {token: `{${EPISODE_NUMBER_TOKEN}}`, label: "On-air episode's number (auto-updated from the stream plan)"},
]

const timeFmt = new Intl.DateTimeFormat('en', {hour: 'numeric', minute: '2-digit'})
const dateFmt = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** Sanitize a custom token name to the chars the render regex accepts. */
export function sanitizeTokenName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z_]/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Load user-defined custom tokens (bare name → static value). */
export async function loadCustomTokens(): Promise<Record<string, string>> {
  const raw = (await loadSetting(SETTING_KEYS.obsSmartTokens)) ?? ''
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/** Persist the custom-token map. */
export function saveCustomTokens(map: Record<string, string>): void {
  saveSetting(SETTING_KEYS.obsSmartTokens, JSON.stringify(map))
}

/**
 * Write the on-air episode's title/number into the auto-managed episode
 * tokens, awaiting the persisted write so callers can render right after.
 * Empty values leave the existing token alone. Returns true when a token
 * value actually changed.
 */
export async function updateEpisodeTokens(
  title: string,
  episode: number,
): Promise<boolean> {
  const custom = await loadCustomTokens()
  const next = {...custom}
  if (title) next[EPISODE_TITLE_TOKEN] = title
  if (episode > 0) next[EPISODE_NUMBER_TOKEN] = String(episode)
  if (
    next[EPISODE_TITLE_TOKEN] === custom[EPISODE_TITLE_TOKEN] &&
    next[EPISODE_NUMBER_TOKEN] === custom[EPISODE_NUMBER_TOKEN]
  ) {
    return false
  }
  await SetSetting(SETTING_KEYS.obsSmartTokens, JSON.stringify(next))
  return true
}

/** Resolve every token to its current value from the live app state. */
export function computeTokenValues(
  platforms: main.LiveStream[],
  obs: ObsMetrics | null,
  events: LiveEventItem[],
  now: Date,
  custom: Record<string, string> = {},
): Record<string, string> {
  const live = platforms.filter((p) => p.live)
  const totalViewers = live.reduce((s, p) => s + p.viewerCount, 0)
  const earliest = live
    .map((p) => Date.parse(p.startedAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)[0]
  const uptimeMs =
    earliest !== undefined
      ? now.getTime() - earliest
      : obs?.outputActive
        ? obs.outputDuration
        : null

  const detail = (label: string): string => {
    for (const p of platforms) {
      const d = p.details.find((x) => x.label === label)
      if (d) return d.value
    }
    return ''
  }
  const latestBy = (types: string[]): string => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (types.includes(events[i].type)) return events[i].author
    }
    return ''
  }

  const values: Record<string, string> = {
    '{viewers}': live.length ? formatCompact(totalViewers) : '0',
    '{live_channels}': String(live.length),
    '{uptime}': uptimeMs !== null ? formatDurationMs(uptimeMs) : '00:00',
    '{title}': live.find((p) => p.title)?.title ?? '',
    '{category}': live.find((p) => p.category)?.category ?? '',
    '{channel}': platforms.find((p) => p.channelName)?.channelName ?? '',
    '{followers}': detail('Followers'),
    '{subscribers}': detail('Subscribers'),
    '{latest_follower}': latestBy(['follow']),
    '{latest_sub}': latestBy(['sub', 'resub', 'gift', 'member']),
    '{time}': timeFmt.format(now),
    '{date}': dateFmt.format(now),
  }
  // Custom tokens (bare name → value); built-ins win on any name clash.
  for (const [name, value] of Object.entries(custom)) {
    const key = `{${name}}`
    if (!(key in values)) values[key] = value
  }
  return values
}

/** Replace {tokens} in a template with their values (unknown tokens kept). */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{[a-z_]+\}/g, (m) => values[m] ?? m)
}

/** Load the smart-source map (source name → config). */
export async function loadSmartSources(): Promise<Record<string, SmartSource>> {
  const raw = (await loadSetting(SETTING_KEYS.obsSmartSources)) ?? ''
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, SmartSource>)
      : {}
  } catch {
    return {}
  }
}

/** Persist the smart-source map. */
export function saveSmartSources(map: Record<string, SmartSource>): void {
  saveSetting(SETTING_KEYS.obsSmartSources, JSON.stringify(map))
}

/** A sensible starter template for a newly designated smart source. */
export const DEFAULT_SMART_TEMPLATE = '{viewers} watching · up {uptime}'

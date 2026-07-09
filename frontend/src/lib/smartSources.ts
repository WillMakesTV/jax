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

// ---------------------------------------------------------------------------
// Episode text sources
//
// The on-air episode's identity is written directly into two designated OBS
// Text (GDI+) sources: one shows the episode's title verbatim, the other
// "Episode N". The mapping (chosen on a series' edit page) lives in its own
// setting — no tokens or templates involved, so nothing in OBS needs to keep
// a placeholder; the app always writes fresh text from the current plan.
// ---------------------------------------------------------------------------

export interface EpisodeTextSources {
  /** OBS text source that shows the episode's title ('' = unmapped). */
  title: string
  /** OBS text source that shows "Episode N" ('' = unmapped). */
  number: string
}

/** Load the episode-info source mapping. */
export async function loadEpisodeTextSources(): Promise<EpisodeTextSources> {
  const raw = (await loadSetting(SETTING_KEYS.obsEpisodeSources)) ?? ''
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<EpisodeTextSources>
      return {title: parsed.title ?? '', number: parsed.number ?? ''}
    } catch {
      // Unreadable; fall through to the empty mapping.
    }
  }
  return {title: '', number: ''}
}

/** Persist the episode-info source mapping. */
export function saveEpisodeTextSources(map: EpisodeTextSources): void {
  saveSetting(SETTING_KEYS.obsEpisodeSources, JSON.stringify(map))
}

/** How an episode number reads on screen. */
export function episodeNumberText(episode: number): string {
  return episode > 0 ? `Episode ${episode}` : ''
}

/** The minimal obsRequest shape (mirrors the ServicesProvider's). */
type ObsPush = (type: string, data?: Record<string, unknown>) => Promise<unknown>

/**
 * Write an episode's info directly into the mapped OBS text sources: the
 * title verbatim, the number as "Episode N". Empty values and unmapped
 * sources are left alone. Returns whether anything was written.
 */
export async function pushEpisodeText(
  obsRequest: ObsPush,
  title: string,
  episode: number,
): Promise<boolean> {
  const map = await loadEpisodeTextSources()
  const writes: Array<[string, string]> = []
  if (map.title && title) writes.push([map.title, title])
  if (map.number && episode > 0) {
    writes.push([map.number, episodeNumberText(episode)])
  }
  for (const [name, text] of writes) {
    await obsRequest('SetInputSettings', {
      inputName: name,
      inputSettings: {text},
    })
  }
  return writes.length > 0
}

/**
 * One-shot migration from the retired episode tokens: a smart source whose
 * template references {episode_title}/{episode_number} becomes the direct
 * episode mapping (unless one is already chosen). Sources holding the direct
 * mapping leave the smart-source map — they are written directly, not
 * rendered — and the auto-managed token values leave the custom-token store.
 * Idempotent; the app-wide updater runs it on mount.
 */
export async function migrateEpisodeTokenConfig(): Promise<void> {
  const sources = await loadSmartSources()
  const referencing = (token: string, exclude: string) =>
    Object.keys(sources).find(
      (n) => n !== exclude && sources[n].template.includes(`{${token}}`),
    ) ?? ''
  const title = referencing('episode_title', '')
  const number = referencing('episode_number', title)

  const map = await loadEpisodeTextSources()
  const next = {
    title: map.title || title,
    number: map.number || number,
  }
  if (next.title !== map.title || next.number !== map.number) {
    saveEpisodeTextSources(next)
  }
  // Mapped sources get their text written directly; a leftover smart-source
  // entry would render a template (possibly still holding a dead token) over
  // the top of it.
  let changed = false
  for (const name of [title, number, next.title, next.number]) {
    if (name && name in sources) {
      delete sources[name]
      changed = true
    }
  }
  if (changed) saveSmartSources(sources)

  const custom = await loadCustomTokens()
  if ('episode_title' in custom || 'episode_number' in custom) {
    const cleaned = {...custom}
    delete cleaned.episode_title
    delete cleaned.episode_number
    saveCustomTokens(cleaned)
  }
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
      const d = (p.details ?? []).find((x) => x.label === label)
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

/** Whether the text references any {token}. */
export function containsToken(text: string): boolean {
  return /\{[a-z_]+\}/.test(text)
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

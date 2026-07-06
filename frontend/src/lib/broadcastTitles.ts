import {SETTING_KEYS, loadSetting} from './settings'

// ---------------------------------------------------------------------------
// Broadcast titles
//
// The title a broadcast actually goes out under follows the convention seen
// in past streams: an episodic plan is prefixed with its episode number
// ("Episode 6 | Building the planner"), and YouTube additionally carries a
// configurable live marker ("🔴 LIVE: Episode 6 | Building the planner").
// Mirrors broadcastBaseTitle / youtubeLivePrefix in planning.go.
// ---------------------------------------------------------------------------

/** The YouTube prefix used when none is configured; mirrors planning.go. */
export const DEFAULT_YOUTUBE_LIVE_PREFIX = '🔴 LIVE: '

/** The base broadcast title: "Episode {n} | {title}" for episodic plans. */
export function broadcastBaseTitle(title: string, episode: number): string {
  return episode > 0 ? `Episode ${episode} | ${title}` : title
}

/** The title a specific platform's broadcast will use. */
export function platformBroadcastTitle(
  platform: string,
  baseTitle: string,
  youtubePrefix: string,
): string {
  return platform === 'youtube' ? youtubePrefix + baseTitle : baseTitle
}

/** Load the configured YouTube live prefix (blank = the default). */
export async function loadYouTubeLivePrefix(): Promise<string> {
  const stored = await loadSetting(SETTING_KEYS.youtubeLivePrefix)
  return stored?.trim() ? stored : DEFAULT_YOUTUBE_LIVE_PREFIX
}

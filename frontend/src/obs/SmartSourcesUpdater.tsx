import {useEffect, useRef} from 'react'
import {
  GetActiveStreamSession,
  GetLiveStreamMeta,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {useEvents} from '../events/EventsProvider'
import {useLiveData} from '../live/LiveDataProvider'
import {
  computeTokenValues,
  loadCustomTokens,
  loadSmartSources,
  renderTemplate,
  SMART_SOURCES_REFRESH_EVENT,
  updateEpisodeTokens,
  type SmartSource,
} from '../lib/smartSources'
import {useServices} from '../services/ServicesProvider'

/** How often smart-source text is re-rendered and pushed to OBS. */
const PUSH_MS = 2_000

/** The on-air episode: what the episode-info smart sources display. */
interface EpisodeContext {
  seriesId: string
  title: string
  episode: number
}

/**
 * App-wide updater (renders nothing): while OBS is connected, renders each
 * smart source's template with live token values and pushes changed text into
 * its OBS Text (GDI+) source over the WebSocket.
 *
 * The on-air episode's identity flows through the auto-managed episode tokens
 * ({episode_title}/{episode_number}): each tick resolves the episode context —
 * the active stream session (going live with a plan), falling back to the
 * live broadcast's series/episode assignment — and keeps the tokens' stored
 * values current, so every template referencing them stays consistent.
 */
export function SmartSourcesUpdater() {
  const {platforms, obs, obsConnected, sourcesRev} = useLiveData()
  const {events} = useEvents()
  const {obsRequest} = useServices()

  const configRef = useRef<Record<string, SmartSource>>({})
  const customRef = useRef<Record<string, string>>({})
  const liveMetaRef = useRef<{startedAt: string; meta: main.LiveStreamMeta} | null>(
    null,
  )
  const lastPushed = useRef<Record<string, string>>({})
  const dataRef = useRef({platforms, obs, events})
  dataRef.current = {platforms, obs, events}

  // Reload the smart-source config and custom tokens on mount and on change.
  useEffect(() => {
    let cancelled = false
    loadSmartSources().then((c) => {
      if (!cancelled) configRef.current = c
    })
    loadCustomTokens().then((c) => {
      if (!cancelled) customRef.current = c
    })
    return () => {
      cancelled = true
    }
  }, [sourcesRev])

  useEffect(() => {
    if (!obsConnected) {
      lastPushed.current = {}
      return
    }

    const push = async (name: string, text: string) => {
      if (lastPushed.current[name] === text) return
      try {
        await obsRequest('SetInputSettings', {
          inputName: name,
          inputSettings: {text},
        })
        lastPushed.current[name] = text
      } catch {
        // Source may be gone; drop the memo so a later retry re-pushes.
        delete lastPushed.current[name]
      }
    }

    // Resolve the on-air episode: the active stream session first, else the
    // live broadcast's series/episode assignment (memoised per stream).
    const episodeContext = async (): Promise<EpisodeContext | null> => {
      try {
        const session = await GetActiveStreamSession()
        if (session.active && session.seriesId) {
          return {
            seriesId: session.seriesId,
            title: session.title,
            episode: session.episode,
          }
        }
      } catch {
        // Backend unavailable; fall through to the live assignment.
      }
      const {platforms} = dataRef.current
      const live = platforms.filter((p) => p.live)
      if (live.length === 0) return null
      const startedAt =
        live.map((p) => p.startedAt).filter(Boolean).sort()[0] ?? ''
      if (!startedAt) return null
      if (liveMetaRef.current?.startedAt !== startedAt) {
        try {
          const meta = await GetLiveStreamMeta(startedAt)
          liveMetaRef.current = {startedAt, meta}
        } catch {
          return null
        }
      }
      const meta = liveMetaRef.current.meta
      if (!meta.seriesId) return null
      return {
        seriesId: meta.seriesId,
        title: live.find((p) => p.title)?.title ?? '',
        episode: meta.episodeNumber,
      }
    }

    const tick = async () => {
      const cfg = configRef.current
      const {platforms, obs, events} = dataRef.current
      const names = Object.keys(cfg)
      if (names.length === 0) return

      // Keep the auto-managed episode tokens current with the on-air episode
      // before rendering, so templates referencing them are never stale.
      const ctx = await episodeContext()
      if (ctx && (await updateEpisodeTokens(ctx.title, ctx.episode))) {
        customRef.current = await loadCustomTokens()
      }

      const values = computeTokenValues(
        platforms,
        obs,
        events,
        new Date(),
        customRef.current,
      )
      for (const name of names) {
        await push(name, renderTemplate(cfg[name].template, values))
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), PUSH_MS)
    // A routine step that rewrites the episode tokens asks for an immediate
    // re-render instead of waiting out the interval.
    const onRefresh = () => {
      void loadCustomTokens().then((c) => {
        customRef.current = c
        void tick()
      })
    }
    window.addEventListener(SMART_SOURCES_REFRESH_EVENT, onRefresh)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(SMART_SOURCES_REFRESH_EVENT, onRefresh)
    }
  }, [obsConnected, obsRequest])

  return null
}

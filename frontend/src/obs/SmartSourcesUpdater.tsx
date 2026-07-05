import {useEffect, useRef} from 'react'
import {
  GetActiveStreamSession,
  GetContentSeries,
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
 * Episodic series can additionally map the on-air episode's title and number
 * onto OBS text sources ("Use Smart Sources for Episode Information" on the
 * series). The episode context comes from the active stream session (going
 * live with a plan), falling back to the live broadcast's series/episode
 * assignment.
 */
export function SmartSourcesUpdater() {
  const {platforms, obs, obsConnected, sourcesRev} = useLiveData()
  const {events} = useEvents()
  const {obsRequest} = useServices()

  const configRef = useRef<Record<string, SmartSource>>({})
  const customRef = useRef<Record<string, string>>({})
  const seriesRef = useRef<main.ContentSeries[]>([])
  const liveMetaRef = useRef<{startedAt: string; meta: main.LiveStreamMeta} | null>(
    null,
  )
  const lastPushed = useRef<Record<string, string>>({})
  const dataRef = useRef({platforms, obs, events})
  dataRef.current = {platforms, obs, events}

  // Reload the smart-source config, custom tokens, and the series' episode
  // mappings on mount and on change.
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

  // The series' episode mappings are edited on their own page (no sourcesRev
  // bump), so refresh them on a slow interval as well as on mount.
  useEffect(() => {
    const load = () => {
      GetContentSeries()
        .then((s) => {
          seriesRef.current = (s ?? []).filter(
            (x) =>
              x.smartEpisodeInfo &&
              (x.episodeTitleSource || x.episodeNumberSource),
          )
        })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [])

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
      if (names.length > 0) {
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

      // Episode-info mappings for the series currently on the air.
      if (seriesRef.current.length > 0) {
        const ctx = await episodeContext()
        const series = ctx
          ? seriesRef.current.find((s) => s.id === ctx.seriesId)
          : undefined
        if (ctx && series) {
          if (series.episodeTitleSource && ctx.title) {
            await push(series.episodeTitleSource, ctx.title)
          }
          if (series.episodeNumberSource && ctx.episode > 0) {
            await push(series.episodeNumberSource, String(ctx.episode))
          }
        }
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), PUSH_MS)
    return () => window.clearInterval(id)
  }, [obsConnected, obsRequest])

  return null
}

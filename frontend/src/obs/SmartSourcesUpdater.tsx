import {useEffect, useRef} from 'react'
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

/**
 * App-wide updater (renders nothing): while OBS is connected, renders each
 * smart source's template with live token values and pushes changed text into
 * its OBS Text (GDI+) source over the WebSocket.
 */
export function SmartSourcesUpdater() {
  const {platforms, obs, obsConnected, sourcesRev} = useLiveData()
  const {events} = useEvents()
  const {obsRequest} = useServices()

  const configRef = useRef<Record<string, SmartSource>>({})
  const customRef = useRef<Record<string, string>>({})
  const lastPushed = useRef<Record<string, string>>({})
  const dataRef = useRef({platforms, obs, events})
  dataRef.current = {platforms, obs, events}

  // Reload the smart-source config + custom tokens on mount and on change.
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
    const tick = async () => {
      const cfg = configRef.current
      const names = Object.keys(cfg)
      if (names.length === 0) return
      const {platforms, obs, events} = dataRef.current
      const values = computeTokenValues(
        platforms,
        obs,
        events,
        new Date(),
        customRef.current,
      )
      for (const name of names) {
        const text = renderTemplate(cfg[name].template, values)
        if (lastPushed.current[name] === text) continue
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
    }
    void tick()
    const id = window.setInterval(() => void tick(), PUSH_MS)
    return () => window.clearInterval(id)
  }, [obsConnected, obsRequest])

  return null
}

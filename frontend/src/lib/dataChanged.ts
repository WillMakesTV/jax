import {useEffect, useRef} from 'react'
import {EventsOn} from '../../wailsjs/runtime/runtime'

/**
 * Re-run reload whenever the backend reports a write to one of the given
 * storage scopes (the "data:changed" event, emitted for every settings-key
 * write — see store.go). This is how an open page picks up data that changed
 * behind its back: an MCP client planning a stream, a background job landing
 * a result, another view saving.
 *
 * Scopes are storage keys ("planned_streams", "video_plans", …) or table
 * names hooked explicitly ("dev_ai_debug").
 */
export function useDataChanged(scopes: string[], reload: () => void) {
  // The latest reload runs without re-subscribing on every render.
  const ref = useRef(reload)
  ref.current = reload
  const joined = scopes.join('|')
  useEffect(() => {
    const wanted = new Set(joined.split('|'))
    return EventsOn('data:changed', (scope: string) => {
      if (wanted.has(scope)) ref.current()
    })
  }, [joined])
}

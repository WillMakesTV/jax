import {useEffect, useState} from 'react'
import {useLiveData} from '../live/LiveDataProvider'
import {useServices} from '../services/ServicesProvider'

/** How often the current program scene name is re-checked. */
const SCENE_POLL_MS = 1_000

interface ProgramScene {
  currentProgramSceneName: string
}

interface Screenshot {
  imageData: string
}

/**
 * Poll OBS's program-output screenshot over the WebSocket at a target frame
 * interval. Self-pacing: each frame schedules the next only after its capture
 * finishes, so a slow capture never piles requests on the socket. Returns the
 * latest JPEG data URI and the current program scene name.
 */
export function useObsPreview(frameMs: number): {
  preview: string
  sceneName: string
} {
  const {obsRequest} = useServices()
  const {obsConnected} = useLiveData()
  const [preview, setPreview] = useState('')
  const [sceneName, setSceneName] = useState('')

  useEffect(() => {
    if (!obsConnected) {
      setPreview('')
      setSceneName('')
      return
    }
    let cancelled = false
    let timer: number | undefined
    let scene = ''
    let lastSceneCheck = 0

    const tick = async () => {
      const start = performance.now()
      try {
        if (!scene || start - lastSceneCheck > SCENE_POLL_MS) {
          const s = await obsRequest<ProgramScene>('GetCurrentProgramScene')
          scene = s.currentProgramSceneName
          lastSceneCheck = start
          if (!cancelled) setSceneName(scene)
        }
        const shot = await obsRequest<Screenshot>('GetSourceScreenshot', {
          sourceName: scene,
          imageFormat: 'jpg',
          imageWidth: 640,
          imageCompressionQuality: 60,
        })
        if (!cancelled) setPreview(shot.imageData)
      } catch {
        if (!cancelled) {
          setPreview('')
          scene = '' // re-resolve; the scene may have been renamed/removed
        }
      }
      if (!cancelled) {
        const elapsed = performance.now() - start
        timer = window.setTimeout(() => void tick(), Math.max(0, frameMs - elapsed))
      }
    }

    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [obsConnected, obsRequest, frameMs])

  return {preview, sceneName}
}

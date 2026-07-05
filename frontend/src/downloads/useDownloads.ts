import {useCallback, useEffect, useMemo, useState} from 'react'
import {GetDownloads} from '../../wailsjs/go/main/App'
import {EventsOn} from '../../wailsjs/runtime/runtime'
import {main} from '../../wailsjs/go/models'

/**
 * Tracks the videos that have been downloaded to disk (each carries its
 * manifest metadata and a `/media/...` URL for playback). Refreshes whenever a
 * download completes. `byUrl` maps each source VOD URL to its download so a
 * broadcast can tell whether it is available locally.
 */
export function useDownloads() {
  const [downloads, setDownloads] = useState<main.DownloadedVideo[]>([])

  const refresh = useCallback(() => {
    GetDownloads()
      .then((d) => setDownloads(d ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const off = EventsOn('download:exit', (detail: string) => {
      // Only a successful download (empty detail) adds a new file.
      if (!detail) refresh()
    })
    return () => off()
  }, [refresh])

  const byUrl = useMemo(() => {
    const map = new Map<string, main.DownloadedVideo>()
    for (const d of downloads) {
      for (const u of d.urls ?? []) map.set(u, d)
    }
    return map
  }, [downloads])

  return {downloads, byUrl, refresh}
}

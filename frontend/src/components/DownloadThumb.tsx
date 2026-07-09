import {useEffect, useRef, useState} from 'react'
import {GenerateDownloadThumbnail} from '../../wailsjs/go/main/App'

/**
 * Self-healing thumbnail for a downloaded video. Platform thumbnail URLs
 * expire (Twitch VOD thumbs disappear with the VOD); when the stored URL is
 * missing or fails to load, a poster frame is extracted from the local video
 * file (GenerateDownloadThumbnail) and shown instead. The generated frame is
 * kept in the download's folder, so every later render uses it directly.
 * Renders nothing while there is no image to show.
 */
export function DownloadThumb({
  subfolder,
  src,
  alt = '',
  className,
}: {
  /** The download's subfolder — the key for generating a local frame. */
  subfolder: string
  /** The stored thumbnail URL; empty triggers generation immediately. */
  src: string
  alt?: string
  className?: string
}) {
  const [current, setCurrent] = useState(src)
  // One generation attempt per download; a failure (e.g. ffmpeg missing)
  // falls back to rendering nothing rather than retrying in a loop.
  const attempted = useRef(false)

  useEffect(() => {
    attempted.current = false
    setCurrent(src)
  }, [src, subfolder])

  const generate = () => {
    if (attempted.current) return
    attempted.current = true
    setCurrent('')
    GenerateDownloadThumbnail(subfolder)
      .then((url) => {
        if (url) setCurrent(url)
      })
      .catch(() => {})
  }

  // A download with no stored thumbnail at all heals on mount.
  useEffect(() => {
    if (!src) generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, subfolder])

  if (!current) return null
  return (
    <img
      src={current}
      alt={alt}
      aria-hidden={alt === '' || undefined}
      onError={generate}
      className={className}
    />
  )
}

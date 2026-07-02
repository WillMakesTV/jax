import clsx from 'clsx'
import {User} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useGravatarUrl} from '../lib/gravatar'

interface AvatarProps {
  email: string
  name?: string
  /** Rendered size in pixels. */
  size?: number
  className?: string
}

/**
 * Circular user avatar. Shows the Gravatar photo for the email when one exists,
 * otherwise falls back to a default user icon. Missing Gravatars resolve as a
 * 404 image load, which triggers the fallback.
 */
export function Avatar({email, name, size = 32, className}: AvatarProps) {
  // Request at 2x for crisp rendering on high-DPI displays.
  const url = useGravatarUrl(email, size * 2)
  const [failed, setFailed] = useState(false)

  // Reset the failure flag whenever the resolved URL changes.
  useEffect(() => {
    setFailed(false)
  }, [url])

  const showImage = url && !failed

  return (
    <span
      aria-hidden={!name}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-hover text-fg-muted',
        className,
      )}
      style={{width: size, height: size}}
    >
      {showImage ? (
        <img
          src={url}
          alt={name ? `${name}'s avatar` : 'User avatar'}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <User size={Math.round(size * 0.6)} aria-hidden />
      )}
    </span>
  )
}

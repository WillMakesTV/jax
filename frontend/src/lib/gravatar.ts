import {useEffect, useState} from 'react'

// Basic sanity check so we don't hit the network while the user is still typing
// an address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Compute the Gravatar identifier for an email address: the SHA-256 hash of the
 * trimmed, lower-cased address (Gravatar's current recommended scheme).
 */
export async function gravatarHash(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const data = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Build a Gravatar image URL. `d=404` makes Gravatar return a 404 when no
 * avatar exists for the address, so the caller can fall back to a default icon
 * via the image's `onError` handler.
 */
export function gravatarUrl(hash: string, size: number): string {
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`
}

/**
 * Resolve a Gravatar URL for an email address. Returns `null` while hashing,
 * when the address is empty/invalid, or if hashing is unavailable. The URL uses
 * `d=404`, so consumers should still handle image load errors as "no avatar".
 */
export function useGravatarUrl(email: string, size: number): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = email.trim().toLowerCase()
    if (!EMAIL_RE.test(trimmed) || !crypto?.subtle) {
      setUrl(null)
      return
    }

    let cancelled = false
    gravatarHash(trimmed)
      .then((hash) => {
        if (!cancelled) setUrl(gravatarUrl(hash, size))
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [email, size])

  return url
}

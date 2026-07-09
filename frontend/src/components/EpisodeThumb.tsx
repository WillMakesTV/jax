import {Radio} from 'lucide-react'
import {formatDate} from '../lib/format'

/**
 * Compact past-stream tile used by the video-plan pages: thumbnail with an
 * episode badge, then title and date. The parent supplies the interactive
 * wrapper (a selectable button on the edit page's picker, a card opening the
 * stream's details on the view page).
 */
export function EpisodeThumb({
  title,
  startedAt,
  thumbnailUrl,
  episodeNumber = 0,
}: {
  title: string
  startedAt: string
  thumbnailUrl?: string
  episodeNumber?: number
}) {
  return (
    <>
      <div className="relative">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`${title || 'Untitled stream'} thumbnail`}
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-surface-hover text-fg-muted">
            <Radio size={20} aria-hidden />
          </div>
        )}
        {episodeNumber > 0 && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
            EP {episodeNumber}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="line-clamp-2 text-xs font-semibold text-fg">
          {title || 'Untitled stream'}
        </p>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          {formatDate(startedAt)}
        </p>
      </div>
    </>
  )
}

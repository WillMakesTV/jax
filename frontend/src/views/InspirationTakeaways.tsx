import {Lightbulb, Search} from 'lucide-react'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {
  GetInspirationTakeaways,
  GetInspirationVideos,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {PageHeader} from '../components/PageHeader'
import {useDataChanged} from '../lib/dataChanged'
import {clock, InspirationTabs, TAKEAWAY_KINDS} from './Inspiration'

/**
 * Every takeaway the library holds, from every channel, in one place: the
 * per-channel pages answer "what did we learn from them", this answers "what
 * do we know" — filtered by kind, searched by words, and grouped by kind when
 * the whole library is being read rather than one answer looked up.
 */
export function InspirationTakeaways({
  onOpenOverview,
  onOpenVideo,
}: {
  /** Back to the channel listing. */
  onOpenOverview: () => void
  /** Open the video a takeaway came from. */
  onOpenVideo: (video: main.InspirationVideo) => void
}) {
  const [takeaways, setTakeaways] = useState<main.InspirationTakeawayRef[]>([])
  const [videos, setVideos] = useState<main.InspirationVideo[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [grouped, setGrouped] = useState(true)

  const load = useCallback(() => {
    GetInspirationTakeaways('')
      .then((t) => setTakeaways(t ?? []))
      .catch(() => {})
    GetInspirationVideos('')
      .then((v) => setVideos(v ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  useDataChanged(['inspiration'], load)

  // One count per kind, for the filter row — and so a kind nothing was ever
  // filed under simply is not offered.
  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const t of takeaways) out.set(t.kind, (out.get(t.kind) ?? 0) + 1)
    return out
  }, [takeaways])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return takeaways.filter((t) => {
      if (kind && t.kind !== kind) return false
      if (!needle) return true
      return [t.title, t.detail, t.apply, t.videoTitle]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [takeaways, query, kind])

  // Grouped view: one section per kind, in the order the kinds are defined,
  // with anything unrecognised last.
  const sections = useMemo(() => {
    const order = Object.keys(TAKEAWAY_KINDS)
    const byKind = new Map<string, main.InspirationTakeawayRef[]>()
    for (const t of shown) {
      const list = byKind.get(t.kind)
      if (list) list.push(t)
      else byKind.set(t.kind, [t])
    }
    return [...byKind.entries()].sort(
      ([a], [b]) =>
        (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) -
        (order.indexOf(b) < 0 ? order.length : order.indexOf(b)),
    )
  }, [shown])

  const openVideo = (videoId: string) => {
    const video = videos.find((v) => v.id === videoId)
    if (video) onOpenVideo(video)
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader description="Everything the library has lifted out of the videos it studied, from every channel." />

      <InspirationTabs
        active="takeaways"
        onOverview={onOpenOverview}
        onTakeaways={() => {}}
      />

      {takeaways.length === 0 ? (
        <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
          Nothing lifted out yet — process an inspiration video and its
          takeaways collect here.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="relative flex min-w-56 flex-1 items-center sm:max-w-sm">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-3 text-fg-muted"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search takeaways…"
                aria-label="Search takeaways"
                className="w-full rounded-lg border border-edge bg-bg py-1.5 pl-8 pr-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>

            <div className="flex flex-wrap items-center gap-1.5">
              <KindChip
                label={`All (${takeaways.length})`}
                active={kind === ''}
                onClick={() => setKind('')}
              />
              {Object.entries(TAKEAWAY_KINDS)
                .filter(([id]) => (counts.get(id) ?? 0) > 0)
                .map(([id, label]) => (
                  <KindChip
                    key={id}
                    label={`${label} (${counts.get(id)})`}
                    active={kind === id}
                    onClick={() => setKind(kind === id ? '' : id)}
                  />
                ))}
            </div>

            <button
              type="button"
              onClick={() => setGrouped((g) => !g)}
              aria-pressed={grouped}
              className={
                grouped
                  ? 'ml-auto rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent'
                  : 'ml-auto rounded-lg border border-edge bg-bg px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg'
              }
            >
              Group by type
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
              Nothing matches that search.
            </p>
          ) : grouped ? (
            <div className="flex flex-col gap-6">
              {sections.map(([id, list]) => (
                <section key={id}>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
                    {TAKEAWAY_KINDS[id] ?? id} ({list.length})
                  </h2>
                  <TakeawayGrid takeaways={list} onOpenVideo={openVideo} />
                </section>
              ))}
            </div>
          ) : (
            <TakeawayGrid takeaways={shown} onOpenVideo={openVideo} />
          )}
        </>
      )}
    </div>
  )
}

/** One kind filter. */
function KindChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg'
          : 'rounded-full border border-edge bg-bg px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg'
      }
    >
      {label}
    </button>
  )
}

/**
 * The cards, in a masonry layout — two columns on a medium viewport, four at
 * full width — so a short takeaway does not leave a tall neighbour's gap, the
 * same as the per-channel takeaway lists.
 */
function TakeawayGrid({
  takeaways,
  onOpenVideo,
}: {
  takeaways: main.InspirationTakeawayRef[]
  onOpenVideo: (videoId: string) => void
}) {
  return (
    <ul className="columns-1 gap-3 md:columns-2 xl:columns-4">
      {takeaways.map((t, i) => (
        <li
          key={`${t.videoId}-${t.title}-${i}`}
          className="mb-3 flex break-inside-avoid flex-col gap-2 rounded-xl border border-edge bg-surface p-4"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
              {TAKEAWAY_KINDS[t.kind] ?? t.kind}
            </span>
            {t.atSecs >= 0 && (
              <span className="font-mono text-xs text-accent">
                {clock(t.atSecs)}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-fg">{t.title}</p>
          {t.detail && <p className="text-sm text-fg-muted">{t.detail}</p>}
          {t.apply && (
            <p className="flex gap-2 rounded-lg bg-surface-hover p-2 text-sm text-fg">
              <Lightbulb
                size={14}
                aria-hidden
                className="mt-0.5 shrink-0 text-accent"
              />
              {t.apply}
            </p>
          )}
          <button
            type="button"
            onClick={() => onOpenVideo(t.videoId)}
            className="mt-auto truncate text-left text-xs text-fg-muted transition-colors hover:text-accent"
          >
            {t.videoTitle}
          </button>
        </li>
      ))}
    </ul>
  )
}

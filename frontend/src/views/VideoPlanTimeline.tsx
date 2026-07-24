import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Scissors,
  SkipBack,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import clsx from 'clsx'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  ExportPlanTimeline,
  GetEditWorkspace,
  GetPlanCuts,
  SavePlanTimeline,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'

/** One kept span of the base video, plus where it came from. */
interface Segment {
  start: number
  end: number
  /** The source video this span was cut from ('' = not expandable). */
  source: string
  sourceStart: number
  sourceEnd: number
  /** Seconds of original source footage restored before/after the span. */
  padStart: number
  padEnd: number
  label: string
}

const MIN_SEGMENT = 0.2 // seconds — segments can't be trimmed away entirely
const EXPAND_STEP = 0.5 // seconds per click on an expansion control
const MAX_PAD = 30 // seconds — past this, ask the editor for another pass

/** Wails rejects bound-method promises with the Go error string. */
const messageOf = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

const fmtTime = (t: number): string => {
  if (!isFinite(t) || t < 0) t = 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
    : `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** A segment's rendered length once its restored footage is joined on. */
const fullLength = (s: Segment): number =>
  s.padStart + (s.end - s.start) + s.padEnd

/** One base-video option in the picker. */
interface Choice {
  name: string
  url: string
  label: string
  /**
   * The render's timestamp. Every pass overwrites final.mp4 at the same path,
   * so without this in the URL the player would happily serve the cached
   * previous cut — the producer would reprocess, and watch the old video.
   */
  version: string
}

/** The workspace's videos, renders first — the cut is normally over a render. */
const buildChoices = (ws: main.EditWorkspaceInfo): Choice[] => {
  const opts: Choice[] = []
  for (const o of ws.outputs ?? []) {
    opts.push({
      name: o.name,
      url: o.mediaUrl,
      label: `${o.name} (the current video)`,
      version: o.modifiedAt,
    })
  }
  for (const s of ws.sources ?? []) {
    if (s.file && s.mediaUrl) {
      // Source footage never changes under us; its name is version enough.
      opts.push({
        name: s.file,
        url: s.mediaUrl,
        label: `${s.file} (source)`,
        version: 'source',
      })
    }
  }
  return opts
}

/** Fill the optional fields a manifest segment may leave out. */
const toSegment = (s: main.TimelineSegment): Segment => ({
  start: s.start,
  end: s.end,
  source: s.source ?? '',
  sourceStart: s.sourceStart ?? 0,
  sourceEnd: s.sourceEnd ?? 0,
  padStart: s.padStart ?? 0,
  padEnd: s.padEnd ?? 0,
  label: s.label ?? '',
})

/**
 * The manual timeline, inside the Editor tab beneath the rendered video: a
 * cuts-focused pass over the video the edit session produced. It opens
 * pre-split at the cuts the session recorded (edit/cuts.json), and the strip
 * shows the kept segments in playback order — split at the playhead, trim by
 * dragging a selected segment's edges, delete and reorder, and (for segments
 * the session traced back to their source footage) expand a segment into the
 * frames on either side of it when a cut lands a beat too tight.
 *
 * Reprocessing renders the cut back to final.mp4 through ffmpeg: kept spans
 * come from the current render, so their captions and overlays survive, while
 * restored frames come raw from the original source. The render it replaces is
 * archived, so nothing is destructive.
 */
export function VideoPlanTimeline({
  plan,
  onReprocessed,
  onPublish,
}: {
  plan: main.VideoPlan
  /** The workspace changed (a new render landed) — refresh the Editor. */
  onReprocessed: () => void
  /** Jump to the Publish tab. */
  onPublish: () => void
}) {
  // Base video candidates: rendered outputs plus downloaded sources.
  const [choices, setChoices] = useState<Choice[]>([])
  const [file, setFile] = useState('')
  // Cache-buster: reprocessing overwrites final.mp4, so the player must
  // re-fetch.
  const [reloadTick, setReloadTick] = useState(0)

  const [duration, setDuration] = useState(0)
  const [segments, setSegments] = useState<Segment[]>([])
  const [selected, setSelected] = useState(-1)
  const [previewCut, setPreviewCut] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const undoStack = useRef<Segment[][]>([])
  // Live mirrors for the playback loop (which must not re-subscribe per edit).
  const segmentsRef = useRef<Segment[]>([])
  const previewCutRef = useRef(true)
  segmentsRef.current = segments
  previewCutRef.current = previewCut
  // Short-form videos loop: on reaching the end of the cut, playback replays
  // from the top rather than stopping (see the playback loop).
  const short = plan.format === 'short'
  const loopRef = useRef(short)
  loopRef.current = short
  // Suppresses the autosave until the stored cut has been applied.
  const loaded = useRef(false)
  // Set by the first real edit. A saved cut outranks the workspace's own
  // segment manifest, so saving before the producer has touched anything would
  // persist the un-split fallback and permanently shadow the segments the edit
  // session recorded — the timeline would open as one segment forever.
  const edited = useRef(false)
  // The saved cut, held until the base video's metadata confirms it.
  const savedRef = useRef<main.PlanTimeline | null>(null)

  const url = useMemo(() => {
    const c = choices.find((c) => c.name === file)
    if (!c) return ''
    const sep = c.url.includes('?') ? '&' : '?'
    return `${c.url}${sep}v=${encodeURIComponent(c.version)}-${reloadTick}`
  }, [choices, file, reloadTick])

  // Load the workspace's videos and the cut to open with: the producer's
  // in-progress timeline when they have one, else the edit session's cuts.
  useEffect(() => {
    loaded.current = false
    edited.current = false
    Promise.all([GetEditWorkspace(plan.id), GetPlanCuts(plan.id)])
      .then(([ws, saved]) => {
        const opts = buildChoices(ws)
        setChoices(opts)
        savedRef.current = saved?.file ? saved : null
        const initial =
          saved?.file && opts.some((o) => o.name === saved.file)
            ? saved.file
            : (opts[0]?.name ?? '')
        setFile(initial)
        if (!initial) loaded.current = true
      })
      .catch(() => {
        loaded.current = true
      })
  }, [plan.id])

  // Export progress for this plan streams in as events.
  useEffect(
    () =>
      EventsOn('timeline:progress', (planId: string, detail: string) => {
        if (planId === plan.id) setProgress(detail)
      }),
    [plan.id],
  )

  // The base video's metadata seeds (or validates) the segments.
  const onMetadata = () => {
    const d = videoRef.current?.duration ?? 0
    if (!isFinite(d) || d <= 0) return
    setDuration(d)
    const saved = savedRef.current
    savedRef.current = null
    if (
      saved &&
      saved.file === file &&
      (saved.segments ?? []).length > 0 &&
      saved.segments.every((s) => s.end <= d + 1)
    ) {
      setSegments(
        saved.segments.map((s) => ({
          ...toSegment(s),
          end: Math.min(s.end, d),
        })),
      )
    } else {
      setSegments([
        {
          start: 0,
          end: d,
          source: '',
          sourceStart: 0,
          sourceEnd: 0,
          padStart: 0,
          padEnd: 0,
          label: '',
        },
      ])
    }
    undoStack.current = []
    setSelected(-1)
    loaded.current = true
  }

  // Persist the cut (debounced) — but only once it is actually the producer's
  // cut, never the freshly-seeded fallback (see `edited`).
  useEffect(() => {
    if (!loaded.current || !edited.current || !file) return
    const id = window.setTimeout(() => {
      void SavePlanTimeline(
        plan.id,
        main.PlanTimeline.createFrom({file, segments}),
      ).catch(() => {})
    }, 800)
    return () => window.clearTimeout(id)
  }, [plan.id, file, segments])

  // The strip's scale: every segment's full rendered length, restored footage
  // included, so its width is what it will actually be in the new video.
  const totalFull = useMemo(
    () => segments.reduce((sum, s) => sum + fullLength(s), 0),
    [segments],
  )
  const totalKept = useMemo(
    () => segments.reduce((sum, s) => sum + (s.end - s.start), 0),
    [segments],
  )
  const totalPad = totalFull - totalKept

  // Source time → position on the edited strip (0..1); -1 when cut out. The
  // restored footage before a segment shifts its kept span to the right.
  const toStripPos = useCallback((t: number): number => {
    const segs = segmentsRef.current
    const total = segs.reduce((sum, s) => sum + fullLength(s), 0)
    if (total <= 0) return -1
    let prefix = 0
    for (const s of segs) {
      if (t >= s.start && t <= s.end) {
        return (prefix + s.padStart + (t - s.start)) / total
      }
      prefix += fullLength(s)
    }
    return -1
  }, [])

  // Edited-strip position (0..1) → source time. Inside a segment's restored
  // footage — which isn't in the base video — snap to the kept span's edge.
  const toSourceTime = useCallback(
    (pos: number): number => {
      let remaining = pos * totalFull
      for (const s of segments) {
        const len = fullLength(s)
        if (remaining <= len) {
          const into = remaining - s.padStart
          return Math.min(Math.max(s.start + into, s.start), s.end)
        }
        remaining -= len
      }
      return segments.length > 0 ? segments[segments.length - 1].end : 0
    },
    [segments, totalFull],
  )

  // Playback loop: move the playhead marker and — when previewing the cut —
  // skip the regions the timeline dropped.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const segs = segmentsRef.current
        if (previewCutRef.current && !v.paused && segs.length > 0) {
          const t = v.currentTime
          const inSeg = segs.find((s) => t >= s.start && t < s.end - 0.04)
          if (!inSeg) {
            const next = segs.find((s) => s.start > t - 0.04)
            if (next) {
              // Only seek when a removed region actually lies ahead; segments
              // that abut play straight through, without a stutter at the seam.
              if (next.start > t + 0.12) v.currentTime = next.start
            } else if (loopRef.current) {
              // Short form replays from the top of the cut instead of stopping.
              v.currentTime = segs[0].start
            } else {
              v.pause()
            }
          }
        }
        const pos = toStripPos(v.currentTime)
        if (playheadRef.current) {
          playheadRef.current.style.left = `${Math.max(0, pos) * 100}%`
          playheadRef.current.style.opacity = pos < 0 ? '0.25' : '1'
        }
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [toStripPos])

  const mutate = (next: Segment[], keepSelection = false) => {
    undoStack.current = [...undoStack.current.slice(-49), segments]
    edited.current = true
    setSegments(next)
    if (!keepSelection) setSelected(-1)
    setNote('')
  }

  const undo = () => {
    const prev = undoStack.current.pop()
    if (prev) {
      setSegments(prev)
      setSelected(-1)
    }
  }

  const splitAtPlayhead = () => {
    const t = videoRef.current?.currentTime ?? 0
    const i = segments.findIndex(
      (s) => t > s.start + MIN_SEGMENT && t < s.end - MIN_SEGMENT,
    )
    if (i < 0) {
      setNote('Move the playhead inside a segment to split it.')
      return
    }
    const s = segments[i]
    // The split inherits the source mapping: each half keeps the footage it
    // actually came from, so both stay expandable. Times map linearly, which
    // is exact for a straight cut.
    const ratio =
      s.end > s.start ? (t - s.start) / (s.end - s.start) : 0
    const mid = s.source
      ? s.sourceStart + (s.sourceEnd - s.sourceStart) * ratio
      : 0
    mutate([
      ...segments.slice(0, i),
      {
        ...s,
        end: t,
        sourceEnd: s.source ? mid : 0,
        padEnd: 0, // the new inner edge is a cut, not the segment's outer edge
      },
      {
        ...s,
        start: t,
        sourceStart: s.source ? mid : 0,
        padStart: 0,
      },
      ...segments.slice(i + 1),
    ])
  }

  const deleteSelected = () => {
    if (selected < 0) return
    mutate(segments.filter((_, i) => i !== selected))
  }

  const moveSelected = (dir: -1 | 1) => {
    const j = selected + dir
    if (selected < 0 || j < 0 || j >= segments.length) return
    const next = [...segments]
    ;[next[selected], next[j]] = [next[j], next[selected]]
    mutate(next, true)
    setSelected(j)
  }

  // Expand (or pull back) the selected segment into its source footage.
  const expand = (edge: 'start' | 'end', delta: number) => {
    if (selected < 0) return
    const s = segments[selected]
    if (!s.source) return
    const next = [...segments]
    if (edge === 'start') {
      const pad = Math.min(
        MAX_PAD,
        Math.max(0, Math.min(s.padStart + delta, s.sourceStart)),
      )
      next[selected] = {...s, padStart: pad}
    } else {
      const pad = Math.min(MAX_PAD, Math.max(0, s.padEnd + delta))
      next[selected] = {...s, padEnd: pad}
    }
    mutate(next, true)
  }

  const reset = () => {
    if (duration > 0) {
      mutate([
        {
          start: 0,
          end: duration,
          source: '',
          sourceStart: 0,
          sourceEnd: 0,
          padStart: 0,
          padEnd: 0,
          label: '',
        },
      ])
    }
  }

  // Click on the strip: select the segment under the cursor and move the
  // playhead to that exact moment.
  const onStripClick = (e: React.MouseEvent) => {
    const el = stripRef.current
    if (!el || totalFull <= 0) return
    const rect = el.getBoundingClientRect()
    const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const t = toSourceTime(pos)
    let prefix = 0
    let idx = -1
    for (let i = 0; i < segments.length; i++) {
      prefix += fullLength(segments[i])
      if (pos * totalFull <= prefix + 1e-6) {
        idx = i
        break
      }
    }
    setSelected(idx)
    if (videoRef.current) videoRef.current.currentTime = t
  }

  // Trim by dragging a selected segment's edge.
  const startTrim = (edge: 'start' | 'end', e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = stripRef.current
    if (!el || selected < 0 || totalFull <= 0) return
    const rect = el.getBoundingClientRect()
    const secPerPx = totalFull / rect.width
    const startX = e.clientX
    const original = segments[selected]
    undoStack.current = [...undoStack.current.slice(-49), segments]
    edited.current = true

    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) * secPerPx
      setSegments((prev) => {
        const next = [...prev]
        const s = {...original}
        if (edge === 'start') {
          s.start = Math.min(
            Math.max(0, original.start + delta),
            s.end - MIN_SEGMENT,
          )
          // The source mapping follows the trim, so the segment stays
          // traceable (and expandable) from its new edge.
          if (s.source) s.sourceStart = original.sourceStart + (s.start - original.start)
        } else {
          s.end = Math.max(
            Math.min(duration, original.end + delta),
            s.start + MIN_SEGMENT,
          )
          if (s.source) s.sourceEnd = original.sourceEnd + (s.end - original.end)
        }
        next[selected] = s
        return next
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const reprocess = async () => {
    setExporting(true)
    setError('')
    setNote('')
    setProgress('Rendering the cut — 0%')
    try {
      const ws = await ExportPlanTimeline(
        plan.id,
        main.PlanTimeline.createFrom({file, segments}),
      )
      setNote(
        'Saved as the current video — the cut it replaced is under Past videos.',
      )
      // The cut is now final.mp4, which may not have existed before (cutting a
      // source video straight to a render), so the picker is rebuilt from the
      // workspace the export just returned rather than assumed.
      savedRef.current = null
      undoStack.current = []
      setSegments([])
      setSelected(-1)
      setDuration(0)
      loaded.current = false
      // The rendered cut *is* the video now, and the manifest we just wrote
      // describes it — so the reopened timeline is not a pending edit.
      edited.current = false
      setChoices(buildChoices(ws))
      const fresh = await GetPlanCuts(plan.id)
      savedRef.current = fresh?.file ? fresh : null
      setFile(fresh?.file || 'final.mp4')
      setReloadTick((n) => n + 1)
      onReprocessed()
    } catch (err) {
      setError(messageOf(err, 'The cut could not be rendered.'))
    } finally {
      setExporting(false)
      setProgress('')
    }
  }

  if (choices.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Nothing to cut yet — process the video above (or prepare the workspace so
        the downloaded source videos appear here).
      </p>
    )
  }

  const sel = selected >= 0 ? segments[selected] : null

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4">
      {/* Base video picker. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-fg">
          Cutting
          <select
            value={file}
            onChange={(e) => {
              setFile(e.target.value)
              setSegments([])
              setSelected(-1)
              setDuration(0)
              undoStack.current = []
              // Picking a different video to cut is not itself an edit.
              edited.current = false
            }}
            disabled={exporting}
            className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-normal text-fg outline-none focus:border-accent disabled:opacity-60"
          >
            {choices.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={previewCut}
            onChange={(e) => setPreviewCut(e.target.checked)}
            className="accent-[var(--accent,#6366f1)]"
          />
          Preview the cut (skip removed parts)
        </label>
      </div>

      {/* Panel one: the video. */}
      {url && (
        <video
          key={url}
          ref={videoRef}
          src={url}
          controls
          loop={short}
          onLoadedMetadata={onMetadata}
          className="aspect-video w-full rounded-lg bg-black"
        />
      )}

      {/* Panel two: the cutting tools and the strip. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={splitAtPlayhead}
          disabled={exporting || segments.length === 0}
          title="Split the segment under the playhead into two"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <Scissors size={14} aria-hidden />
          Split at playhead
        </button>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={exporting || selected < 0}
          title="Remove the selected segment from the cut"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <Trash2 size={14} aria-hidden />
          Delete segment
        </button>
        <button
          type="button"
          onClick={() => moveSelected(-1)}
          disabled={exporting || selected <= 0}
          title="Play the selected segment earlier"
          className="rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          ◀ Move
        </button>
        <button
          type="button"
          onClick={() => moveSelected(1)}
          disabled={exporting || selected < 0 || selected >= segments.length - 1}
          title="Play the selected segment later"
          className="rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          Move ▶
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={exporting || undoStack.current.length === 0}
          title="Undo the last timeline change"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <Undo2 size={14} aria-hidden />
          Undo
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={exporting || duration <= 0}
          title="Start over with the whole video as one segment"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
        >
          <SkipBack size={14} aria-hidden />
          Reset
        </button>
      </div>

      {/* The strip: kept segments in playback order, widths ∝ their rendered
          length (restored source footage included, hatched at the edges).
          Click to select + seek; drag a selected segment's edges to trim. */}
      <div
        ref={stripRef}
        onClick={onStripClick}
        role="presentation"
        className="relative h-16 w-full cursor-pointer select-none overflow-hidden rounded-lg border border-edge bg-bg"
      >
        {(() => {
          let prefix = 0
          return segments.map((s, i) => {
            const len = fullLength(s)
            const left = totalFull > 0 ? (prefix / totalFull) * 100 : 0
            const width = totalFull > 0 ? (len / totalFull) * 100 : 0
            prefix += len
            const isSel = i === selected
            const padStartPct = len > 0 ? (s.padStart / len) * 100 : 0
            const padEndPct = len > 0 ? (s.padEnd / len) * 100 : 0
            return (
              <div
                key={i}
                style={{left: `${left}%`, width: `${width}%`}}
                title={
                  `${s.label ? s.label + ' — ' : ''}` +
                  `${fmtTime(s.start)} – ${fmtTime(s.end)} (${fmtTime(s.end - s.start)})` +
                  (s.padStart || s.padEnd
                    ? ` · +${(s.padStart + s.padEnd).toFixed(1)}s restored from ${s.source}`
                    : '')
                }
                className={clsx(
                  'absolute inset-y-1 overflow-hidden rounded-md border',
                  isSel
                    ? 'z-10 border-accent bg-accent/30'
                    : i % 2 === 0
                      ? 'border-edge bg-accent/15'
                      : 'border-edge bg-accent/10',
                )}
              >
                {/* Restored footage: it isn't in this video yet, so it reads as
                    a hatched extension rather than part of the cut. */}
                {s.padStart > 0 && (
                  <span
                    aria-hidden
                    style={{width: `${padStartPct}%`}}
                    className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(120,120,120,0.35)_3px,rgba(120,120,120,0.35)_6px)]"
                  />
                )}
                {s.padEnd > 0 && (
                  <span
                    aria-hidden
                    style={{width: `${padEndPct}%`}}
                    className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(120,120,120,0.35)_3px,rgba(120,120,120,0.35)_6px)]"
                  />
                )}
                <span className="pointer-events-none absolute inset-x-1 top-0.5 truncate text-[10px] text-fg-muted">
                  {s.label || fmtTime(s.start)}
                </span>
                {isSel && (
                  <>
                    <div
                      onMouseDown={(e) => startTrim('start', e)}
                      title="Drag to trim the segment's start"
                      className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md bg-accent/80"
                    />
                    <div
                      onMouseDown={(e) => startTrim('end', e)}
                      title="Drag to trim the segment's end"
                      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md bg-accent/80"
                    />
                  </>
                )}
              </div>
            )
          })
        })()}
        {/* Playhead (positioned by the playback loop). */}
        <div
          ref={playheadRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500"
        />
      </div>

      <p className="text-xs text-fg-muted">
        {segments.length} segment{segments.length === 1 ? '' : 's'} ·{' '}
        {fmtTime(totalKept)} of {fmtTime(duration)} kept
        {totalPad > 0.05 && (
          <> · {totalPad.toFixed(1)}s restored from the source footage</>
        )}
        {sel && (
          <>
            {' '}
            · selected: {fmtTime(sel.start)} – {fmtTime(sel.end)}
          </>
        )}
      </p>

      {/* The selected segment's expansion controls: only segments the edit
          session traced back to a source can pull in more of it. */}
      {sel && (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-bg p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Selected segment
            {sel.label && (
              <span className="ml-1.5 font-normal normal-case text-fg">
                — {sel.label}
              </span>
            )}
          </p>
          {sel.source ? (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <ExpandControl
                  label="Start earlier"
                  pad={sel.padStart}
                  disabled={exporting}
                  onLess={() => expand('start', -EXPAND_STEP)}
                  onMore={() => expand('start', EXPAND_STEP)}
                  moreDisabled={
                    sel.padStart >= MAX_PAD || sel.padStart >= sel.sourceStart
                  }
                />
                <ExpandControl
                  label="End later"
                  pad={sel.padEnd}
                  disabled={exporting}
                  onLess={() => expand('end', -EXPAND_STEP)}
                  onMore={() => expand('end', EXPAND_STEP)}
                  moreDisabled={sel.padEnd >= MAX_PAD}
                />
              </div>
              <p className="text-xs text-fg-muted">
                Pulls the missing words, reaction, or beat back in from{' '}
                <span className="font-mono">{sel.source}</span> (
                {fmtTime(sel.sourceStart)} – {fmtTime(sel.sourceEnd)}). Restored
                frames come raw from the source — no captions or overlays — and
                only appear in the video once you reprocess.
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-muted">
              This segment has no single source video — a title card, an overlay,
              or a cut made before the editor started recording where its footage
              came from — so there is nothing to expand into. Split, trim, delete,
              and reorder still work.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {note && <p className="text-sm text-green-600 dark:text-green-400">{note}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
        <button
          type="button"
          onClick={() => void reprocess()}
          disabled={exporting || segments.length === 0 || totalKept <= 0}
          title="Render this cut and save it as the current video — the cut it replaces is archived under Past videos"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 size={14} aria-hidden className="animate-spin" />
          ) : (
            <RotateCcw size={14} aria-hidden />
          )}
          {exporting ? 'Reprocessing…' : 'Reprocess and save'}
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={exporting}
          title="Happy with the cut? Set the thumbnail and the listing, then upload"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <Upload size={14} aria-hidden />
          Publish
        </button>
        {exporting && progress && (
          <span className="text-xs text-fg-muted">{progress}</span>
        )}
      </div>
    </div>
  )
}

/** One side of the selected segment's expansion: −, the seconds, +. */
function ExpandControl({
  label,
  pad,
  disabled,
  moreDisabled,
  onLess,
  onMore,
}: {
  label: string
  pad: number
  disabled: boolean
  moreDisabled: boolean
  onLess: () => void
  onMore: () => void
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg">
      <span className="font-medium">{label}</span>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={onLess}
          disabled={disabled || pad <= 0}
          aria-label={`${label}: less`}
          title={`Give back ${EXPAND_STEP}s`}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-edge text-fg transition-colors hover:bg-surface-hover disabled:opacity-40"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <span
          className={clsx(
            'w-14 text-center font-mono text-xs',
            pad > 0 ? 'font-semibold text-accent' : 'text-fg-muted',
          )}
        >
          +{pad.toFixed(1)}s
        </span>
        <button
          type="button"
          onClick={onMore}
          disabled={disabled || moreDisabled}
          aria-label={`${label}: more`}
          title={`Restore another ${EXPAND_STEP}s from the source`}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-edge text-fg transition-colors hover:bg-surface-hover disabled:opacity-40"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      </span>
    </span>
  )
}

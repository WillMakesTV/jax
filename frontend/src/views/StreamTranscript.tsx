import {ArrowLeft, Captions} from 'lucide-react'
import {useEffect, useState} from 'react'
import {GetTranscriptForStream} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {PageHeader} from '../components/PageHeader'
import {
  groupTranscriptLines,
  type TranscriptLine,
} from '../transcript/TranscriptProvider'

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * A past stream's stored transcript, on its own page. Sessions are matched to
 * the stream by start-time (the same margin used to aggregate broadcasts), so
 * the log recorded live shows up here afterwards.
 */
export function StreamTranscript({
  stream,
  onBack,
}: {
  stream: main.PastStream
  onBack: () => void
}) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    GetTranscriptForStream(stream.startedAt)
      .then((result) => {
        if (!cancelled) setLines(groupTranscriptLines(result ?? []))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [stream.startedAt])

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to stream
      </button>

      <PageHeader description={stream.title || 'Untitled stream'} />

      {!loaded ? (
        <p className="text-sm text-fg-muted">Loading transcript…</p>
      ) : lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-edge bg-surface p-8 text-center">
          <span
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Captions size={24} />
          </span>
          <p className="max-w-sm text-sm text-fg-muted">
            No transcript was captured for this stream.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge bg-surface p-4">
          <ul className="space-y-3">
            {lines.map((line) => (
              <li key={line.id} className="flex items-start gap-3">
                <span
                  className="shrink-0 pt-0.5 font-mono text-[11px] text-fg-muted"
                  title={new Date(line.at).toLocaleString()}
                >
                  {timeFmt.format(line.at)}
                </span>
                <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-fg">
                  {line.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

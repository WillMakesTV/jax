import {AudioLines, Captions, Eraser, Loader2, Mic, Square} from 'lucide-react'
import {useEffect, useRef} from 'react'
import {useTranscript} from './TranscriptProvider'

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * The Transcript tab: fully local Whisper (faster-whisper) transcription of
 * the OBS-enabled microphone, grouped into timestamped lines like a chat.
 * Capture keeps running while you navigate elsewhere; the transcript
 * accumulates until cleared.
 */
export function TranscriptPanel() {
  const {
    lines,
    partial,
    capturing,
    phase,
    deviceLabel,
    error,
    start,
    stop,
    clear,
  } = useTranscript()
  const listRef = useRef<HTMLDivElement>(null)

  // Follow the newest lines, and the interim words as they stream in.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, partial])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div
        className="group relative min-h-0 flex-1 overflow-hidden rounded-xl border border-edge bg-surface"
      >
        {/* Capture status, top-left; kept subtle so it doesn't obscure text. */}
        {capturing && (
          <div className="pointer-events-none absolute left-3 top-3 z-10">
            {phase === 'loading' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-bg/90 px-2.5 py-1 text-[11px] font-medium text-fg-muted shadow-sm backdrop-blur-sm">
                <Loader2 size={12} aria-hidden className="animate-spin" />
                Loading Whisper model…
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-bg/90 px-2.5 py-1 text-[11px] font-medium text-fg-muted shadow-sm backdrop-blur-sm"
                title={`Capturing ${deviceLabel || 'microphone'} — runs locally`}
              >
                <Mic size={12} aria-hidden className="animate-pulse text-red-500" />
                Listening
              </span>
            )}
          </div>
        )}

        {/* Start/Stop + Clear, revealed on hover at the top-right: fades in
            at once, lingers, then fades out after a delay. */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 opacity-0 transition-opacity duration-200 delay-700 focus-within:opacity-100 focus-within:delay-0 group-hover:opacity-100 group-hover:delay-0">
          {lines.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-bg/90 px-3 py-1.5 text-xs font-medium text-fg-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <Eraser size={13} aria-hidden />
              Clear
            </button>
          )}
          {capturing ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            >
              <Square size={13} aria-hidden />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg shadow-sm transition-opacity hover:opacity-90"
            >
              <AudioLines size={13} aria-hidden />
              Start
            </button>
          )}
        </div>

        <div ref={listRef} className="h-full overflow-y-auto p-4">
          {lines.length === 0 && !partial ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span
                aria-hidden
                className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
              >
                <Captions size={24} />
              </span>
              <p className="max-w-sm text-sm text-fg-muted">
                {capturing
                  ? 'Listening — spoken words appear here as you speak.'
                  : 'Transcription starts automatically while you are live with a microphone enabled in OBS, using local Whisper. Hover here for controls.'}
              </p>
            </div>
          ) : (
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
              {/* The utterance being spoken right now, dimmed until it settles
                  into a finished line. */}
              {partial && (
                <li className="flex items-start gap-3" aria-live="polite">
                  <span className="shrink-0 pt-0.5 font-mono text-[11px] text-fg-muted/60">
                    ···
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-fg-muted">
                    {partial}
                  </p>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

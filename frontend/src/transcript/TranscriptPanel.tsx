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
  const {lines, capturing, phase, deviceLabel, error, start, stop, clear} =
    useTranscript()
  const listRef = useRef<HTMLDivElement>(null)

  // Follow the newest lines.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {capturing ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Square size={14} aria-hidden />
            Stop transcribing
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <AudioLines size={14} aria-hidden />
            Start transcribing
          </button>
        )}
        {lines.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Eraser size={14} aria-hidden />
            Clear
          </button>
        )}
        {capturing && phase === 'loading' && (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <Loader2 size={12} aria-hidden className="animate-spin" />
            Loading the Whisper model… (the first run downloads it, ~460 MB)
          </span>
        )}
        {capturing && phase === 'listening' && (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <Mic size={12} aria-hidden className="animate-pulse text-red-500" />
            Capturing {deviceLabel || 'microphone'} — the device enabled in
            OBS. Runs locally; nothing leaves this machine.
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-edge bg-surface p-4"
      >
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
            >
              <Captions size={24} />
            </span>
            <p className="max-w-sm text-sm text-fg-muted">
              {capturing
                ? 'Listening — spoken words appear here a few seconds after each sentence.'
                : 'Transcription starts automatically while you are live with a microphone enabled in OBS, using local Whisper. Lines are grouped by when they were spoken.'}
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
          </ul>
        )}
      </div>
    </div>
  )
}

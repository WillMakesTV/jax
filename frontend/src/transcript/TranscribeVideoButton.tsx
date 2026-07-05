import {AudioLines, Clock, Loader2, RefreshCw, X} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {Modal} from '../components/Modal'
import {useVodTranscribe} from './VodTranscribeProvider'

/**
 * "Generate transcript" / "Re-transcribe from video" action for a downloaded
 * broadcast (by its download subfolder). Re-transcribing replaces the stored
 * transcript — including one captured live — so that path arms an inline
 * confirm on first click instead of running immediately. Requests join the
 * transcription queue: while this download's job is queued or running the
 * button shows its state with a cancel beside it.
 */
export function TranscribeVideoButton({
  subfolder,
  hasTranscript,
}: {
  subfolder: string
  hasTranscript: boolean
}) {
  const {jobs, start, cancel} = useVodTranscribe()
  const [armed, setArmed] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const disarmTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(disarmTimer.current), [])

  const job = jobs.find((j) => j.subfolder === subfolder)

  // The job can end on its own while the stop dialog is open; close it.
  useEffect(() => {
    if (!job) setConfirmStop(false)
  }, [job])

  if (job) {
    const queued = job.state === 'queued'
    return (
      <span className="inline-flex items-center gap-1">
        <span
          title={job.detail}
          className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg"
        >
          {queued ? (
            <Clock size={16} aria-hidden className="text-fg-muted" />
          ) : (
            <Loader2 size={16} aria-hidden className="animate-spin" />
          )}
          {queued
            ? 'Queued'
            : job.percent !== null
              ? `Transcribing — ${job.percent}%`
              : 'Transcribing…'}
        </span>
        <button
          type="button"
          onClick={() => setConfirmStop(true)}
          title="Stop transcription"
          aria-label="Stop transcription"
          className="inline-flex items-center justify-center rounded-lg border border-edge bg-surface p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X size={16} aria-hidden />
        </button>
        <Modal
          open={confirmStop}
          onClose={() => setConfirmStop(false)}
          title={queued ? 'Remove from the queue?' : 'Stop transcribing?'}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg-muted">
              {queued
                ? 'This video will not be transcribed. The stored transcript, if any, is kept.'
                : 'Transcription progress so far will be discarded, and the stored transcript, if any, is kept. You can start over later.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmStop(false)}
                className="rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover"
              >
                {queued ? 'Keep it queued' : 'Keep transcribing'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmStop(false)
                  cancel(subfolder)
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                {queued ? 'Remove it' : 'Stop transcription'}
              </button>
            </div>
          </div>
        </Modal>
      </span>
    )
  }

  const click = () => {
    // Replacing an existing transcript loses the live capture for good, so
    // ask for a second click; it disarms on its own if the user walks away.
    if (hasTranscript && !armed) {
      setArmed(true)
      window.clearTimeout(disarmTimer.current)
      disarmTimer.current = window.setTimeout(() => setArmed(false), 4_000)
      return
    }
    setArmed(false)
    void start(subfolder)
  }

  return (
    <button
      type="button"
      onClick={click}
      title={
        hasTranscript
          ? 'Replace the stored transcript with one produced from the downloaded video'
          : 'Produce a transcript from the downloaded video'
      }
      className={
        armed
          ? 'inline-flex items-center gap-2 rounded-lg border border-amber-600/50 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400'
          : 'inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-hover'
      }
    >
      {hasTranscript ? (
        <RefreshCw size={16} aria-hidden />
      ) : (
        <AudioLines size={16} aria-hidden />
      )}
      {armed
        ? 'Replace the transcript?'
        : hasTranscript
          ? 'Re-transcribe from video'
          : 'Generate transcript'}
    </button>
  )
}

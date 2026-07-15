import clsx from 'clsx'
import {Mic, Square} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useTranscript} from '../transcript/TranscriptProvider'

interface DictationButtonProps {
  /** Receives each transcribed utterance while this button is listening. */
  onText: (text: string) => void
  /** Which field this button fills, for the accessible label. */
  fieldLabel: string
  /** True when another dictation button currently holds the mic. */
  otherActive?: boolean
  /** Reports this button taking/releasing the mic. */
  onActiveChange?: (active: boolean) => void
}

/**
 * Dictate into a text field with the app's local Whisper transcriber (the
 * same offline pipeline that captions live streams). Utterances arrive as
 * you pause — a sentence at a time, not word by word.
 */
export function DictationButton({
  onText,
  fieldLabel,
  otherActive,
  onActiveChange,
}: DictationButtonProps) {
  const {capturing, dictating, dictate, stopDictation} = useTranscript()
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  // The latest onText, so utterances land in current state without
  // re-borrowing the mic on every parent render.
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  })

  // Release the mic when the field (or its modal) goes away.
  const activeRef = useRef(false)
  useEffect(
    () => () => {
      if (activeRef.current) stopDictation()
    },
    [stopDictation],
  )

  const setActiveState = (next: boolean) => {
    activeRef.current = next
    setActive(next)
    onActiveChange?.(next)
  }

  const toggle = async () => {
    if (active) {
      stopDictation()
      setActiveState(false)
      return
    }
    setError('')
    try {
      await dictate((text) => onTextRef.current(text))
      setActiveState(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // The provider can end the dictation from its side (e.g. a stream capture
  // reclaiming the mic); reflect that here.
  useEffect(() => {
    if (active && !dictating) setActiveState(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictating])

  const blocked = capturing || (otherActive && !active)
  const title = error
    ? error
    : capturing
      ? 'The transcriber is captioning the live stream'
      : active
        ? 'Stop dictating'
        : `Dictate the ${fieldLabel}`

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={blocked}
      aria-label={title}
      aria-pressed={active}
      title={title}
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'animate-pulse bg-red-600 text-white hover:bg-red-500'
          : error
            ? 'text-red-600 hover:bg-surface-hover dark:text-red-400'
            : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {active ? (
        <Square size={12} aria-hidden />
      ) : (
        <Mic size={13} aria-hidden />
      )}
    </button>
  )
}

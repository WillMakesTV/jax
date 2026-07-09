import {
  Bold,
  Check,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react'
import {useRef, useState} from 'react'
import {Markdown} from './Markdown'

/**
 * A markdown text field with two modes. Edit: a compact toolbar + textarea
 * (the toolbar writes markdown around the selection). View: the rendered
 * markdown with a small Edit CTA. An empty value starts in edit mode; a
 * filled one starts in view mode.
 */
export function MarkdownField({
  id,
  value,
  onChange,
  placeholder,
  onSelectionChange,
  onDone,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Reports the textarea's selection range (start === end when collapsed),
   *  so callers can offer actions scoped to the highlighted text. */
  onSelectionChange?: (start: number, end: number) => void
  /** Called when editing finishes (the Done button) — e.g. to autosave. */
  onDone?: () => void
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(
    value.trim() ? 'view' : 'edit',
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  if (mode === 'view') {
    return (
      <div className="group relative rounded-lg border border-edge bg-bg px-4 py-3">
        <Markdown>{value}</Markdown>
        <button
          type="button"
          onClick={() => setMode('edit')}
          title="Edit description"
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-xs font-medium text-fg-muted opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg"
        >
          <Pencil size={12} aria-hidden />
          Edit
        </button>
      </div>
    )
  }

  // --- Edit mode -----------------------------------------------------------

  /** Replace the selection, then restore focus and select the new range. */
  const replaceSelection = (
    build: (selected: string) => {text: string; selectFrom: number; selectTo: number},
  ) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const {text, selectFrom, selectTo} = build(selected)
    onChange(value.slice(0, start) + text + value.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + selectFrom, start + selectTo)
    })
  }

  /** Wrap the selection (or a placeholder) in before/after markers. */
  const wrap = (before: string, after: string, fallback: string) =>
    replaceSelection((selected) => {
      const inner = selected || fallback
      return {
        text: before + inner + after,
        selectFrom: before.length,
        selectTo: before.length + inner.length,
      }
    })

  /** Prefix each selected line (at line starts), e.g. lists and quotes. */
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    // Expand to whole lines.
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEndIdx = value.indexOf('\n', end)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const block = value.slice(lineStart, lineEnd)
    const prefixed = block
      .split('\n')
      .map((line, i) =>
        (typeof prefix === 'string' ? prefix : prefix(i)) + line,
      )
      .join('\n')
    onChange(value.slice(0, lineStart) + prefixed + value.slice(lineEnd))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(lineStart, lineStart + prefixed.length)
    })
  }

  const tools: {
    icon: LucideIcon
    label: string
    apply: () => void
  }[] = [
    {icon: Bold, label: 'Bold', apply: () => wrap('**', '**', 'bold')},
    {icon: Italic, label: 'Italic', apply: () => wrap('*', '*', 'italic')},
    {
      icon: Strikethrough,
      label: 'Strikethrough',
      apply: () => wrap('~~', '~~', 'struck'),
    },
    {icon: Heading2, label: 'Heading', apply: () => prefixLines('## ')},
    {icon: List, label: 'Bullet list', apply: () => prefixLines('- ')},
    {
      icon: ListOrdered,
      label: 'Numbered list',
      apply: () => prefixLines((i) => `${i + 1}. `),
    },
    {icon: Quote, label: 'Quote', apply: () => prefixLines('> ')},
    {icon: Code, label: 'Code', apply: () => wrap('`', '`', 'code')},
    {
      icon: Link2,
      label: 'Link',
      apply: () =>
        replaceSelection((selected) => {
          const label = selected || 'link text'
          const text = `[${label}](url)`
          // Select the url placeholder so it can be typed over immediately.
          return {
            text,
            selectFrom: label.length + 3,
            selectTo: label.length + 6,
          }
        }),
    },
  ]

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-bg focus-within:border-accent">
      <div className="flex items-center gap-0.5 border-b border-edge bg-surface px-1.5 py-1">
        {tools.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.label}
            aria-label={t.label}
            onClick={t.apply}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <t.icon size={13} aria-hidden />
          </button>
        ))}
        <span className="mx-1 text-[10px] uppercase tracking-wide text-fg-muted/70">
          Markdown
        </span>
        {value.trim() && (
          <button
            type="button"
            onClick={() => {
              setMode('view')
              onDone?.()
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-accent transition-colors hover:bg-surface-hover"
          >
            <Check size={12} aria-hidden />
            Done
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSelect={(e) =>
          onSelectionChange?.(
            e.currentTarget.selectionStart,
            e.currentTarget.selectionEnd,
          )
        }
        rows={6}
        placeholder={placeholder}
        spellCheck
        className="w-full resize-y bg-bg px-3 py-2 font-mono text-[13px] leading-relaxed text-fg outline-none"
      />
    </div>
  )
}

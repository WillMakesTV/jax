import {Check, Code2, Pencil, WandSparkles} from 'lucide-react'
import {useMemo, useState} from 'react'
import {formatJsxTemplate} from '../lib/formatTemplate'

/**
 * Quick structural checks for a JSX template: balanced braces outside
 * strings and balanced tags (JSX requires self-closing voids, so every
 * non-self-closed tag is expected to close). Not a full parser — these are
 * the mistakes that actually bite when hand-writing a template.
 */
export function lintJsx(source: string): string[] {
  const problems: string[] = []
  if (!source.trim()) return problems

  // Brace balance, skipping string literals.
  let depth = 0
  let inString: string | null = null
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth < 0) {
        problems.push("'}' without a matching '{'")
        depth = 0
      }
    }
  }
  if (inString) problems.push('Unterminated string literal')
  if (depth > 0)
    problems.push(depth === 1 ? "Unclosed '{'" : `${depth} unclosed '{'`)

  // Tag balance.
  const tagRe =
    /<(\/?)([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^<>"'{}])*?)(\/?)>/g
  const stack: string[] = []
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(source))) {
    const closing = m[1]
    const name = m[2]
    const selfClosing = m[4]
    if (selfClosing) continue
    if (closing) {
      const open = stack.pop()
      if (!open) problems.push(`</${name}> has no matching opening tag`)
      else if (open !== name) problems.push(`<${open}> is closed by </${name}>`)
    } else {
      stack.push(name)
    }
  }
  for (const open of stack) problems.push(`<${open}> is never closed`)

  return problems
}

/**
 * A JSX template field with two modes, mirroring the markdown editor's
 * shape (see MarkdownField). Edit: a monospace textarea with live quick
 * checks underneath. View: the template as formatted code with a small Edit
 * CTA. An empty value starts in edit mode; a filled one starts in view mode.
 */
export function JsxTemplateField({
  id,
  value,
  onChange,
  placeholder,
  onDone,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Called when editing finishes (the Done button) — e.g. to autosave. */
  onDone?: () => void
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(
    value.trim() ? 'view' : 'edit',
  )
  const problems = useMemo(() => lintJsx(value), [value])
  const [formatError, setFormatError] = useState('')

  // Real prettier (standalone) lays the template out properly; a syntax
  // error surfaces in the diagnostics footer instead of eating the source.
  const formatNow = async () => {
    try {
      const formatted = await formatJsxTemplate(value)
      if (formatted !== value) onChange(formatted)
      setFormatError('')
    } catch {
      setFormatError('Cannot format — fix the syntax errors first.')
    }
  }

  if (mode === 'view') {
    return (
      <div className="group relative rounded-lg border border-edge bg-bg">
        <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed text-fg">
          <code>{value}</code>
        </pre>
        <button
          type="button"
          onClick={() => setMode('edit')}
          title="Edit template"
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-xs font-medium text-fg-muted opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:bg-surface-hover hover:text-fg"
        >
          <Pencil size={12} aria-hidden />
          Edit
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-edge bg-bg">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Code2 size={13} aria-hidden />
          JSX
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void formatNow()}
            disabled={!value.trim()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <WandSparkles size={12} aria-hidden />
            Format
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('view')
              onDone?.()
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Check size={12} aria-hidden />
            Done
          </button>
        </span>
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        spellCheck={false}
        placeholder={placeholder}
        className="w-full resize-y bg-transparent px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none"
      />
      <div className="border-t border-edge px-3 py-1.5">
        {formatError && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {formatError}
          </p>
        )}
        {problems.length === 0 ? (
          !formatError && (
            <p className="text-xs text-fg-muted">No issues found.</p>
          )
        ) : (
          <ul className="flex flex-col gap-0.5">
            {problems.map((p, i) => (
              <li
                key={i}
                className="text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {openExternal} from '../../lib/browser'

/**
 * Themed markdown renderer used wherever stored markdown is displayed (e.g.
 * a planned stream's description). GFM extras (tables, strikethrough, task
 * lists) are enabled; links open in the system browser.
 */
export function Markdown({children}: {children: string}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({children}) => (
          <h1 className="mb-2 mt-4 text-lg font-bold text-fg first:mt-0">
            {children}
          </h1>
        ),
        h2: ({children}) => (
          <h2 className="mb-2 mt-4 text-base font-bold text-fg first:mt-0">
            {children}
          </h2>
        ),
        h3: ({children}) => (
          <h3 className="mb-1.5 mt-3 text-sm font-semibold text-fg first:mt-0">
            {children}
          </h3>
        ),
        h4: ({children}) => (
          <h4 className="mb-1 mt-3 text-sm font-semibold text-fg-muted first:mt-0">
            {children}
          </h4>
        ),
        p: ({children}) => (
          <p className="my-2 text-sm leading-relaxed text-fg first:mt-0 last:mb-0">
            {children}
          </p>
        ),
        a: ({href, children}) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              if (href) openExternal(href)
            }}
            className="text-accent underline hover:opacity-80"
          >
            {children}
          </a>
        ),
        ul: ({children}) => (
          <ul className="my-2 list-disc space-y-1 pl-5 text-sm text-fg">
            {children}
          </ul>
        ),
        ol: ({children}) => (
          <ol className="my-2 list-decimal space-y-1 pl-5 text-sm text-fg">
            {children}
          </ol>
        ),
        li: ({children}) => (
          <li className="text-sm leading-relaxed text-fg">{children}</li>
        ),
        input: ({checked, disabled}) => (
          <input
            type="checkbox"
            checked={Boolean(checked)}
            disabled={disabled}
            readOnly
            className="mr-1.5 align-middle accent-accent"
          />
        ),
        blockquote: ({children}) => (
          <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-sm italic text-fg-muted">
            {children}
          </blockquote>
        ),
        code: ({className, children}) => {
          // Block code arrives wrapped in <pre> (handled below); inline code
          // has no language class and renders as a chip.
          const isBlock = /language-/.test(className ?? '')
          if (isBlock) return <code className={className}>{children}</code>
          return (
            <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[12px] text-fg">
              {children}
            </code>
          )
        },
        pre: ({children}) => (
          <pre className="my-2 overflow-x-auto rounded-lg border border-edge bg-bg p-3 font-mono text-xs leading-relaxed text-fg">
            {children}
          </pre>
        ),
        table: ({children}) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({children}) => (
          <th className="border border-edge bg-surface-hover px-2.5 py-1.5 text-left text-xs font-semibold text-fg">
            {children}
          </th>
        ),
        td: ({children}) => (
          <td className="border border-edge px-2.5 py-1.5 text-sm text-fg">
            {children}
          </td>
        ),
        hr: () => <hr className="my-3 border-edge" />,
        img: ({src, alt}) => (
          <img
            src={src}
            alt={alt ?? ''}
            className="my-2 max-w-full rounded-lg border border-edge"
          />
        ),
        strong: ({children}) => (
          <strong className="font-semibold text-fg">{children}</strong>
        ),
        em: ({children}) => <em className="italic">{children}</em>,
        del: ({children}) => (
          <del className="text-fg-muted line-through">{children}</del>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

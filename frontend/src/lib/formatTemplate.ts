import * as prettierPluginBabel from 'prettier/plugins/babel'
import * as prettierPluginEstree from 'prettier/plugins/estree'
import * as prettierPluginPostcss from 'prettier/plugins/postcss'
import {format} from 'prettier/standalone'

/**
 * Real prettier (the standalone browser build) for widget displays: the
 * JSX template, its stylesheet, and its custom JS. Each formatter returns
 * the source unchanged when it is empty, and throws on syntax errors —
 * callers decide whether to surface that or fall back to the input.
 */

/** House style for widget code: narrow enough to read in the side editor. */
const OPTS = {semi: false, singleQuote: true, printWidth: 72}

const jsPlugins = [prettierPluginBabel, prettierPluginEstree]

/** Format one JSX expression (a widget template). */
export async function formatJsxTemplate(source: string): Promise<string> {
  if (!source.trim()) return source
  const out = await format(source, {
    ...OPTS,
    parser: 'babel',
    plugins: jsPlugins,
  })
  // With semi:false prettier guards a leading `<` with a semicolon; the
  // template is a bare expression, so drop it along with the final newline.
  return out.replace(/^;/, '').trim()
}

/** Format a widget stylesheet. */
export async function formatWidgetCss(source: string): Promise<string> {
  if (!source.trim()) return source
  const out = await format(source, {
    ...OPTS,
    parser: 'css',
    plugins: [prettierPluginPostcss],
  })
  return out.trim()
}

/** Format widget custom JS. */
export async function formatWidgetJs(source: string): Promise<string> {
  if (!source.trim()) return source
  const out = await format(source, {
    ...OPTS,
    parser: 'babel',
    plugins: jsPlugins,
  })
  return out.trim()
}

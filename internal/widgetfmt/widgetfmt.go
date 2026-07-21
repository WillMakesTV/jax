// Package widgetfmt pretty-prints the JSX, CSS and JS a stream widget's
// display template is made of.
//
// The model behind GenerateWidgetTemplate often returns each of them as one
// long line, which reads terribly in the editors. These formatters fix that
// case — and only that case: content that already has line structure
// (hand-written, or a well-formatted response) is returned exactly as it came
// in, so formatting never fights the author.
package widgetfmt

import (
	"regexp"
	"strings"
)

// widgetTagRe matches one JSX tag: closing slash, name, attributes
// (tolerating quoted strings and braced expressions), self-closing slash.
// The shape mirrors the frontend editor's lint (JsxTemplateField.tsx).
var widgetTagRe = regexp.MustCompile(`<(/?)([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^<>"'{}])*?)(/?)>`)

// JSX reindents a single-line JSX template: tags get their own
// lines, nested content indents two spaces per depth.
func JSX(src string) string {
	src = strings.TrimSpace(src)
	if src == "" || strings.Contains(src, "\n") {
		return src
	}
	// A break between adjacent tags gives the indenter its lines.
	src = regexp.MustCompile(`>\s*<`).ReplaceAllString(src, ">\n<")

	depth := 0
	var out []string
	for _, line := range strings.Split(src, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		indent := depth
		if strings.HasPrefix(line, "</") {
			indent--
		}
		if indent < 0 {
			indent = 0
		}
		out = append(out, strings.Repeat("  ", indent)+line)
		for _, m := range widgetTagRe.FindAllStringSubmatch(line, -1) {
			switch {
			case m[4] == "/": // self-closing
			case m[1] == "/":
				depth--
			default:
				depth++
			}
		}
		if depth < 0 {
			depth = 0
		}
	}
	return strings.Join(out, "\n")
}

// CSS pretty-prints a single-line stylesheet: one declaration
// per line, rules separated, indented inside braces.
func CSS(src string) string {
	src = strings.TrimSpace(src)
	if src == "" || strings.Contains(src, "\n") {
		return src
	}
	var b strings.Builder
	depth := 0
	newline := func() {
		b.WriteString("\n")
		b.WriteString(strings.Repeat("  ", depth))
	}
	for i := 0; i < len(src); i++ {
		ch := src[i]
		switch ch {
		case '{':
			b.WriteString(" {")
			depth++
			newline()
		case '}':
			depth--
			if depth < 0 {
				depth = 0
			}
			newline()
			b.WriteString("}")
			if i+1 < len(src) {
				newline()
			}
		case ';':
			b.WriteString(";")
			if i+1 < len(src) && src[i+1] != '}' {
				newline()
			}
		case ' ':
			// Collapse runs; meaningful spacing is re-created above.
			if b.Len() > 0 && !strings.HasSuffix(b.String(), " ") && !strings.HasSuffix(b.String(), "\n") {
				b.WriteString(" ")
			}
		default:
			b.WriteByte(ch)
		}
	}
	// Tidy the seams the state machine leaves behind.
	lines := strings.Split(b.String(), "\n")
	out := lines[:0]
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			out = append(out, strings.TrimRight(line, " "))
		}
	}
	return strings.Join(out, "\n")
}

// JS breaks a single-line script at statement and block
// boundaries, skipping string literals, and indents by brace depth.
func JS(src string) string {
	src = strings.TrimSpace(src)
	if src == "" || strings.Contains(src, "\n") {
		return src
	}
	var segments []string
	var cur strings.Builder
	depth := 0
	var quote byte
	flush := func(d int) {
		if s := strings.TrimSpace(cur.String()); s != "" {
			segments = append(segments, strings.Repeat("  ", d)+s)
		}
		cur.Reset()
	}
	for i := 0; i < len(src); i++ {
		ch := src[i]
		if quote != 0 {
			cur.WriteByte(ch)
			if ch == '\\' && i+1 < len(src) {
				cur.WriteByte(src[i+1])
				i++
			} else if ch == quote {
				quote = 0
			}
			continue
		}
		switch ch {
		case '"', '\'', '`':
			quote = ch
			cur.WriteByte(ch)
		case '{':
			cur.WriteByte(ch)
			flush(depth)
			depth++
		case '}':
			flush(depth)
			depth--
			if depth < 0 {
				depth = 0
			}
			cur.WriteByte(ch)
			// A brace closing a function-expression argument ("}, 500)" or
			// "})") continues its statement; keep accumulating until the
			// statement actually ends. A bare block close stands alone.
			rest := strings.TrimLeft(src[i+1:], " ")
			if strings.HasPrefix(rest, ",") || strings.HasPrefix(rest, ")") {
				continue
			}
			if strings.HasPrefix(rest, ";") {
				cur.WriteByte(';')
				i = len(src) - len(rest)
			}
			flush(depth)
		case ';':
			cur.WriteByte(ch)
			// A ; inside for(…) headers stays inline.
			if !strings.Contains(cur.String(), "for (") && !strings.Contains(cur.String(), "for(") {
				flush(depth)
			}
		default:
			cur.WriteByte(ch)
		}
	}
	flush(depth)
	return strings.Join(segments, "\n")
}

package widgetfmt

import (
	"strings"
	"testing"
)

func TestFormatWidgetJSX(t *testing.T) {
	got := JSX(
		`<div className="w"><h2>{widget.name}</h2><p>{fields['Status']}</p><img src={fields['Art']} /></div>`)
	want := strings.Join([]string{
		`<div className="w">`,
		`  <h2>{widget.name}</h2>`,
		`  <p>{fields['Status']}</p>`,
		`  <img src={fields['Art']} />`,
		`</div>`,
	}, "\n")
	if got != want {
		t.Fatalf("jsx format mismatch:\n%s\n--- want ---\n%s", got, want)
	}

	// Content that already has line structure is untouched.
	pre := "<div>\n  <p>x</p>\n</div>"
	if JSX(pre) != pre {
		t.Fatalf("pre-formatted jsx should pass through: %q", JSX(pre))
	}
}

func TestFormatWidgetCSS(t *testing.T) {
	got := CSS(`.w{color:red;font-size:32px}.w h2{margin:0}`)
	want := strings.Join([]string{
		`.w {`,
		`  color:red;`,
		`  font-size:32px`,
		`}`,
		`.w h2 {`,
		`  margin:0`,
		`}`,
	}, "\n")
	if got != want {
		t.Fatalf("css format mismatch:\n%s\n--- want ---\n%s", got, want)
	}

	pre := ".w {\n  color: red;\n}"
	if CSS(pre) != pre {
		t.Fatalf("pre-formatted css should pass through: %q", CSS(pre))
	}
}

func TestFormatWidgetJS(t *testing.T) {
	got := JS(`const el = root.querySelector('.w'); if (el) { el.classList.add('in'); setTimeout(function () { el.classList.remove('in'); }, 500); }`)
	want := strings.Join([]string{
		`const el = root.querySelector('.w');`,
		`if (el) {`,
		`  el.classList.add('in');`,
		`  setTimeout(function () {`,
		`    el.classList.remove('in');`,
		`  }, 500);`,
		`}`,
	}, "\n")
	if got != want {
		t.Fatalf("js format mismatch:\n%s\n--- want ---\n%s", got, want)
	}

	// Semicolons inside string literals never split lines.
	lit := `el.textContent = 'a; b; c';`
	if JS(lit) != lit {
		t.Fatalf("string literal mangled: %q", JS(lit))
	}

	pre := "let a = 1\nlet b = 2"
	if JS(pre) != pre {
		t.Fatalf("pre-formatted js should pass through: %q", JS(pre))
	}
}

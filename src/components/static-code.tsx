// Read-only code, highlighted at render time (works in a server component, so
// no editor or runtime JS reaches the browser). Same colours as the editor
// (src/lib/code-theme.ts) and the same font, size, line height and padding
// as CodeMirror's .cm-content (globals.css, code-editor.tsx).
import { highlightCode, tagHighlighter, type Tag } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import { parser as python } from "@lezer/python";
import { CODE_TOKENS } from "@/lib/code-theme";

/** Grammars for static code. A language not listed renders as plain text. */
const PARSERS: Partial<Record<string, Parser>> = { python };

const highlighter = tagHighlighter(CODE_TOKENS.map((tok, i) => ({ tag: tok.tag as Tag | Tag[], class: `t${i}` })));

type Span = { text: string; style?: React.CSSProperties };

/** Splits code into styled spans and line breaks. Exported for tests. */
export function highlightSpans(code: string, language: string): Span[] {
  const parser = PARSERS[language];
  if (!parser) return [{ text: code }];
  const out: Span[] = [];
  highlightCode(
    code,
    parser.parse(code),
    highlighter,
    (text, classes) => {
      if (!classes) return void out.push({ text });
      const style: React.CSSProperties = {};
      for (const c of classes.split(" ")) {
        const tok = CODE_TOKENS[Number(c.slice(1))];
        if (tok) Object.assign(style, { color: tok.color, fontStyle: tok.fontStyle, fontWeight: tok.fontWeight });
      }
      out.push({ text, style });
    },
    () => out.push({ text: "\n" }),
  );
  return out;
}

export function StaticCode({ code, language, label }: { code: string; language: string; label: string }) {
  return (
    <pre
      aria-label={label}
      className="min-h-[72px] overflow-x-auto whitespace-pre py-3 font-mono text-[13.5px] leading-[1.65] text-fg"
    >
      {highlightSpans(code, language).map((s, i) => (s.style ? <span key={i} style={s.style}>{s.text}</span> : s.text))}
    </pre>
  );
}

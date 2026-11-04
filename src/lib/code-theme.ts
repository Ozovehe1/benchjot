// Syntax colours for code: one table, used by the live editor (CodeMirror
// HighlightStyle in code-editor.tsx) and by static code (static-code.tsx).
// Colours are the app's CSS variables, so both follow light/dark.
import { tags as t, type Tag } from "@lezer/highlight";

export interface CodeToken {
  tag: Tag | readonly Tag[];
  color?: string;
  fontStyle?: "italic";
  fontWeight?: string;
}

export const CODE_TOKENS: readonly CodeToken[] = [
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--hl-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--hl-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--hl-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [t.className, t.typeName], color: "var(--hl-type)" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--muted)" },
  { tag: t.heading, fontWeight: "600" },
];

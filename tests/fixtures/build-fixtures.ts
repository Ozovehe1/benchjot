// Expands the hand-written case files into the JSON fixtures Android copies (see
// scripts/write-fixtures.mjs). Only the cases' own expected answers go in, never the implementation's.
// Imports are relative with extensions so plain `node --experimental-strip-types` can load this file.
import { CHECK_SHORTCUT_CASES, MARKDOWN_FORMAT_CASES, MARKDOWN_FORMAT_EXPLICIT, parseCase } from "./markdown-format.ts";
import { CONTINUE_LIST_CASES, FORMAT_STATE_CASES, LIVE_RULES, LIVE_SPAN_CASES, TOGGLE_CHECK_CASES } from "./live-markdown.ts";

const caret = (s: string) => {
  const c = parseCase(s);
  return { text: c.text, caret: c.start };
};

export function buildFixtures(): Record<string, unknown> {
  const markdownFormat = [
    ...MARKDOWN_FORMAT_CASES.map(([input, format, output]) => ({ input: parseCase(input), format, output: parseCase(output) })),
    ...MARKDOWN_FORMAT_EXPLICIT,
  ];
  const live = {
    rules: LIVE_RULES,
    liveSpans: LIVE_SPAN_CASES.map(([name, text, activeFrom, activeTo, spans]) => ({
      name, text, activeFrom, activeTo, spans: spans.map(([kind, from, to]) => ({ from, to, kind })),
    })),
    toggleCheck: TOGGLE_CHECK_CASES.map(([text, lineStart, output]) => ({ text, lineStart, output })),
    continueList: CONTINUE_LIST_CASES.map(([input, output]) => ({ input: caret(input), output: output === null ? null : parseCase(output) })),
    formatState: FORMAT_STATE_CASES.map(([input, expected]) => ({ input: parseCase(input), expected })),
    checkShortcut: CHECK_SHORTCUT_CASES.map(([input, output]) => ({ input: caret(input), output: output === null ? null : parseCase(output) })),
  };
  return { "markdown_format.json": markdownFormat, "live_markdown.json": live };
}

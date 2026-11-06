import { describe, expect, it } from "vitest";
import { continueList, formatState, liveSpans, toggleCheck } from "@/lib/live-markdown";
import { expandCheckShortcut } from "@/lib/markdown-format";
import { CONTINUE_LIST_CASES, FORMAT_STATE_CASES, LIVE_SPAN_CASES, TOGGLE_CHECK_CASES } from "./fixtures/live-markdown";
import { CHECK_SHORTCUT_CASES, parseCase } from "./fixtures/markdown-format";

describe("liveSpans", () => {
  it.each(LIVE_SPAN_CASES)("%s", (_name, text, a, b, spans) => {
    expect(liveSpans(text, a, b)).toEqual(spans.map(([kind, from, to]) => ({ from, to, kind })));
  });
  it("never emits empty, out-of-range or unsorted spans", () => {
    for (const [, text, a, b] of LIVE_SPAN_CASES) {
      const s = liveSpans(text, a, b);
      for (const x of s) expect(x.from < x.to && x.from >= 0 && x.to <= text.length).toBe(true);
      for (let i = 1; i < s.length; i++) expect(s[i]!.from >= s[i - 1]!.from).toBe(true);
    }
  });
});

describe("toggleCheck", () => {
  it.each(TOGGLE_CHECK_CASES)("%j at %i", (text, at, want) => expect(toggleCheck(text, at)).toBe(want));
  it("is its own inverse", () => expect(toggleCheck(toggleCheck("- [ ] a", 0), 0)).toBe("- [ ] a"));
});

describe("continueList", () => {
  it.each(CONTINUE_LIST_CASES)("%j", (input, want) => {
    const i = parseCase(input);
    expect(continueList(i.text, i.start)).toEqual(want === null ? null : parseCase(want));
  });
});

describe("formatState", () => {
  it.each(FORMAT_STATE_CASES)("%j", (input, want) => {
    const i = parseCase(input);
    expect(formatState(i.text, i.start, i.end)).toEqual(want);
  });
});

describe("[] shortcut", () => {
  it.each(CHECK_SHORTCUT_CASES)("%j", (input, want) => {
    const i = parseCase(input);
    expect(expandCheckShortcut(i.text, i.start)).toEqual(want === null ? null : parseCase(want));
  });
});

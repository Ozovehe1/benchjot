// The live text block's CodeMirror wiring, on EditorState (no DOM): commands, Enter, the [] shortcut,
// per-block history, and the span -> decoration mapping.
import { readFileSync } from "node:fs";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { MARKDOWN_FORMATS } from "@/lib/markdown-format";
import { blockState, decorationsFor, enterCommand, formatCommand, liveExtensions, undo } from "@/lib/live-editor";
import { liveSpans } from "@/lib/live-markdown";

function make(doc: string, at = doc.length, end = at) {
  return EditorState.create({ doc, selection: { anchor: at, head: end }, extensions: liveExtensions("Note") });
}
function exec(state: EditorState, cmd: (t: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean) {
  let out = state;
  cmd({ state, dispatch: (tr) => (out = tr.state) });
  return out;
}
function type(state: EditorState, s: string) {
  for (const ch of s) {
    const at = state.selection.main.head;
    state = state.update({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: "input.type" }).state;
  }
  return state;
}

describe("live text block commands", () => {
  it("runs every format command as one undoable step", () => {
    // Indent / outdent act on list lines only.
    const doc = (f: string) => (f === "indent" ? "- a word here" : f === "outdent" ? "  - a word here" : "a word here");
    for (const f of MARKDOWN_FORMATS) {
      const s0 = make(doc(f), 2, 6);
      const s1 = exec(s0, formatCommand(f));
      expect(s1.doc.toString(), f).not.toBe(doc(f));
      expect(blockState(s1).canUndo, f).toBe(true);
      expect(exec(s1, undo).doc.toString(), f).toBe(doc(f));
    }
    expect(exec(make("plain", 2), formatCommand("indent")).doc.toString()).toBe("plain");
  });
  it("Enter continues and ends lists", () => {
    let s = exec(make("1. a"), enterCommand);
    expect(s.doc.toString()).toBe("1. a\n2. ");
    s = exec(s, enterCommand);
    expect(s.doc.toString()).toBe("1. a\n");
    expect(exec(make("plain"), enterCommand).doc.toString()).toBe("plain\n");
  });
  it("[] at a line start becomes a checklist item", () => {
    expect(type(make(""), "[] ").doc.toString()).toBe("- [ ] ");
    expect(type(make("x "), "[] ").doc.toString()).toBe("x [] ");
  });
  it("each block keeps its own history", () => {
    const a = type(make(""), "abc");
    const b = make("other");
    expect(blockState(a).canUndo).toBe(true);
    expect(blockState(b).canUndo).toBe(false);
    expect(blockState(b).canRedo).toBe(false);
  });
  it("lights the formats at the cursor", () => {
    expect(blockState(make("a **bold** c", 5)).format.bold).toBe(true);
    expect(blockState(make("## H", 4)).format.heading).toBe(2);
  });
});

describe("decorations", () => {
  const lineFrom = (text: string) => (p: number) => text.lastIndexOf("\n", p - 1) + 1;
  it("maps every span kind without throwing, and renders math only off the active line", () => {
    const text = "# T\n- [ ] a $x$\n- b\n  - c\n1. d\n> q\n---\n`c` **b** _i_ ~~s~~ [l](u) [[N]]\n```\nx\n```\n| a |";
    const off = decorationsFor(text, liveSpans(text, -1, -1), lineFrom(text));
    expect(off.length).toBeGreaterThan(20);
    const math = (ds: ReturnType<typeof decorationsFor>) => ds.filter((d) => d.from === text.indexOf("$x$") + 1 && d.to === text.indexOf("$x$") + 2);
    expect(math(off)[0]!.value.spec.widget).toBeTruthy();
    const on = decorationsFor(text, liveSpans(text, 5, 5), lineFrom(text));
    expect(math(on)[0]!.value.spec.class).toBe("cm-md-math");
  });
});

describe("format bar wiring", () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  it("48px targets, focus kept in the block, one shared slot in the note", () => {
    const bar = src("components/format-bar.tsx");
    expect(bar).toContain("h-12 w-12");
    expect(bar).toContain("onMouseDown: (e: React.MouseEvent) => e.preventDefault()");
    expect(bar).toContain("sticky top-0");
    const view = src("components/entry-view.tsx");
    expect(view.match(/<FormatBarSlot \/>/g)).toHaveLength(1);
    expect(view).toContain("<FormatBarProvider>");
  });
  it("orders the bar Undo, Redo, Heading, Bold, List, Checklist, then the rest", async () => {
    const { BAR_ORDER, PINNED_COUNT } = await import("@/components/format-bar");
    expect(BAR_ORDER.slice(0, PINNED_COUNT)).toEqual(["undo", "redo", "heading", "bold", "list", "checklist"]);
    expect(BAR_ORDER.slice(PINNED_COUNT)).toEqual(["italic", "strike", "quote", "indent", "outdent", "code", "math", "link"]);
  });
});

// CodeMirror wiring for one live Markdown text block (the note body today; later several blocks
// between code cells). It only paints what the pure core answers (src/lib/live-markdown.ts) and runs
// the format commands (src/lib/markdown-format.ts) as state commands, so most of it is testable on an
// EditorState with no DOM. Code cells use code-editor.tsx and never get any of this.
import { EditorSelection, EditorState, StateEffect, StateField, type Extension, type Range, type StateCommand, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, insertNewline, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import katex from "katex";
import { continueList, formatState, liveSpans, toggleCheck, type Edit, type FormatState, type LiveKind, type LiveSpan } from "./live-markdown";
import { applyFormat, expandCheckShortcut, type MarkdownFormat } from "./markdown-format";

// ---- colours: which theme token each live element uses (the contrast test checks these pairs) ----

/** CSS variable (without --) for each live element's text colour. */
export const LIVE_COLORS = {
  text: "fg",
  marker: "muted",
  done: "muted",
  quote: "muted",
  quoteRule: "muted",
  wikilink: "fg",
  link: "fg",
  code: "fg",
  codeBg: "tint",
  divider: "muted",
  checkbox: "fg",
  checkboxMark: "bg",
  bullet: "fg",
  placeholder: "faint",
} as const;
const v = (k: keyof typeof LIVE_COLORS) => `var(--${LIVE_COLORS[k]})`;

// ---- applying a pure Edit as a minimal change (keeps history granular and the cursor stable) ----

/** The smallest change turning `from` into `to.text`, plus the edit's selection. */
export function editSpec(from: string, to: Edit) {
  let a = 0;
  const max = Math.min(from.length, to.text.length);
  while (a < max && from[a] === to.text[a]) a++;
  let b = 0;
  while (b < max - a && from[from.length - 1 - b] === to.text[to.text.length - 1 - b]) b++;
  return {
    changes: { from: a, to: from.length - b, insert: to.text.slice(a, to.text.length - b) },
    selection: EditorSelection.single(to.start, to.end),
  };
}

/** A format-bar command for this text block. */
export function formatCommand(format: MarkdownFormat): StateCommand {
  return ({ state, dispatch }) => {
    const sel = state.selection.main;
    const text = state.doc.toString();
    const next = applyFormat(text, sel.from, sel.to, format);
    if (next.text === text && next.start === sel.from && next.end === sel.to) return false;
    dispatch(state.update({ ...editSpec(text, next), scrollIntoView: true, userEvent: `format.${format}` }));
    return true;
  };
}

/** Enter: continue or end a list (continueList); anything else is a plain newline. */
export const enterCommand: StateCommand = (target) => {
  const { state, dispatch } = target;
  const sel = state.selection.main;
  if (sel.empty) {
    const text = state.doc.toString();
    const next = continueList(text, sel.head);
    if (next) {
      dispatch(state.update({ ...editSpec(text, next), scrollIntoView: true, userEvent: "input" }));
      return true;
    }
  }
  return insertNewline(target);
};

/** Typing `[] ` at a line start becomes `- [ ] ` (as part of the same undo step). */
const checkShortcut = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || !tr.isUserEvent("input.type") || !tr.newSelection.main.empty) return tr;
  const text = tr.newDoc.toString();
  const next = expandCheckShortcut(text, tr.newSelection.main.head);
  if (!next) return tr;
  return [tr, { ...editSpec(text, next), sequential: true }];
});

/** Flips the checkbox on the line starting at `lineFrom` (the tappable checkbox widget). */
export function toggleCheckAt(view: EditorView, lineFrom: number): void {
  const text = view.state.doc.toString();
  const next = toggleCheck(text, lineFrom);
  if (next === text) return;
  const sel = view.state.selection.main;
  view.dispatch({ ...editSpec(text, { text: next, start: sel.anchor, end: sel.head }), userEvent: "input.check" });
}

// ---- widgets ----

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = "•";
    s.setAttribute("aria-hidden", "true");
    return s;
  }
}

class IndentWidget extends WidgetType {
  constructor(readonly levels: number) { super(); }
  eq(o: IndentWidget) { return o.levels === this.levels; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-indent";
    s.style.paddingLeft = `${this.levels * 1.5}em`;
    return s;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly done: boolean, readonly lineFrom: number) { super(); }
  eq(o: CheckboxWidget) { return o.done === this.done && o.lineFrom === this.lineFrom; }
  toDOM(view: EditorView) {
    const b = document.createElement("span");
    b.className = "cm-md-check";
    b.setAttribute("role", "checkbox");
    b.setAttribute("aria-checked", String(this.done));
    b.setAttribute("aria-label", this.done ? "Done" : "Not done");
    b.dataset.done = String(this.done);
    // A tap flips this one line; mousedown is cancelled so the caret doesn't jump onto the line.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      toggleCheckAt(view, view.state.doc.lineAt(Math.min(this.lineFrom, view.state.doc.length)).from);
    });
    return b;
  }
  ignoreEvent() { return true; }
}

class DividerWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-divider";
    s.setAttribute("role", "separator");
    return s;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly tex: string) { super(); }
  eq(o: MathWidget) { return o.tex === this.tex; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-math-render";
    try {
      s.innerHTML = katex.renderToString(this.tex, { throwOnError: false, output: "html" });
    } catch {
      s.textContent = this.tex;
    }
    return s;
  }
}

const MARK_CLASS: Partial<Record<LiveKind, string>> = {
  marker: "cm-md-marker", h1: "cm-md-h1", h2: "cm-md-h2", h3: "cm-md-h3", quote: "cm-md-quote",
  ordered: "cm-md-ordered", done: "cm-md-done", fence: "cm-md-fence", table: "cm-md-table",
  bold: "cm-md-bold", italic: "cm-md-italic", strike: "cm-md-strike", code: "cm-md-code", math: "cm-md-math",
  link: "cm-md-link", wikilink: "cm-md-wikilink",
};
const LINE_CLASS: Partial<Record<LiveKind, string>> = {
  h1: "cm-md-line-h1", h2: "cm-md-line-h2", h3: "cm-md-line-h3", quote: "cm-md-line-quote", fence: "cm-md-line-fence",
};
const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const divider = Decoration.replace({ widget: new DividerWidget() });

/** Maps the core's spans to CodeMirror decorations. Exported for tests. */
export function decorationsFor(text: string, spans: readonly LiveSpan[], lineFromOf: (pos: number) => number): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  const hides = new Set(spans.filter((s) => s.kind === "hide").map((s) => s.to));
  const lines = new Set<string>();
  for (const s of spans) {
    switch (s.kind) {
      case "hide": out.push(hidden.range(s.from, s.to)); break;
      case "bullet": out.push(bullet.range(s.from, s.to)); break;
      case "divider": out.push(divider.range(s.from, s.to)); break;
      case "indent": out.push(Decoration.replace({ widget: new IndentWidget(Math.ceil((s.to - s.from) / 2)) }).range(s.from, s.to)); break;
      case "check_open":
      case "check_done":
        out.push(Decoration.replace({ widget: new CheckboxWidget(s.kind === "check_done", lineFromOf(s.from)) }).range(s.from, s.to));
        break;
      case "math":
        // Off the active line (its $ markers are hidden) the formula renders; on it, the source shows.
        if (hides.has(s.from)) out.push(Decoration.replace({ widget: new MathWidget(text.slice(s.from, s.to)) }).range(s.from, s.to));
        else out.push(Decoration.mark({ class: MARK_CLASS.math! }).range(s.from, s.to));
        break;
      default: {
        const cls = MARK_CLASS[s.kind];
        if (cls) out.push(Decoration.mark({ class: cls }).range(s.from, s.to));
      }
    }
    const lc = LINE_CLASS[s.kind];
    const lf = lineFromOf(s.from);
    if (lc && !lines.has(`${lf}:${lc}`)) {
      lines.add(`${lf}:${lc}`);
      out.push(Decoration.line({ class: lc }).range(lf));
    }
  }
  return out;
}

// ---- the live view state ----

const setFocus = StateEffect.define<boolean>();

interface Live {
  focused: boolean;
  deco: DecorationSet;
}

function build(state: EditorState, focused: boolean): DecorationSet {
  const text = state.doc.toString();
  const sel = state.selection.main;
  const spans = focused ? liveSpans(text, sel.from, sel.to) : liveSpans(text, -1, -1);
  return Decoration.set(decorationsFor(text, spans, (p) => state.doc.lineAt(p).from), true);
}

/** Decorations live in a StateField (not a ViewPlugin) so block-level replacements are allowed. */
export const liveField = StateField.define<Live>({
  create: (state) => ({ focused: false, deco: build(state, false) }),
  update(live, tr) {
    let focused = live.focused;
    for (const e of tr.effects) if (e.is(setFocus)) focused = e.value;
    if (!tr.docChanged && !tr.selection && focused === live.focused) return live;
    return { focused, deco: build(tr.state, focused) };
  },
  provide: (f) => EditorView.decorations.from(f, (l) => l.deco),
});

/** What the shared format bar shows for this block. */
export interface BlockState {
  format: FormatState;
  canUndo: boolean;
  canRedo: boolean;
}

export function blockState(state: EditorState): BlockState {
  const sel = state.selection.main;
  return { format: formatState(state.doc.toString(), sel.from, sel.to), canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 };
}

export { undo, redo };

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: v("text") },
  // Prose size, over globals.css's 13.5px for code editors (two classes beat one).
  "&.cm-editor": { fontSize: "16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-sans) !important", lineHeight: "1.75 !important" },
  ".cm-content": { caretColor: v("text"), padding: "8px 0", minHeight: "6rem" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: v("text") },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--fg) 18%, transparent) !important",
  },
  ".cm-placeholder": { color: v("placeholder") },
  ".cm-md-marker": { color: v("marker") },
  ".cm-md-h1": { fontSize: "1.5em", fontWeight: "650", letterSpacing: "-0.01em" },
  ".cm-md-h2": { fontSize: "1.25em", fontWeight: "650" },
  ".cm-md-h3": { fontSize: "1.08em", fontWeight: "650" },
  ".cm-md-line-h1, .cm-md-line-h2, .cm-md-line-h3": { lineHeight: "1.4", paddingTop: "0.35em !important" },
  ".cm-md-line-quote": { borderLeft: `3px solid ${v("quoteRule")}`, paddingLeft: "0.9em !important" },
  ".cm-md-quote": { color: v("quote") },
  ".cm-md-bold": { fontWeight: "650" },
  ".cm-md-italic": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through" },
  ".cm-md-done": { color: v("done"), textDecoration: "line-through" },
  ".cm-md-code, .cm-md-math": { fontFamily: "var(--font-mono)", fontSize: "0.9em", backgroundColor: v("codeBg"), color: v("code"), borderRadius: "4px", padding: "0.1em 0.25em" },
  ".cm-md-fence, .cm-md-table": { fontFamily: "var(--font-mono)", fontSize: "0.88em", color: v("code") },
  ".cm-md-line-fence": { backgroundColor: v("codeBg") },
  ".cm-md-link, .cm-md-wikilink": { color: v("link"), textDecoration: "underline", textUnderlineOffset: "3px", textDecorationColor: v("marker") },
  ".cm-md-wikilink": { textDecorationStyle: "solid", fontWeight: "500" },
  ".cm-md-ordered": { color: v("bullet"), fontVariantNumeric: "tabular-nums" },
  ".cm-md-bullet": { display: "inline-block", width: "1.4em", color: v("bullet"), fontWeight: "700" },
  ".cm-md-divider": { display: "inline-block", width: "100%", height: "0", borderTop: `2px solid ${v("divider")}`, verticalAlign: "middle" },
  ".cm-md-check": {
    position: "relative", display: "inline-block", boxSizing: "border-box", width: "1.1em", height: "1.1em", marginRight: "0.5em",
    verticalAlign: "-0.15em", border: `2px solid ${v("checkbox")}`, borderRadius: "4px", cursor: "pointer",
  },
  // 48px hit area around the 18px box, without changing the line height.
  ".cm-md-check::before": { content: '""', position: "absolute", inset: "-15px" },
  ".cm-md-check[data-done=true]": { backgroundColor: v("checkbox") },
  ".cm-md-check[data-done=true]::after": {
    content: '""', position: "absolute", left: "0.3em", top: "0.08em", width: "0.25em", height: "0.5em",
    border: `solid ${v("checkboxMark")}`, borderWidth: "0 2px 2px 0", transform: "rotate(45deg)",
  },
  ".cm-md-math-render": { padding: "0 0.1em" },
});

/** Everything one live text block needs; `extra` carries the component's own listeners. */
export function liveExtensions(label: string, extra: Extension[] = []): Extension[] {
  return [
    history(),
    liveField,
    checkShortcut,
    keymap.of([{ key: "Enter", run: enterCommand }, ...historyKeymap, ...defaultKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true", autocapitalize: "sentences", spellcheck: "true" }),
    EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing)),
    theme,
    ...extra,
  ];
}

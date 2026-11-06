"use client";
// The one format bar for every live text block in a note (the user's, 2026-11-06). Text blocks
// report themselves while focused (FormatBarProvider); FormatBarSlot shows a single shared bar for
// whichever has focus, or that block's [[ link suggestions in the same slot. Phones (coarse pointer or
// narrow): pinned above the keyboard. Desktop: sticky where the slot is placed.
// Code cells never report here, so the bar and its commands can't reach them.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import type { NoteRef } from "@/lib/links";
import { formatCommand, redo, undo, type BlockState } from "@/lib/live-editor";
import { MARKDOWN_FORMATS, SHEET_FORMATS, type MarkdownFormat } from "@/lib/markdown-format";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/format";

export interface Suggest {
  notes: NoteRef[];
  active: number;
  pick: (n: NoteRef) => void;
}

/** What a focused text block reports to the shared bar. */
export interface ActiveBlock {
  id: string;
  view: EditorView;
  state: BlockState;
  suggest: Suggest | null;
}

type Report = (id: string, block: ActiveBlock | null) => void;
const ReportCtx = createContext<Report | null>(null);
const ActiveCtx = createContext<ActiveBlock | null>(null);

export function FormatBarProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveBlock | null>(null);
  const report = useCallback<Report>((id, block) => {
    setActive((cur) => (block ? block : cur?.id === id ? null : cur));
  }, []);
  return (
    <ReportCtx.Provider value={report}>
      <ActiveCtx.Provider value={active}>{children}</ActiveCtx.Provider>
    </ReportCtx.Provider>
  );
}

/** For text blocks: report focus/state to the shared bar. Throws outside a provider (a wiring bug). */
export function useReportBlock(): Report {
  const r = useContext(ReportCtx);
  if (!r) throw new Error("A live text block must be inside <FormatBarProvider>.");
  return r;
}

// ---- buttons ----

type BarAction = "undo" | "redo" | MarkdownFormat;

/** Bar order: Undo, Redo, then the formats (the first six stay put, the rest scroll; Divider and Table are in the + sheet). */
export const BAR_ORDER: readonly BarAction[] = ["undo", "redo", ...MARKDOWN_FORMATS.filter((f) => !SHEET_FORMATS.includes(f))];
export const PINNED_COUNT = 6;

// Material Symbols (Apache 2.0) paths, 24px grid.
const ICON: Record<string, string> = {
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z",
  bold: "M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z",
  italic: "M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z",
  strike: "M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z",
  quote: "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z",
  indent: "M3 21h18v-2H3v2zM3 8v8l4-4-4-4zm8 9h10v-2H11v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  outdent: "M11 17h10v-2H11v2zm-8-5l4 4V8l-4 4zm0 9h18v-2H3v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  code: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
  math: "M18 4H6v2l6.5 6L6 18v2h12v-3h-7l5-5-5-5h7z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  bullet: "M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z",
  ordered: "M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z",
  checklist: "M22 7h-9v2h9V7zm0 8h-9v2h9v-2zM5.54 11L2 7.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 11zm0 8L2 15.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 19z",
  more: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  divider: "M4 11h16v2H4z",
  table: "M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM8 19H4v-4h4v4zm0-6H4V9h4v4zm6 6h-4v-4h4v4zm0-6h-4V9h4v4zm6 6h-4v-4h4v4zm0-6h-4V9h4v4zm0-6H4V5h16v2z",
};

export const BUTTON_NAMES: Record<BarAction, string> = {
  undo: "Undo", redo: "Redo", heading: "Heading", bold: "Bold", list: "List", checklist: "Checklist",
  italic: "Italic", strike: "Strikethrough", quote: "Quote", indent: "Indent", outdent: "Outdent",
  code: "Code", math: "Math", link: "Link", divider: "Divider", table: "Table",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="currentColor">
      <path d={ICON[name]} />
    </svg>
  );
}

/** Is this action lit (on) / usable at the cursor? */
function lit(a: BarAction, s: BlockState): boolean {
  const f = s.format;
  switch (a) {
    case "heading": return f.heading > 0;
    case "list": return f.list !== null;
    case "checklist": return f.list === "check";
    case "bold": case "italic": case "strike": case "quote": case "code": case "math": case "link": return f[a];
    default: return false;
  }
}
function enabled(a: BarAction, s: BlockState): boolean {
  if (a === "undo") return s.canUndo;
  if (a === "redo") return s.canRedo;
  if (a === "indent" || a === "outdent") return s.format.list !== null;
  return true;
}

function run(view: EditorView, a: BarAction) {
  if (a === "undo") undo(view);
  else if (a === "redo") redo(view);
  else formatCommand(a)(view);
  view.focus();
}

function BarButton({ action, state, onPress }: { action: BarAction; state: BlockState; onPress: () => void }) {
  const on = lit(action, state);
  const ok = enabled(action, state);
  const heading = action === "heading";
  const icon = action === "list" ? (state.format.list === "ordered" ? "ordered" : state.format.list === "check" ? "checklist" : "bullet") : action;
  const toggle = action !== "undo" && action !== "redo" && action !== "indent" && action !== "outdent";
  return (
    <button
      type="button"
      aria-label={heading && state.format.heading ? `Heading ${state.format.heading}` : BUTTON_NAMES[action]}
      title={BUTTON_NAMES[action]}
      aria-pressed={toggle ? on : undefined}
      disabled={!ok}
      onClick={onPress}
      // Material-style: a 48px target with a 40px filled chip when on.
      className="group flex h-12 w-12 shrink-0 items-center justify-center text-fg disabled:cursor-default disabled:text-faint"
    >
      <span
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
          on ? "bg-fg text-bg" : "group-enabled:group-hover:bg-tint group-enabled:group-active:bg-tint",
        )}
      >
        {heading ? (
          <span className="text-[15px] font-semibold leading-none tracking-tight">
            H{state.format.heading ? <sub className="text-[10px]">{state.format.heading}</sub> : null}
          </span>
        ) : (
          <Icon name={icon} />
        )}
      </span>
    </button>
  );
}

function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse), (max-width: 639px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

const keepFocus = {
  // Keep focus (the caret and the keyboard) in the text block when the bar is pressed.
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
};

/** The shared slot: link suggestions when the focused block has some, else the format bar. */
export function FormatBarSlot() {
  const active = useContext(ActiveCtx);
  const phone = usePhoneLayout();
  const bottom = useKeyboardInset();
  if (!active) return null;
  const content =
    active.suggest && active.suggest.notes.length ? <Suggestions {...active.suggest} /> : <Bar key={active.id} active={active} />;
  if (!phone) return <div className="sticky top-0 z-20 -mx-1">{content}</div>;
  return createPortal(
    <div style={{ bottom }} className="fixed inset-x-0 z-50 mx-auto max-w-[720px]">
      {content}
    </div>,
    document.body,
  );
}

function Bar({ active }: { active: ActiveBlock }) {
  const { view, state } = active;
  // The + sheet (Divider, Table); closes with a new block (Bar is keyed by block id).
  const [sheet, setSheet] = useState(false);
  const pinned = BAR_ORDER.slice(0, PINNED_COUNT);
  const scroll = BAR_ORDER.slice(PINNED_COUNT);
  return (
    <div {...keepFocus} className="relative">
      {sheet && (
        <div role="menu" aria-label="Insert" className="absolute bottom-full right-2 mb-2 min-w-44 overflow-hidden rounded-xl border border-line bg-bg py-1 shadow-lg sm:bottom-auto sm:top-full sm:mt-2 sm:mb-0">
          {SHEET_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              role="menuitem"
              onClick={() => {
                setSheet(false);
                run(view, f);
              }}
              className="flex h-12 w-full items-center gap-3 px-4 text-left text-sm text-fg hover:bg-tint active:bg-tint"
            >
              <Icon name={f} />
              {BUTTON_NAMES[f]}
            </button>
          ))}
        </div>
      )}
      <div role="toolbar" aria-label="Format" className="flex items-center border-y border-line bg-bg sm:rounded-b-none">
        <div className="flex shrink-0">
          {pinned.map((a) => (
            <BarButton key={a} action={a} state={state} onPress={() => run(view, a)} />
          ))}
        </div>
        <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line" />
        <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          {scroll.map((a) => (
            <BarButton key={a} action={a} state={state} onPress={() => run(view, a)} />
          ))}
          <button
            type="button"
            aria-label="Insert"
            title="Insert divider or table"
            aria-haspopup="menu"
            aria-expanded={sheet}
            onClick={() => setSheet(!sheet)}
            className="group flex h-12 w-12 shrink-0 items-center justify-center text-fg"
          >
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-full transition-colors", sheet ? "bg-fg text-bg" : "group-hover:bg-tint")}>
              <Icon name="more" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Suggestions({ notes, active, pick }: Suggest) {
  return (
    <ul id="link-suggestions" role="listbox" aria-label="Link to note" {...keepFocus} className="divide-y divide-line border-y border-line bg-bg sm:border-x">
      {notes.map((n, i) => (
        <li key={n.id} role="option" aria-selected={i === active}>
          <button
            type="button"
            onClick={() => pick(n)}
            className={cn("flex h-12 w-full items-center truncate px-5 text-left text-sm sm:px-8", i === active ? "bg-tint text-fg" : "text-muted")}
          >
            <span className="truncate">{n.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

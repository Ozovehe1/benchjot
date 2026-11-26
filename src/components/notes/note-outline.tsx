"use client";
// The note's table of contents: the Markdown headings written in the note's text and cell notes, as
// Jupyter's, and every code cell ("Cell 3", with its title if it has one), each under the heading above
// it (lib/notes/outline.ts). A tap goes there. On a wide screen it stays beside the note; narrower, it
// folds into "Contents" above the cells.
import { contents, type ContentsHeading, type ContentsItem } from "@/lib/notes/outline";
import { IconChevron } from "../ui";

/** Where a place's headings are on the page: the note's text, or one of a cell's notes. */
function placeElement(item: ContentsHeading): HTMLElement | null {
  if (item.place.kind === "body") return document.getElementById("note-body");
  return document.querySelector<HTMLElement>(`#cell-${CSS.escape(item.place.id)} [data-cell-note="${item.place.side}"]`);
}

/** Scrolls to the heading: the place's nth heading, as the editor (a line class) or Preview (h1–h3) shows it. */
function goToHeading(item: ContentsHeading) {
  const place = placeElement(item);
  const headings = place?.querySelectorAll<HTMLElement>(".cm-md-line-h1, .cm-md-line-h2, .cm-md-line-h3, h1, h2, h3");
  (headings?.[item.index] ?? place)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Items({ items, onCell }: { items: readonly ContentsItem[]; onCell: (id: string) => void }) {
  const levels = items.map((i) => (i.kind === "heading" ? i.level : i.under + 1));
  const top = Math.min(...levels);
  return (
    <ol className="space-y-0.5">
      {items.map((it, k) => (
        <li key={it.key}>
          <button
            type="button"
            onClick={() => (it.kind === "heading" ? goToHeading(it) : onCell(it.id))}
            style={{ paddingLeft: `${0.5 + (levels[k]! - top) * 0.875}rem` }}
            className={`flex min-h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors hover:bg-tint hover:text-fg ${it.kind === "cell" ? "text-muted" : levels[k] === top ? "text-fg/90" : "text-muted"}`}
          >
            {it.kind === "heading" ? (
              <span className="min-w-0 truncate">{it.text}</span>
            ) : (
              <>
                <span className="shrink-0 font-mono text-[12px] text-faint">Cell {it.n}</span>
                {it.title && <span className="min-w-0 truncate">{it.title}</span>}
              </>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function NoteOutline({ body, cells, onGo }: { body: string; cells: readonly { id: string; filename?: string | null; note_before?: string | null; note_after?: string | null }[]; onGo: (cellId: string) => void }) {
  const items = contents(body, cells);
  if (items.length < 2) return null;
  return (
    <>
      {/* Wide screens: beside the note, always there. */}
      <nav aria-label="Contents" className="fixed right-6 top-24 z-10 hidden max-h-[calc(100vh-8rem)] w-56 overflow-y-auto min-[1600px]:block">
        <p className="eyebrow mb-2 px-2">Contents</p>
        <Items items={items} onCell={onGo} />
      </nav>
      {/* Narrower: folded, above the cells. */}
      <details className="group mb-4 rounded-xl bg-raise min-[1600px]:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm text-muted [&::-webkit-details-marker]:hidden">
          Contents
          <IconChevron className="size-4 rotate-90 text-faint transition-transform group-open:-rotate-90" />
        </summary>
        <nav aria-label="Contents" className="px-2 pb-2">
          <Items items={items} onCell={onGo} />
        </nav>
      </details>
    </>
  );
}

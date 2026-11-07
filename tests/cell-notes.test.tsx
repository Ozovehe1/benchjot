// Cell notes ("Note before run" / "Note after run"): the collapse rule and labels from the shared
// cases, the schema cap, where the notes sit around a cell (editor and read-only), and that empty
// ones leave old notes looking as they did.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { NotePreview } from "@/components/note-preview";
import { CellNoteText } from "@/components/note-parts";
import { CELL_NOTE_LABELS, cellNoteName, isCellNoteEmpty, MAX_CELL_NOTE } from "@/lib/cell-notes";
import { snippetPatch, type Snippet } from "@/lib/schemas";
import { CELL_NOTE_LABELS as SHARED_LABELS, COLLAPSE_CASES } from "./fixtures/cell-notes";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("collapse rule (cell_notes.json)", () => {
  it.each(COLLAPSE_CASES)("%j collapsed: %s", (text, collapsed) => {
    expect(isCellNoteEmpty(text)).toBe(collapsed);
  });
  it("uses the shared labels, exactly", () => {
    expect(CELL_NOTE_LABELS).toEqual(SHARED_LABELS);
    expect(CELL_NOTE_LABELS).toEqual({ before: "Note before run", after: "Note after run" });
  });
});

describe("accessible names", () => {
  it("name the label and the cell's file, else Code N like its editor", () => {
    expect(cellNoteName("before", "digits.py", 0)).toBe("Note before run, digits.py");
    expect(cellNoteName("after", "  ", 2)).toBe("Note after run, Code 3");
  });
});

describe("snippetPatch", () => {
  it("takes cell notes up to the column's cap", () => {
    expect(snippetPatch.safeParse({ note_before: "Hypothesis", note_after: "" }).success).toBe(true);
    expect(snippetPatch.safeParse({ note_after: "a".repeat(MAX_CELL_NOTE) }).success).toBe(true);
    const over = snippetPatch.safeParse({ note_before: "a".repeat(MAX_CELL_NOTE + 1) });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toBe("Cell note is over 100k characters");
  });
  it("cap matches the migration's check constraint", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261106200000_cell_notes.sql", import.meta.url), "utf8");
    expect(sql).toContain(`char_length(note_before) <= ${MAX_CELL_NOTE}`);
    expect(sql).toContain(`char_length(note_after) <= ${MAX_CELL_NOTE}`);
  });
});

describe("read-only cell notes", () => {
  it("render nothing when empty or whitespace", () => {
    for (const v of ["", " \n\t"]) expect(renderToStaticMarkup(<CellNoteText side="before" value={v} filename="a.py" index={0} />)).toBe("");
  });
  it("render the text as Markdown, named with label and cell", () => {
    const html = renderToStaticMarkup(<CellNoteText side="after" value={"**Result** overfits"} filename="a.py" index={0} />);
    expect(html).toContain('aria-label="Note after run, a.py"');
    expect(html).toContain("<strong>Result</strong> overfits");
  });

  const cell = {
    id: "s1",
    filename: "train.py",
    language: "python",
    content: "print('hi')",
    last_run: { outcome: "ok", stdout: "hi\n", stderr: "", error_line: null, line: null, ms: 12, where: "browser", code_hash: "x", ran_at: "2026-11-06T18:00:00.000Z" },
  } as const;
  it("sit above the cell and below its output (preview)", () => {
    const html = renderToStaticMarkup(
      <NotePreview entry={{ title: "T", notes: "Body", outcome: null }} snippets={[{ ...cell, note_before: "Expect hi.", note_after: "Got hi." }]} />,
    );
    const at = (s: string) => html.indexOf(s);
    expect(at("Body")).toBeLessThan(at("Expect hi."));
    expect(at("Expect hi.")).toBeLessThan(at(">train.py<"));
    expect(at(">train.py<")).toBeLessThan(at('aria-label="Output"'));
    expect(at('aria-label="Output"')).toBeLessThan(at("Got hi."));
  });
  it("leave a note without them exactly as before (no rows, no labels)", () => {
    const without = renderToStaticMarkup(<NotePreview entry={{ title: "T", notes: "Body", outcome: null }} snippets={[cell]} />);
    const empty = renderToStaticMarkup(<NotePreview entry={{ title: "T", notes: "Body", outcome: null }} snippets={[{ ...cell, note_before: "", note_after: "  " }]} />);
    expect(empty).toBe(without);
    expect(without).not.toContain("Note before run");
  });
});

describe("editor cell notes", () => {
  type Mods = { CellNote: typeof import("@/components/cell-note").CellNote; SnippetBlock: typeof import("@/components/snippet-block").SnippetBlock; SaveStatusProvider: typeof import("@/lib/autosave").SaveStatusProvider; FormatBarProvider: typeof import("@/components/format-bar").FormatBarProvider };
  let m: Mods;
  beforeAll(async () => {
    // data.ts reads the public Supabase config on import; nothing here talks to it.
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test";
    const [cn, sb, as, fb] = await Promise.all([import("@/components/cell-note"), import("@/components/snippet-block"), import("@/lib/autosave"), import("@/components/format-bar")]);
    m = { CellNote: cn.CellNote, SnippetBlock: sb.SnippetBlock, SaveStatusProvider: as.SaveStatusProvider, FormatBarProvider: fb.FormatBarProvider };
  });
  const props = { onChange: () => {}, filename: "train.py", index: 0, notes: [], selfId: "n1" };
  const render = (el: React.ReactElement) => renderToStaticMarkup(<m.FormatBarProvider>{el}</m.FormatBarProvider>);

  it("empty: one compact 48px '+ label' row, named with the cell", () => {
    for (const side of ["before", "after"] as const) {
      for (const value of ["", "  \n"]) {
        const html = render(<m.CellNote side={side} value={value} {...props} />);
        expect(html).toMatch(/^<button type="button" class="[^"]*min-h-12[^"]*text-muted[^"]*"/);
        expect(html).toContain(`aria-label="${CELL_NOTE_LABELS[side]}, train.py"`);
        expect(html).toContain(`<span aria-hidden="true" class="mr-1.5">+</span>${CELL_NOTE_LABELS[side]}</button>`);
      }
    }
  });
  it("filled: the live editor, in a block named with label and cell", () => {
    const html = render(<m.CellNote side="before" value="Hypothesis" {...props} />);
    expect(html).toMatch(/^<section aria-label="Note before run, train.py"/);
    expect(html).not.toContain("<button");
  });
  it("preview: rendered read-only, nothing when empty", () => {
    expect(render(<m.CellNote side="after" value="**done**" preview {...props} />)).toContain("<strong>done</strong>");
    expect(render(<m.CellNote side="after" value="" preview {...props} />)).toBe("");
  });

  it("the code block puts `before` above its header and `after` below its output, above its actions", () => {
    const snippet: Snippet = {
      id: "s1", user_id: "u", entry_id: "n1", filename: "train.py", language: "python", content: "print('hi')", position: 0,
      last_run: { outcome: "ok", stdout: "hi\n", stderr: "", error_line: null, line: null, ms: 12, where: "browser", code_hash: "x", ran_at: "2026-11-06T18:00:00.000Z" },
      note_before: "", note_after: "", created_at: "2026-11-06T18:00:00.000Z", updated_at: "2026-11-06T18:00:00.000Z",
    };
    const html = renderToStaticMarkup(
      <m.SaveStatusProvider>
        <m.SnippetBlock snippet={snippet} index={0} before={<i>BEFORE</i>} after={<i>AFTER</i>} />
      </m.SaveStatusProvider>,
    );
    const at = (s: string) => html.indexOf(s);
    expect(at("BEFORE")).toBeGreaterThan(-1);
    expect(at("BEFORE")).toBeLessThan(at(">train.py<"));
    expect(at(">train.py<")).toBeLessThan(at('aria-label="Output"'));
    expect(at('aria-label="Output"')).toBeLessThan(at("AFTER"));
    expect(at("AFTER")).toBeLessThan(at('<div class="flex gap-5 pb-1">')); // Copy, Download, Remove
  });

  it("the editor wires both notes into every code cell, autosaved and flushed before Remove", () => {
    const view = src("components/entry-view.tsx");
    expect(view).toContain('before={<CellNote side="before"');
    expect(view).toContain('after={<CellNote side="after"');
    expect(view).toContain("onBeforeRemove={cell.flush}");
    expect(src("components/cell-note.tsx")).toMatch(/useAutosave\(\{ note_before: before, note_after: after \}, \(v\) => saveCellNotes\(snippet, v\)/);
    expect(src("components/snippet-block.tsx")).toMatch(/await flush\(\);\s*await onBeforeRemove\?\.\(\);\s*const previous/);
  });

  it("only the user's typing writes them: nothing else in the app sets note_before / note_after", () => {
    const hits = execSync("grep -rlE 'note_(before|after)' src", { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }).trim().split("\n").sort();
    // lib/helper.ts only reads them, into the note the Helper is shown (helper.test.ts checks it writes none).
    expect(hits).toEqual(["src/components/cell-note.tsx", "src/components/note-preview.tsx", "src/lib/cell-notes.ts", "src/lib/data.ts", "src/lib/helper.ts", "src/lib/schemas.ts"]);
    expect(src("lib/run/server-client.ts")).not.toMatch(/note_|cell-note/);
    expect(src("app/api/fix/route.ts")).not.toMatch(/note_|cell-note/);
  });
});

// Exporting a whole note (lib/files/note-export.ts) for use anywhere: a Jupyter notebook, a web page
// and Markdown with its files. Built here from the landing's real two-cell note and its real files;
// scripts check the notebook with Jupyter's own validator (see the it-block's comment).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { cleanStream, runSummary, EXPORT_FORMATS, exportBaseName, notebookLanguage, plainLinks, toMarkdownZip, toNotebook, toWebPage, type ExportNote } from "@/lib/files/note-export";
import { SAMPLE_CELL_IDS, SAMPLE_NOTE, SAMPLE_OUTPUT_URLS, SAMPLE_CELLS } from "@/lib/sample-note";
import raw from "@/lib/sample-run.json" with { type: "json" };
import type { LastRun } from "@/lib/notes/schemas";

const files = (cell: number) => Object.fromEntries(Object.entries(SAMPLE_OUTPUT_URLS[cell]!).map(([name, url]) => [name, new Uint8Array(readFileSync(new URL(`../public${url}`, import.meta.url)))]));
export const SAMPLE_EXPORT: ExportNote = {
  title: SAMPLE_NOTE.title,
  body: SAMPLE_NOTE.notes + "\n\nSee [[Baseline run|9f000000-0000-4000-8000-0000000000e2]] and $a^2 + b^2$.",
  outcome: SAMPLE_NOTE.outcome,
  exportedAt: "2026-11-18T12:00:00.000Z",
  cells: SAMPLE_CELLS.map((s, i) => ({ filename: s.filename, language: s.language, code: s.content, noteBefore: s.note_before, noteAfter: s.note_after, run: raw.cells[i]!.last_run as LastRun, files: files(i) })), // the runs as recorded, with the app's notes of then
};
const md = (s: string) => renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{s}</ReactMarkdown>);

describe("note export", () => {
  it("leaves out Benchjot's own notes and progress bars, keeps what the code printed, and says where it ran", () => {
    const err = "[Benchjot] Ran on a T4 GPU (chosen automatically: …). Add # gpu: none to use the CPU.\n[Benchjot] Server ready in 12 s; your code ran for 10:11.\n100%|██████████| 9.91M/9.91M [00:00<00:00, 12.5MB/s]\nTrain: 45%|████▌     | 450/1000\nUserWarning: lr is high\n";
    expect(cleanStream(err)).toBe("UserWarning: lr is high\n");
    expect(cleanStream("epoch 1 loss 0.5\n1875/1875 [====] - 3s\n")).toBe("epoch 1 loss 0.5\n1875/1875 [====] - 3s\n"); // the code's own log stays
    const run = { outcome: "ok" as const, stdout: "", stderr: err, error_line: null, line: null, ms: 611108, where: "server" as const, code_hash: "h", ran_at: "2026-11-18T10:00:00.000Z" };
    expect(runSummary(run)).toBe("Ran on a T4 GPU · 10:11");
    expect(runSummary({ ...run, where: "browser", stderr: "", ms: 1234 })).toBe("Ran in the browser · 1.23 s");
    expect(runSummary({ ...run, stderr: "", ms: 75_000 })).toBe("Ran on the server's CPU · 1:15");
  });

  it("offers three formats, named for where they open", () => {
    expect(EXPORT_FORMATS.map((f) => f.format)).toEqual(["ipynb", "html", "md"]);
    expect(exportBaseName("Do 4 layers beat 2? Balls vs handwritten digits")).toBe("Do-4-layers-beat-2-Balls-vs-handwritten-digits");
    expect(exportBaseName("  ???  ")).toBe("note");
    expect(plainLinks("see [[Baseline|abc]] and [[Other]]")).toBe("see Baseline and Other");
  });

  it("Jupyter: the note's text, each cell's notes before and after, code cells with their saved outputs", () => {
    const nb = JSON.parse(toNotebook(SAMPLE_EXPORT));
    expect(nb).toMatchObject({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: "python3" }, language_info: { name: "python" } } });
    const kinds = nb.cells.map((c: { cell_type: string }) => c.cell_type);
    expect(kinds).toEqual(["markdown", "markdown", "code", "markdown", "markdown", "code", "markdown", "markdown"]);
    expect(nb.cells[0].source.join("")).toContain("# Do 4 layers beat 2?");
    expect(nb.cells[0].source.join("")).toContain("**Outcome:** Successful");
    expect(nb.cells[0].source.join("")).toContain("See Baseline run and"); // note links read as text
    expect(new Set(nb.cells.map((c: { id: string }) => c.id)).size).toBe(nb.cells.length);
    const digits = nb.cells[5];
    expect(digits.source.join("")).toBe(SAMPLE_CELLS[1]!.content);
    const types = digits.outputs.map((o: { output_type: string }) => o.output_type);
    expect(types).toEqual(["stream", "display_data", "display_data", "display_data", "display_data"]); // no stderr: only Benchjot's notes and progress bars were there
    expect(JSON.stringify(digits.outputs)).not.toMatch(/\[Benchjot\]|100%\|/);
    expect(digits.metadata.benchjot).toEqual({ filename: "digits.py", run: "Ran on a T4 GPU · 10:11" });
    expect(nb.cells[2].metadata.benchjot.run).toBe("Ran on the server's CPU · 7:16");
    expect(digits.outputs[1].data["text/html"].join("")).toContain("<td>4-layer convolutional</td>");
    expect(digits.outputs[3].data["image/png"]).toMatch(/^iVBORw0KGgo/); // the real figure, embedded
    expect(nb.cells[4].source.join("")).toContain("**Before run**");
  });

  it("Jupyter: a failed run becomes an error output; a cell in another language a Markdown block", () => {
    const cell = (over: Partial<ExportNote["cells"][number]>) => ({ filename: "", language: "python", code: "1/0", noteBefore: "", noteAfter: "", run: null, files: {}, ...over });
    const run = { outcome: "error" as const, stdout: "hi\n", stderr: "Traceback (most recent call last):\nZeroDivisionError: division by zero\n", error_line: "ZeroDivisionError: division by zero", line: 1, ms: 1, where: "browser" as const, code_hash: "h", ran_at: "2026-11-18T10:00:00.000Z" };
    const nb = JSON.parse(toNotebook({ ...SAMPLE_EXPORT, cells: [cell({ run }), cell({ language: "sql", code: "select 1", filename: "q.sql" })] }));
    expect(nb.cells[1].outputs.at(-1)).toEqual({ output_type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["Traceback (most recent call last):", "ZeroDivisionError: division by zero"] });
    expect(nb.cells[2]).toMatchObject({ cell_type: "markdown" });
    expect(nb.cells[2].source.join("")).toContain("```sql\nselect 1\n```");
    expect(notebookLanguage([cell({ language: "r", code: "x" }), cell({ language: "r", code: "y" }), cell({ code: "z" })])).toBe("r");
  });

  it("web page: one file with everything in it (figures embedded), escaped, printable", () => {
    const html = toWebPage(SAMPLE_EXPORT, md);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Do 4 layers beat 2? Balls vs handwritten digits</title>");
    expect(html).toContain("Outcome: Successful");
    expect(html.match(/<img src="data:image\/png;base64,/g)).toHaveLength(3);
    expect(html).toContain("<td>4-layer convolutional</td>");
    expect(html).toContain("Before run");
    expect(html).toContain("@media print");
    expect(html).not.toMatch(/\[Benchjot\]|100%\|/);
    expect(html).toContain("Ran on a T4 GPU · 10:11");
    expect(html).not.toMatch(/src="\/|href="\/(?!\/)/); // nothing points back into the app
    expect(toWebPage({ ...SAMPLE_EXPORT, title: "<script>x</script>", body: "", cells: [] }, md)).not.toContain("<script>x");
  });

  it("Markdown: note.md and its files, every link pointing inside the zip", () => {
    const z = toMarkdownZip(SAMPLE_EXPORT);
    const text = new TextDecoder("latin1").decode(z);
    const names = [...text.matchAll(/(note\.md|files\/cell\d+-\d+\.\w+)/g)].map((m) => m[1]);
    expect(names).toContain("note.md");
    for (const f of ["files/cell1-1.csv", "files/cell1-3.png", "files/cell2-3.png", "files/cell2-3.svg", "files/cell2-4.png"]) expect(names).toContain(f);
    const note = text.slice(text.indexOf("# Do 4 layers"), text.indexOf("_Exported from Benchjot"));
    expect(note).toContain("```python\n");
    expect(note).toContain("![Figure: What the networks were tested on](files/cell2-4.png)");
    expect(note).toContain("| network | weights | lr |");
    expect(note).toMatch(/_Ran on a T4 GPU \S+ 10:11_/); // "·" read byte by byte here
    expect(note).not.toMatch(/\[Benchjot\]|100%\|/);
    expect(SAMPLE_CELL_IDS).toHaveLength(2);
  });
});

describe("Export note in the app", () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  it("the note's More menu opens the export dialog, which offers all three formats and downloads the file", () => {
    const view = src("components/notes/note-view.tsx");
    expect(view).toContain('{ label: "Export note", onSelect: () => exportDialog.current?.open() }');
    expect(view).toContain("<ExportNoteDialog ref={exportDialog} read={readForExport} />");
    expect(view).toMatch(/async function readForExport[\s\S]*await flushAll\(\);[\s\S]*fetchCells\(note\.id\)/); // pending edits saved first
    const dialog = src("components/notes/export-note.tsx");
    expect(dialog).toContain("EXPORT_FORMATS.map((f) =>");
    expect(dialog).toContain("saveBlob(name, blob)");
  });
  it("the landing tells visitors a note can leave in standard formats", () => {
    const page = src("app/page.tsx");
    expect(src("components/app/product-film.tsx")).toContain("Export the whole note to Jupyter, a web page or Markdown");
    expect(page).toContain('label: "Web and Android"');
    expect(page).toContain("Export to Jupyter or Markdown");
  });
});

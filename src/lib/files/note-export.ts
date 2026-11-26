// A whole note out of Benchjot, for use anywhere: a Jupyter notebook (.ipynb: Jupyter, Colab,
// VS Code, GitHub), one self-contained web page (.html: any browser, offline, prints to
// PDF), or Markdown with its files (.zip: Obsidian, GitHub, Notion, a thesis draft). Each holds
// the note's text, its outcome, every code cell with its notes before and after the run, and the
// cell's saved run: printed output, the error, figures, tables and charts. Pure: the caller passes
// the note, each run's files (already downloaded) and, for the web page, a Markdown renderer.
import { LANGUAGES, languageConfig } from "../code/languages";
import { OUTCOME_LABEL } from "../notes/outcome";
import type { Note, LastRun } from "../notes/schemas";
import { displayFile, MIME, outputLabel, type OutputItem, type TableOutput } from "../run/outputs";
import { zip } from "./zip";

export interface ExportCell {
  filename: string;
  language: string;
  code: string;
  noteBefore: string;
  noteAfter: string;
  run: LastRun | null;
  /** The run's output files by name (from Storage); missing ones are left out. */
  files: Readonly<Record<string, Uint8Array>>;
}

export interface ExportNote {
  title: string;
  body: string;
  outcome: Note["outcome"];
  cells: readonly ExportCell[];
  /** When it was exported (ISO), said at the end. */
  exportedAt: string;
}

export type ExportFormat = "ipynb" | "html" | "md";

/** The three formats, as the export menu lists them. */
export const EXPORT_FORMATS: readonly { format: ExportFormat; label: string; detail: string }[] = [
  { format: "ipynb", label: "Jupyter notebook (.ipynb)", detail: "Opens in Jupyter, Google Colab and VS Code, with your outputs." },
  { format: "html", label: "Web page (.html)", detail: "One file that opens in any browser, offline. Print it to save a PDF." },
  { format: "md", label: "Markdown and files (.zip)", detail: "note.md with its figures and tables, for Obsidian, GitHub or Notion." },
];

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A file name from the note's title. */
export function exportBaseName(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "note"
  );
}

/** Note links ([[Title|id]], [[Title]]) read as their title outside the app. */
export function plainLinks(md: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1");
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Benchjot's own notes on a run ("[Benchjot] Ran on a T4 GPU …"): about the run, not its output. */
const BENCHJOT_NOTE = /^\[Benchjot\] /;
/** A download or loop progress bar (tqdm: "100%|██████████| 9.91M/9.91M [00:00<00:00, 12.5MB/s]"). */
const PROGRESS_BAR = /^\s*(?:[^|\n]*:\s*)?\d{1,3}%\|.*\|/;

/** What the code printed, for use outside the app: Benchjot's notes and progress bars left out. */
export function cleanStream(text: string): string {
  const kept = text.split("\n").filter((l) => !BENCHJOT_NOTE.test(l) && !PROGRESS_BAR.test(l));
  return kept.join("\n").replace(/^\n+/, "");
}

/** Where and how long a run ran, in one line ("Ran on a T4 GPU · 10:11"), from its record. */
export function runSummary(r: LastRun): string {
  const gpu = r.stderr.match(/\[Benchjot\] Ran on an? (\S+) GPU/)?.[1];
  const where = r.where === "browser" ? "in the browser" : gpu ? `on a ${gpu} GPU` : "on the server's CPU";
  const said = r.stderr.match(/your code ran for (\d+:\d+|[\d.]+ s)/)?.[1];
  const secs = r.ms / 1000;
  const took = said ?? (secs >= 60 ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}` : `${secs.toFixed(secs < 10 ? 2 : 1)} s`);
  return `Ran ${where} · ${took}`;
}

const stdoutOf = (r: LastRun) => cleanStream(r.stdout);
const stderrOf = (r: LastRun) => cleanStream(r.stderr);
const isFailed = (r: LastRun) => r.outcome === "error";

/** A figure's best still: PNG, then the other raster formats, then SVG. */
function stillFile(item: OutputItem): { name: string; mime: string } | null {
  if (item.kind === "table") return null;
  const name = item.kind === "chart" ? (item.files.png ?? item.files.svg ?? null) : displayFile(item);
  if (!name) return null;
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return { name, mime: MIME[ext] ?? "application/octet-stream" };
}

const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A table's saved rows as HTML (the first rows the run kept, said when there are more). */
function tableHtml(t: TableOutput): string {
  const head = `<tr>${t.columns.map((c) => `<th>${htmlEsc(c)}</th>`).join("")}</tr>`;
  const rows = t.rows.map((r) => `<tr>${r.map((v) => `<td>${htmlEsc(v === null ? "" : String(v))}</td>`).join("")}</tr>`).join("");
  const more = t.total_rows > t.rows.length ? `<p class="more">First ${t.rows.length} of ${t.total_rows} rows.</p>` : "";
  return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>${more}`;
}

/** A table's saved rows as a Markdown table. */
function tableMarkdown(t: TableOutput): string {
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [`| ${t.columns.map(cell).join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${r.map(cell).join(" | ")} |`)];
  if (t.total_rows > t.rows.length) lines.push("", `_First ${t.rows.length} of ${t.total_rows} rows._`);
  return lines.join("\n");
}

const tableCsv = (t: TableOutput) =>
  [t.columns, ...t.rows].map((r) => r.map((v) => { const s = v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";

// ------------------------------------------------------------------ Jupyter

/** Kernels the notebook can name; other languages' cells go in as Markdown code blocks with their output. */
const KERNELS: Record<string, { name: string; display_name: string; language: string }> = {
  python: { name: "python3", display_name: "Python 3", language: "python" },
  r: { name: "ir", display_name: "R", language: "R" },
  julia: { name: "julia", display_name: "Julia", language: "julia" },
  matlab: { name: "octave", display_name: "Octave", language: "octave" },
};

/** The notebook's language: the one most of its code cells are in among those with a kernel, else Python. */
export function notebookLanguage(cells: readonly ExportCell[]): string {
  const counts = new Map<string, number>();
  for (const c of cells) if (KERNELS[c.language] && c.code.trim()) counts.set(c.language, (counts.get(c.language) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "python";
}

/** nbformat's multi-line strings: a list of lines, each but the last ending in \n. */
const lines = (s: string) => (s ? s.split(/(?<=\n)/) : []);

type NbOutput = Record<string, unknown>;

function jupyterOutputs(c: ExportCell): NbOutput[] {
  const r = c.run;
  if (!r) return [];
  const out: NbOutput[] = [];
  const stdout = stdoutOf(r);
  if (stdout) out.push({ output_type: "stream", name: "stdout", text: lines(stdout) });
  const stderr = stderrOf(r);
  if (stderr.trim() && !isFailed(r)) out.push({ output_type: "stream", name: "stderr", text: lines(stderr) });
  for (const item of r.outputs?.items ?? []) {
    const data: Record<string, unknown> = {};
    if (item.kind === "table") {
      data["text/html"] = lines(tableHtml(item));
      data["text/plain"] = lines(tableCsv(item));
    } else {
      if (item.kind === "chart" && item.files.json && c.files[item.files.json]) {
        const spec = JSON.parse(dec.decode(c.files[item.files.json]));
        if (item.lib === "plotly") data["application/vnd.plotly.v1+json"] = spec;
        if (item.lib === "vega-lite") data[`application/vnd.vegalite.v${item.version.split(".")[0] || "5"}+json`] = spec;
      }
      const still = stillFile(item);
      const bytes = still && c.files[still.name];
      if (still && bytes) data[still.mime] = still.mime === "image/svg+xml" ? lines(dec.decode(bytes)) : base64(bytes);
      data["text/plain"] = [item.title ? `${outputLabel(item)}: ${item.title}` : outputLabel(item)];
    }
    out.push({ output_type: "display_data", data, metadata: {} });
  }
  if (isFailed(r)) {
    const last = (r.error_line ?? stderr.trim().split("\n").at(-1) ?? "Error").trim();
    const m = last.match(/^([\w.]+):\s*(.*)$/);
    out.push({ output_type: "error", ename: m?.[1] ?? "Error", evalue: m?.[2] ?? last, traceback: stderr.trim() ? stderr.trimEnd().split("\n") : [last] });
  }
  return out;
}

/** The note as a Jupyter notebook (nbformat 4.5). */
export function toNotebook(note: ExportNote): string {
  const language = notebookLanguage(note.cells);
  let n = 0;
  const id = () => `bj-${(++n).toString().padStart(3, "0")}`;
  const md = (text: string) => ({ cell_type: "markdown", id: id(), metadata: {}, source: lines(text) });
  const head = [`# ${note.title || "Untitled"}`, note.outcome ? `**Outcome:** ${OUTCOME_LABEL[note.outcome]}` : "", plainLinks(note.body).trim()].filter(Boolean).join("\n\n");
  const cells: Record<string, unknown>[] = [md(head)];
  for (const c of note.cells) {
    if (c.noteBefore.trim()) cells.push(md(`**Before run**\n\n${plainLinks(c.noteBefore).trim()}`));
    if (c.language === language) {
      cells.push({ cell_type: "code", id: id(), metadata: { benchjot: { filename: c.filename, ...(c.run ? { run: runSummary(c.run) } : {}) } }, execution_count: null, source: lines(c.code), outputs: jupyterOutputs(c) });
    } else {
      const label = languageConfig(c.language).label;
      const output = c.run ? (isFailed(c.run) ? c.run.error_line ?? stderrOf(c.run) : stdoutOf(c.run)).trim() : "";
      cells.push(md([`**${c.filename || label}** (${label})`, "```" + c.language + "\n" + c.code.replace(/\n$/, "") + "\n```", output ? "Output:\n\n```text\n" + output + "\n```" : ""].filter(Boolean).join("\n\n")));
    }
    if (c.noteAfter.trim()) cells.push(md(`**After run**\n\n${plainLinks(c.noteAfter).trim()}`));
  }
  cells.push(md(`_Exported from Benchjot on ${note.exportedAt.slice(0, 10)}._`));
  const kernel = KERNELS[language]!;
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: kernel, language_info: { name: kernel.language.toLowerCase() }, benchjot: { title: note.title, outcome: note.outcome || null, exported_at: note.exportedAt } },
    cells,
  };
  return JSON.stringify(notebook, null, 1) + "\n";
}

// ------------------------------------------------------------------ web page

const PAGE_CSS = `
:root { color-scheme: light; --fg: #1a1a19; --muted: #5f5e5a; --line: #e2e1dc; --tint: #f4f3ef; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 40px 20px 64px; }
h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; }
.meta { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
.cell { border-top: 1px solid var(--line); padding: 20px 0; }
.label { font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
.file { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); margin: 14px 0 6px; }
pre { background: var(--tint); border-radius: 8px; padding: 12px 14px; overflow-x: auto; font: 13.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
pre.out { background: #fff; border: 1px solid var(--line); }
pre.err { border-color: #e3b7b3; }
figure { margin: 14px 0; }
figure img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; }
figcaption, .more { color: var(--muted); font-size: 13px; margin-top: 6px; }
table { border-collapse: collapse; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 10px; text-align: left; white-space: nowrap; }
th { color: var(--muted); font-weight: 500; }
.body p:first-child { margin-top: 0; }
footer { color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); padding-top: 16px; margin-top: 24px; }
@media print { main { padding: 0; } pre { white-space: pre-wrap; } .cell { break-inside: avoid-page; } }
`;

/** The note as one self-contained web page: figures inside it, math via KaTeX's stylesheet when online. */
export function toWebPage(note: ExportNote, renderMarkdown: (md: string) => string): string {
  const block = (md: string) => `<div class="body">${renderMarkdown(plainLinks(md))}</div>`;
  const parts: string[] = [];
  for (const c of note.cells) {
    const cell: string[] = [];
    if (c.noteBefore.trim()) cell.push(`<p class="label">Before run</p>${block(c.noteBefore)}`);
    cell.push(`<p class="file">${htmlEsc(c.filename || "code")} · ${htmlEsc(languageConfig(c.language).label)}</p><pre><code>${htmlEsc(c.code)}</code></pre>`);
    const r = c.run;
    if (r) {
      const text = [stdoutOf(r), isFailed(r) ? stderrOf(r) || r.error_line || "" : stderrOf(r)].filter(Boolean).join("");
      if (text.trim()) cell.push(`<pre class="out${isFailed(r) ? " err" : ""}">${htmlEsc(text.trimEnd())}</pre>`);
      cell.push(`<p class="more">${htmlEsc(runSummary(r))}</p>`);
      for (const item of r.outputs?.items ?? []) {
        if (item.kind === "table") {
          cell.push(`<figure>${tableHtml(item)}</figure>`);
          continue;
        }
        const still = stillFile(item);
        const bytes = still && c.files[still.name];
        const caption = htmlEsc(item.title ? `${outputLabel(item)} · ${item.title}` : outputLabel(item));
        if (still && bytes) cell.push(`<figure><img src="data:${still.mime};base64,${base64(bytes)}" alt="${caption}"><figcaption>${caption}</figcaption></figure>`);
        else cell.push(`<p class="more">${caption} (open the note in Benchjot to see it)</p>`);
      }
    }
    if (c.noteAfter.trim()) cell.push(`<p class="label">After run</p>${block(c.noteAfter)}`);
    parts.push(`<section class="cell">${cell.join("\n")}</section>`);
  }
  const title = htmlEsc(note.title || "Untitled");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<h1>${title}</h1>
${note.outcome ? `<p class="meta">Outcome: ${OUTCOME_LABEL[note.outcome]}</p>` : ""}
${note.body.trim() ? block(note.body) : ""}
${parts.join("\n")}
<footer>Exported from Benchjot on ${note.exportedAt.slice(0, 10)}.</footer>
</main>
</body>
</html>
`;
}

// ------------------------------------------------------------------ Markdown

/** The note as note.md plus a files/ folder (each cell's figures and tables), zipped. */
export function toMarkdownZip(note: ExportNote): Uint8Array {
  return zip(markdownFiles(note));
}

/** The Markdown export's files, in order: note.md, then each cell's figures and tables (the zip's files). */
export function markdownFiles(note: ExportNote): { name: string; data: Uint8Array }[] {
  const files: { name: string; data: Uint8Array }[] = [];
  const md: string[] = [`# ${note.title || "Untitled"}`];
  if (note.outcome) md.push(`**Outcome:** ${OUTCOME_LABEL[note.outcome]}`);
  if (note.body.trim()) md.push(plainLinks(note.body).trim());
  note.cells.forEach((c, i) => {
    const n = i + 1;
    md.push(`## ${c.filename || `Cell ${n}`}`);
    if (c.noteBefore.trim()) md.push(`**Before run**\n\n${plainLinks(c.noteBefore).trim()}`);
    const fence = LANGUAGES.some((l) => l.id === c.language) ? c.language : "";
    md.push("```" + fence + "\n" + c.code.replace(/\n$/, "") + "\n```");
    const r = c.run;
    if (r) {
      const text = (isFailed(r) ? [stdoutOf(r), stderrOf(r) || r.error_line || ""] : [stdoutOf(r)]).join("").trimEnd();
      if (text) md.push("Output:\n\n```text\n" + text + "\n```");
      md.push(`_${runSummary(r)}_`);
      (r.outputs?.items ?? []).forEach((item, k) => {
        const stem = `files/cell${n}-${k + 1}`;
        if (item.kind === "table") {
          const csv = item.files.csv && c.files[item.files.csv];
          files.push({ name: `${stem}.csv`, data: csv || enc.encode(tableCsv(item)) });
          md.push(`${tableMarkdown(item)}\n\n[${outputLabel(item)} as CSV](${stem}.csv)`);
          return;
        }
        const still = stillFile(item);
        const bytes = still && c.files[still.name];
        const caption = item.title ? `${outputLabel(item)}: ${item.title}` : outputLabel(item);
        if (still && bytes) {
          const ext = still.name.slice(still.name.lastIndexOf("."));
          files.push({ name: `${stem}${ext}`, data: bytes });
          md.push(`![${caption}](${stem}${ext})`);
        }
        for (const [kind, name] of Object.entries(item.files)) {
          if (!name || name === still?.name || kind === "mpl" || kind === "strip" || !c.files[name]) continue;
          files.push({ name: `${stem}.${kind}`, data: c.files[name]! });
        }
      });
    }
    if (c.noteAfter.trim()) md.push(`**After run**\n\n${plainLinks(c.noteAfter).trim()}`);
  });
  md.push(`---\n\n_Exported from Benchjot on ${note.exportedAt.slice(0, 10)}._`);
  return [{ name: "note.md", data: enc.encode(md.join("\n\n") + "\n") }, ...files];
}

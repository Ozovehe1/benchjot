// Rich run outputs (figures, tables, interactive charts): the contract between
// public/workers/bj_capture.py (which writes them), the stored run record
// (snippets.last_run.outputs) and the Android app. Pure: no browser or DB imports.
//
// Files live in the private `run-outputs` Storage bucket under
// `{user id}/{snippet id}/{run id}/`; the record keeps that folder once and each
// item's file names, so the 600 KB row limit only ever holds table previews.
import { z } from "zod";

export const OUTPUTS_BUCKET = "run-outputs";

const fileName = z.string().regex(/^\d{1,3}\.[a-z0-9]{2,5}$/, "Bad output file name");
const cell = z.union([z.string().max(400), z.number(), z.boolean(), z.null()]);

export const IMAGE_FORMATS = ["png", "svg", "pdf", "jpg", "gif", "webp", "bmp"] as const;
export const CHART_LIBS = ["plotly", "vega-lite", "bokeh"] as const;
export type ChartLib = (typeof CHART_LIBS)[number];

const files = <K extends string>(keys: readonly K[]) => z.partialRecord(z.enum(keys), fileName);

export const imageOutput = z.object({
  kind: z.literal("image"),
  source: z.enum(["matplotlib", "pil", "file"]),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  title: z.string().max(500).default(""),
  name: z.string().max(500).optional(),
  files: files(IMAGE_FORMATS),
});

export const tableOutput = z.object({
  kind: z.literal("table"),
  index_columns: z.number().int().nonnegative(),
  columns: z.array(z.string().max(400)).max(64),
  rows: z.array(z.array(cell).max(64)).max(1000),
  total_rows: z.number().int().nonnegative(),
  total_columns: z.number().int().nonnegative(),
  files: files(["csv"] as const),
});

export const chartOutput = z.object({
  kind: z.literal("chart"),
  lib: z.enum(CHART_LIBS),
  version: z.string().max(40),
  title: z.string().max(500).default(""),
  /** json: the library's own spec. png / svg: a static render made by the web at run time (fallback). */
  files: files(["json", "png", "svg"] as const),
});

export const outputItem = z.discriminatedUnion("kind", [imageOutput, tableOutput, chartOutput]);
export type OutputItem = z.output<typeof outputItem>;
export type ImageOutput = z.output<typeof imageOutput>;
export type TableOutput = z.output<typeof tableOutput>;
export type ChartOutput = z.output<typeof chartOutput>;

export const MAX_OUTPUTS = 30;

/** What bj_capture.py writes as manifest.json. */
export const manifest = z.object({
  version: z.literal(1),
  items: z.array(outputItem).max(MAX_OUTPUTS),
  notes: z.array(z.string().max(500)).max(20),
});
export type Manifest = z.output<typeof manifest>;

/** The outputs part of a stored run: the folder they were uploaded to, plus the manifest. */
export const savedOutputs = manifest.extend({
  dir: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/, "Bad output folder"),
});
export type SavedOutputs = z.output<typeof savedOutputs>;

/** A finished run's outputs before upload: the manifest and each file's bytes, by name. */
export interface CapturedOutputs {
  manifest: Manifest;
  files: Record<string, Uint8Array>;
}

export const outputDir = (userId: string, snippetId: string, runId: string) => `${userId}/${snippetId}/${runId}`;
export const outputPath = (dir: string, name: string) => `${dir}/${name}`;

/** Every file a set of outputs points at, as Storage paths. */
export function outputPaths(o: SavedOutputs): string[] {
  return o.items.flatMap((item) => Object.values(item.files).map((n) => outputPath(o.dir, n as string)));
}

/** The file to show inline / in the viewer: a raster first (smallest to decode on phones), else SVG. */
export function displayFile(item: ImageOutput | ChartOutput): string | null {
  const f = item.files as Partial<Record<string, string>>;
  return f.png ?? f.jpg ?? f.webp ?? f.gif ?? f.bmp ?? f.svg ?? null;
}

export const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

/**
 * One way to download an output. `file`: a stored file as is. `convert`: re-encoded on
 * the device from `from` (lossless source -> JPG/WebP over a solid background).
 * `render`: drawn by the chart library at download time (web).
 */
export type DownloadFormat =
  | { format: string; label: string; how: "file"; file: string }
  | { format: "jpg" | "webp"; label: string; how: "convert"; from: string }
  | { format: string; label: string; how: "render" };

const LABEL: Record<string, string> = { png: "PNG", jpg: "JPG", webp: "WebP", svg: "SVG", pdf: "PDF", gif: "GIF", bmp: "BMP", csv: "CSV", json: "JSON" };

/** The formats a viewer offers for an output, best first. Same list on web and Android. */
export function downloadFormats(item: OutputItem): DownloadFormat[] {
  const f = item.files as Partial<Record<string, string>>;
  const out: DownloadFormat[] = [];
  const file = (format: string) => Boolean(f[format] && out.push({ format, label: LABEL[format] ?? format.toUpperCase(), how: "file", file: f[format]! }));
  if (item.kind === "table") {
    // Without the full CSV (too large to keep) the preview rows are written as CSV.
    if (!file("csv")) out.push({ format: "csv", label: "CSV (preview)", how: "render" });
    return out;
  }
  if (item.kind === "chart") {
    // Drawn again from the spec at download time. Bokeh draws to a canvas, so no SVG.
    // PDF is the drawn chart on one page (lossless pixels on web, vector on Android).
    const formats = item.lib === "bokeh" ? ["png", "jpg", "webp", "pdf"] : ["png", "jpg", "webp", "svg", "pdf"];
    for (const format of formats) out.push({ format, label: LABEL[format]!, how: "render" });
    file("json");
    return out;
  }
  file("png");
  const raster = f.png ?? f.webp ?? f.bmp ?? f.gif;
  if (raster) {
    for (const format of ["jpg", "webp"] as const) {
      if (f[format]) file(format);
      else out.push({ format, label: LABEL[format]!, how: "convert", from: raster });
    }
  } else {
    file("jpg");
    file("webp");
  }
  for (const format of ["svg", "pdf", "gif", "bmp"]) file(format);
  return out;
}

/** File name for a download: "<block name>-<n>.<ext>" (n is 1-based). */
export function downloadName(base: string, index: number, format: string): string {
  const clean = base.replace(/\.[^.]*$/, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "output";
  return `${clean}-${index + 1}.${format}`;
}

/** CSV of a table preview (used only when the full CSV was too large to keep). */
export function previewCsv(t: TableOutput): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

/** A short line for the output list: "Figure", "Table · 150 × 3", "Plotly chart". */
export function outputLabel(item: OutputItem): string {
  if (item.kind === "table") return `Table · ${item.total_rows} × ${item.total_columns}`;
  if (item.kind === "chart") return `${{ plotly: "Plotly", "vega-lite": "Vega-Lite", bokeh: "Bokeh" }[item.lib]} chart`;
  return item.source === "file" ? (item.name ?? "Image") : item.source === "pil" ? "Image" : "Figure";
}

/** The run's whole result as zip entries: output text, the error, each output's files, and the manifest. */
export function runArchiveEntries(
  text: { stdout: string; stderr: string; error: string | null },
  outputs: { manifest: Manifest; files: Record<string, Uint8Array> } | null,
): { name: string; data: Uint8Array }[] {
  const enc = new TextEncoder();
  const entries: { name: string; data: Uint8Array }[] = [];
  if (text.stdout) entries.push({ name: "stdout.txt", data: enc.encode(text.stdout) });
  if (text.stderr) entries.push({ name: "stderr.txt", data: enc.encode(text.stderr) });
  if (text.error) entries.push({ name: "error.txt", data: enc.encode(text.error) });
  if (outputs) {
    for (const [name, data] of Object.entries(outputs.files)) entries.push({ name: `outputs/${name}`, data });
    entries.push({ name: "outputs/manifest.json", data: enc.encode(JSON.stringify(outputs.manifest, null, 2)) });
  }
  return entries;
}

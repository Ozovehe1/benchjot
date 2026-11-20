// Rich run outputs (figures, tables, interactive charts): the contract between
// public/workers/bj_capture.py (which writes them), the stored run record
// (cells.last_run.outputs) and the Android app. Pure: no browser or DB imports.
//
// Files live in the private `run-outputs` Storage bucket under
// `{user id}/{cell id}/{run id}/`; the record keeps that folder once and each
// item's file names, so the 600 KB row limit only ever holds table previews.
import { z } from "zod";

export const OUTPUTS_BUCKET = "run-outputs";
/** The longest description the seer keeps for one output. */
export const SEEN_MAX = 600;

const fileName = z.string().regex(/^\d{1,3}\.[a-z0-9]{2,5}$/, "Bad output file name");
const cell = z.union([z.string().max(400), z.number(), z.boolean(), z.null()]);

const IMAGE_FORMATS = ["png", "svg", "pdf", "jpg", "gif", "webp", "bmp", "mp4", "webm"] as const;
/** Moving outputs: an animation's GIF and video (bj_capture saves both where ffmpeg is), or a video file the code wrote. */

/** An image output's video file, if it has one. */
export function videoFile(item: ImageOutput): string | null {
  const f = item.files as Partial<Record<string, string>>;
  return f.mp4 ?? f.webm ?? null;
}

/** Whether an image output moves (a simulation's animation): downloads offer it as it is, not a still. */
function isAnimation(item: ImageOutput): boolean {
  const f = item.files as Partial<Record<string, string>>;
  return !f.png && Boolean(f.gif ?? f.mp4 ?? f.webm);
}
/** A matplotlib figure kept at run time (bj_capture.FIG_FILE): its SVG and PDF are made from it on Download. */
const FIGURE_FILE = "mpl";
/** The formats made from a kept figure (bj_capture.VECTOR_FORMATS). */
export const FIGURE_FORMATS = ["svg", "pdf"] as const;
export type FigureFormat = (typeof FIGURE_FORMATS)[number];
export const CHART_LIBS = ["plotly", "vega-lite", "bokeh"] as const;
export type ChartLib = (typeof CHART_LIBS)[number];

const files = <K extends string>(keys: readonly K[]) => z.partialRecord(z.enum(keys), fileName);

const imageOutput = z.object({
  kind: z.literal("image"),
  source: z.enum(["matplotlib", "pil", "file"]),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  title: z.string().max(500).default(""),
  name: z.string().max(500).optional(),
  /** With a kept figure: the matplotlib version that kept it (it loads only in the same one). */
  matplotlib: z.string().max(40).optional(),
  /** strip: an animation's frames in time order on one PNG (bj_capture STRIP_FRAMES), for the seer; never shown. */
  files: files([...IMAGE_FORMATS, FIGURE_FILE, "strip"] as const),
  /** What it shows, in a few sentences: written once by the vision model (the seer, /api/see) and kept with this run. */
  seen: z.string().max(SEEN_MAX).optional().catch(undefined),
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
  seen: z.string().max(SEEN_MAX).optional().catch(undefined),
});

export const outputItem = z.discriminatedUnion("kind", [imageOutput, tableOutput, chartOutput]);
export type OutputItem = z.output<typeof outputItem>;
type ImageOutput = z.output<typeof imageOutput>;
export type TableOutput = z.output<typeof tableOutput>;
export type ChartOutput = z.output<typeof chartOutput>;

/**
 * Which columns read as numbers (right-aligned): those whose every filled cell is a number. A column
 * mixing numbers and text (31, "never") stays left-aligned, so its cells line up.
 */
export function numericColumns(table: Pick<TableOutput, "columns" | "rows" | "index_columns">): boolean[] {
  return table.columns.map((_, j) => {
    if (j < table.index_columns) return false;
    const filled = table.rows.map((r) => r[j]).filter((v) => v !== null && v !== undefined && v !== "");
    return filled.length > 0 && filled.every((v) => typeof v === "number");
  });
}

const MAX_OUTPUTS = 30;

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

export const outputDir = (userId: string, cellId: string, runId: string) => `${userId}/${cellId}/${runId}`;
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
  mp4: "video/mp4",
  webm: "video/webm",
  html: "text/html",
  pdf: "application/pdf",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

/**
 * One way to download an output. `file`: a stored file as is. `convert`: re-encoded on
 * the device from `from` (lossless source -> JPG/WebP over a solid background).
 * `render`: drawn by the chart library at download time (web). `figure`: made by matplotlib
 * from the figure kept at run time (`file`), in the device's own Python.
 */
export type DownloadFormat =
  | { format: string; label: string; how: "file"; file: string }
  | { format: FigureFormat; label: string; how: "figure"; file: string }
  | { format: "jpg" | "webp"; label: string; how: "convert"; from: string }
  | { format: string; label: string; how: "render" };

const LABEL: Record<string, string> = { png: "PNG", jpg: "JPG", webp: "WebP", svg: "SVG", pdf: "PDF", gif: "GIF", bmp: "BMP", csv: "CSV", json: "JSON" };
/** A chart as one self-contained page that still moves and responds (Plotly animations and 3D, Vega-Lite, Bokeh). */
const HTML_FORMAT = { format: "html", label: "HTML (interactive)", how: "render" } as const;

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
    for (const format of formats) {
      out.push({ format, label: LABEL[format]!, how: "render" });
      // Right after PNG: the chart as it is (interactive, animated), when its spec was kept.
      if (format === "png" && f.json) out.push(HTML_FORMAT);
    }
    file("json");
    return out;
  }
  if (isAnimation(item)) {
    // A simulation's animation: as it is first (video, GIF); stills say they are one frame.
    if (f.mp4) out.push({ format: "mp4", label: "MP4 (video)", how: "file", file: f.mp4 });
    if (f.webm) out.push({ format: "webm", label: "WebM (video)", how: "file", file: f.webm });
    if (f.gif) {
      out.push({ format: "gif", label: "GIF (animation)", how: "file", file: f.gif });
      for (const format of ["jpg", "webp"] as const) out.push({ format, label: `${LABEL[format]} (first frame)`, how: "convert", from: f.gif });
    }
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
  const kept = f[FIGURE_FILE];
  for (const format of FIGURE_FORMATS) if (!file(format) && kept) out.push({ format, label: LABEL[format]!, how: "figure", file: kept });
  for (const format of ["gif", "bmp"]) file(format);
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
  // An animation bj_capture made (animation-N.gif): said for what is shown, the video when there is one,
  // not the GIF's file name (a server run plays its MP4).
  if (CAPTURED_ANIMATION.test(item.name ?? "")) return videoFile(item) ? "Animation · video" : "Animation";
  return item.source === "file" ? (item.name ?? "Image") : item.source === "pil" ? "Image" : "Figure";
}
/** The name bj_capture gives the animations it captures. */
const CAPTURED_ANIMATION = /^animation-\d+\.gif$/i;

/** The run's whole result as zip files: output text, the error, each output's files, and the manifest. */
export function runArchiveFiles(
  text: { stdout: string; stderr: string; error: string | null },
  outputs: { manifest: Manifest; files: Record<string, Uint8Array> } | null,
): { name: string; data: Uint8Array }[] {
  const enc = new TextEncoder();
  const out: { name: string; data: Uint8Array }[] = [];
  if (text.stdout) out.push({ name: "stdout.txt", data: enc.encode(text.stdout) });
  if (text.stderr) out.push({ name: "stderr.txt", data: enc.encode(text.stderr) });
  if (text.error) out.push({ name: "error.txt", data: enc.encode(text.error) });
  if (outputs) {
    for (const [name, data] of Object.entries(outputs.files)) out.push({ name: `outputs/${name}`, data });
    out.push({ name: "outputs/manifest.json", data: enc.encode(JSON.stringify(outputs.manifest, null, 2)) });
  }
  return out;
}

// ------------------------------------------------------------------ the seer

/** What the seer is shown of an output: its file, and what kind of thing it is. */
export type SeeItem = { index: number; file: string; kind: "figure" | "image" | "animation" | "chart"; title: string };

/** The most outputs the seer looks at in one request. */
export const SEE_MAX_ITEMS = 3;

/**
 * The outputs of a run the seer hasn't described yet, as files a vision model reads: a figure or
 * image as its PNG (else JPEG or WebP), an animation as its GIF, a chart as its static PNG. SVG,
 * PDF and video only are skipped (models don't read them). At most SEE_MAX_ITEMS.
 */
export function toSee(o: Pick<SavedOutputs, "items"> | null | undefined): SeeItem[] {
  const out: SeeItem[] = [];
  (o?.items ?? []).forEach((item, index) => {
    if (out.length >= SEE_MAX_ITEMS || item.kind === "table" || item.seen) return;
    const f = item.files as Partial<Record<string, string>>;
    if (item.kind === "chart") {
      if (f.png) out.push({ index, file: f.png, kind: "chart", title: item.title });
      return;
    }
    const still = f.png ?? f.jpg ?? f.webp;
    if (still) out.push({ index, file: still, kind: item.source === "matplotlib" ? "figure" : "image", title: item.title });
    else if (f.strip ?? f.gif) out.push({ index, file: (f.strip ?? f.gif)!, kind: "animation", title: item.title });
  });
  return out;
}

/** The run's outputs with the seer's descriptions written into the items they are about. */
export function withSeen<T extends Pick<SavedOutputs, "items">>(o: T, seen: readonly { index: number; text: string }[]): T {
  const items = o.items.map((item, i) => {
    const s = seen.find((x) => x.index === i)?.text.trim();
    return s && item.kind !== "table" ? { ...item, seen: s.slice(0, SEEN_MAX) } : item;
  });
  return { ...o, items };
}

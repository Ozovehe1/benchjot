import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadFormats, downloadName, manifest, outputLabel, outputPaths, previewCsv, runArchiveEntries, savedOutputs, type OutputItem } from "@/lib/run/outputs";
import { lastRun } from "@/lib/schemas";
import { BUNDLE_MARK, splitBundle } from "@/lib/run/server-languages";
import { toLastRun } from "@/lib/run/last-run";

const FIXTURES = join(__dirname, "fixtures/outputs");
const cases = readdirSync(FIXTURES);
const read = (c: string) => JSON.parse(readFileSync(join(FIXTURES, c, "manifest.json"), "utf8"));
const item = (c: string) => manifest.parse(read(c)).items[0]!;
const formats = (i: OutputItem) => downloadFormats(i).map((f) => `${f.format}:${f.how}`);
const DIR = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333";

describe("bj_capture manifests (tests/fixtures/outputs, made by scripts/output-fixtures.py)", () => {
  it("covers every kind and library", () => {
    const kinds = new Set(cases.flatMap((c) => read(c).items.map((i: OutputItem) => (i.kind === "chart" ? i.lib : i.kind === "image" ? i.source : i.kind))));
    expect([...kinds].sort()).toEqual(["bokeh", "file", "matplotlib", "pil", "plotly", "table", "vega-lite"]);
  });
  it.each(cases)("%s matches the contract", (c) => {
    expect(manifest.safeParse(read(c)).success).toBe(true);
  });
  it("saves matplotlib figures as PNG and keeps the figure (with its matplotlib) for SVG / PDF", () => {
    for (const c of ["matplotlib", "seaborn", "pandas-plot", "sklearn-confusion"]) {
      const fig = item(c);
      expect(fig.kind === "image" && Object.keys(fig.files).sort()).toEqual(["mpl", "png"]);
      expect(fig.kind === "image" && fig.matplotlib).toMatch(/^\d+\.\d+/);
    }
    const fig = item("matplotlib");
    expect(fig.kind === "image" && fig.title).toBe("Training loss");
  });
  it("keeps a table preview with its index and the full CSV", () => {
    const t = item("table");
    expect(t.kind).toBe("table");
    if (t.kind !== "table") return;
    expect(t.columns).toEqual(["", "epoch", "loss", "val"]);
    expect(t.rows[0]).toEqual([0, 1, 0.9, 1.0]);
    expect(t.files.csv).toBe("0.csv");
  });
});

describe("downloadFormats", () => {
  it("offers a figure's PNG, converted JPG / WebP, and SVG / PDF made from the kept figure", () => {
    expect(formats(item("matplotlib"))).toEqual(["png:file", "jpg:convert", "webp:convert", "svg:figure", "pdf:figure"]);
    expect(downloadFormats(item("matplotlib")).filter((f) => f.how === "figure")).toEqual([
      { format: "svg", label: "SVG", how: "figure", file: "0.mpl" },
      { format: "pdf", label: "PDF", how: "figure", file: "0.mpl" },
    ]);
  });
  it("offers stored SVG / PDF as files (server runs, figures that couldn't be kept, runs from before)", () => {
    const fig: OutputItem = { kind: "image", source: "matplotlib", width: 1, height: 1, title: "", files: { png: "0.png", svg: "0.svg", pdf: "0.pdf" } };
    expect(formats(fig)).toEqual(["png:file", "jpg:convert", "webp:convert", "svg:file", "pdf:file"]);
  });
  it("offers PNG, JPG, WebP, SVG and the spec for Plotly / Vega-Lite; no SVG for Bokeh", () => {
    expect(formats(item("plotly-scatter"))).toEqual(["png:render", "jpg:render", "webp:render", "svg:render", "pdf:render", "json:file"]);
    expect(formats(item("altair-bar"))).toEqual(["png:render", "jpg:render", "webp:render", "svg:render", "pdf:render", "json:file"]);
    expect(formats(item("bokeh-line"))).toEqual(["png:render", "jpg:render", "webp:render", "pdf:render", "json:file"]);
  });
  it("offers CSV for tables, from the preview when the full CSV wasn't kept", () => {
    expect(formats(item("table"))).toEqual(["csv:file"]);
    const t = item("table");
    if (t.kind === "table") expect(formats({ ...t, files: {} })).toEqual(["csv:render"]);
  });
  it("keeps a written JPG as is and converts nothing it can't decode", () => {
    const jpg: OutputItem = { kind: "image", source: "file", width: 1, height: 1, title: "", files: { jpg: "0.jpg" } };
    expect(formats(jpg)).toEqual(["jpg:file"]);
  });
});

describe("helpers", () => {
  it("names downloads after the block", () => {
    expect(downloadName("train.py", 0, "png")).toBe("train-1.png");
    expect(downloadName("", 2, "csv")).toBe("output-3.csv");
    expect(downloadName("my run (v2).py", 1, "svg")).toBe("my-run-v2-2.svg");
  });
  it("writes a CSV from the preview, quoting where needed", () => {
    expect(previewCsv({ kind: "table", index_columns: 0, columns: ["a", "b"], rows: [["x,y", null], ['say "hi"', 2]], total_rows: 2, total_columns: 2, files: {} })).toBe(
      'a,b\n"x,y",\n"say ""hi""",2\n',
    );
  });
  it("labels outputs", () => {
    expect(outputLabel(item("table"))).toBe("Table · 5 × 3");
    expect(outputLabel(item("altair-line"))).toBe("Vega-Lite chart");
    expect(outputLabel(item("file"))).toBe("written.png");
  });
  it("lists every stored path of a run", () => {
    const o = savedOutputs.parse({ ...read("matplotlib"), dir: DIR });
    expect(outputPaths(o).sort()).toEqual([`${DIR}/0.mpl`, `${DIR}/0.png`]);
  });
  it("rejects folders and names outside the scheme", () => {
    expect(savedOutputs.safeParse({ ...read("matplotlib"), dir: "../x" }).success).toBe(false);
    const bad = read("matplotlib");
    bad.items[0].files.png = "../../etc.png";
    expect(manifest.safeParse(bad).success).toBe(false);
  });
  it("puts text, outputs and the manifest in the run archive", () => {
    const m = manifest.parse(read("matplotlib"));
    const names = runArchiveEntries({ stdout: "hi\n", stderr: "", error: null }, { manifest: m, files: { "0.png": new Uint8Array([1]) } }).map((e) => e.name);
    expect(names).toEqual(["stdout.txt", "outputs/0.png", "outputs/manifest.json"]);
  });
  it("stores outputs in the run record only when there are some", () => {
    const r = { outcome: "ok" as const, error: null, ms: 1 };
    const o = savedOutputs.parse({ ...read("matplotlib"), dir: DIR });
    const with_ = toLastRun([], r, "browser", "x", new Date(0), o);
    expect(lastRun.parse(with_).outputs?.items).toHaveLength(1);
    expect("outputs" in toLastRun([], r, "browser", "x", new Date(0), null)).toBe(false);
    expect(JSON.stringify(with_).length).toBeLessThan(600_000);
  });
});

describe("splitBundle (server runs)", () => {
  it("separates the user's stdout from the outputs bundle", () => {
    const bundle = JSON.stringify({ manifest: read("matplotlib"), files: { "0.png": "AQ==" } });
    const r = splitBundle(`hello\n${BUNDLE_MARK}${bundle}\n`);
    expect(r.stdout).toBe("hello\n");
    expect(r.outputs?.files["0.png"]).toBe("AQ==");
  });
  it("leaves stdout without a bundle alone and drops a broken one", () => {
    expect(splitBundle("plain\n")).toEqual({ stdout: "plain\n", outputs: null });
    expect(splitBundle(`a${BUNDLE_MARK}{oops`)).toEqual({ stdout: "a", outputs: null });
  });
});

"use client";
// Interactive charts on the web: Plotly.js, Vega-Embed and BokehJS, loaded from
// their CDNs on first use, drawing the spec the Python library saved. The app's
// theme is laid over the spec (transparent background, theme text and grid), as
// the Android renderer does, so a chart looks the same on both.
import { deflateRgb, imagePdf } from "./pdf";
import type { ChartLib } from "./run/outputs";
import { FriendlyError } from "./user-message";

const PLOTLY = "https://cdn.plot.ly/plotly-4.1.1.min.js";
const VEGA = ["https://cdn.jsdelivr.net/npm/vega@6", "https://cdn.jsdelivr.net/npm/vega-lite@6", "https://cdn.jsdelivr.net/npm/vega-embed@7"];
const bokehScript = (version: string) => `https://cdn.bokeh.org/bokeh/release/bokeh-${version.replace(/[^\d.]/g, "")}.min.js`;

const loaded = new Map<string, Promise<void>>();
function script(src: string): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src, async: false, crossOrigin: "anonymous" });
      s.onload = () => resolve();
      s.onerror = () => {
        loaded.delete(src);
        reject(Object.assign(new Error(`script ${new URL(src).hostname} failed to load`), { code: "network" }));
      };
      document.head.append(s);
    });
    loaded.set(src, p);
  }
  return p;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The chart libraries attach themselves to window (loaded as plain scripts). */
const browserGlobals = () => window as any;

export interface Theme {
  fg: string;
  muted: string;
  line: string;
}

export function readTheme(el: Element): Theme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { fg: v("--fg", "#e8e6e3"), muted: v("--muted", "#8a8885"), line: v("--line", "#2a2a2a") };
}

/** A drawn chart: export it as an image, then dispose of it. */
export interface DrawnChart {
  image(format: "png" | "jpg" | "webp" | "svg", scale?: number): Promise<Blob>;
  dispose(): void;
}

function themedPlotly(spec: any, t: Theme | null) {
  const layout = { ...(spec.layout ?? {}) };
  if (t) {
    const axis = (a: any) => ({ ...(a ?? {}), color: t.muted, gridcolor: t.line, zerolinecolor: t.line, linecolor: t.line });
    Object.assign(layout, { paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { ...(layout.font ?? {}), color: t.fg } });
    for (const k of Object.keys(layout)) if (/^[xy]axis\d*$/.test(k)) layout[k] = axis(layout[k]);
    if (!layout.xaxis) layout.xaxis = axis(null);
    if (!layout.yaxis) layout.yaxis = axis(null);
    if (layout.legend) layout.legend = { ...layout.legend, bgcolor: "rgba(0,0,0,0)" };
    // Phone-sized margins (Plotly's default leaves 80 px each side).
    const titled = Boolean(layout.title?.text);
    layout.margin = { l: 48, r: 16, b: 44, t: titled ? 48 : 16, pad: 0, ...(spec.layout?.margin ?? {}) };
    if (titled) layout.title = { ...layout.title, x: 0, xref: "paper", font: { size: 14, ...(layout.title.font ?? {}) } };
  }
  layout.autosize = true;
  delete layout.width;
  delete layout.height;
  return layout;
}

/** Bokeh's JSON item with the theme on every axis, grid, title and legend, sized to its box. */
function themedBokeh(item: any, t: Theme | null, interactive: boolean) {
  const copy = JSON.parse(JSON.stringify(item));
  const set: Record<string, (a: any) => void> = t
    ? {
        axis: (a) => Object.assign(a, { axis_line_color: t.line, major_tick_line_color: t.line, minor_tick_line_color: t.line, major_label_text_color: t.muted, axis_label_text_color: t.fg }),
        Grid: (a) => Object.assign(a, { grid_line_color: t.line }),
        Title: (a) => Object.assign(a, { text_color: t.fg }),
        Legend: (a) => Object.assign(a, { label_text_color: t.fg, background_fill_alpha: 0, border_line_alpha: 0 }),
        Figure: (a) => Object.assign(a, { background_fill_alpha: 0, border_fill_alpha: 0, outline_line_color: t.line }),
      }
    : {};
  const walk = (v: any) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    if (v.type === "object" && typeof v.name === "string" && v.attributes) {
      const kind = /Axis$/.test(v.name) ? "axis" : v.name;
      set[kind]?.(v.attributes);
    }
    Object.values(v).forEach(walk);
  };
  walk(copy.doc);
  for (const root of copy.doc?.roots ?? []) {
    if (!root?.attributes) continue;
    Object.assign(root.attributes, { sizing_mode: "stretch_both" });
    delete root.attributes.width;
    delete root.attributes.height;
    if (!interactive) root.attributes.toolbar_location = null;
  }
  return copy;
}

function themedVega(spec: any, t: Theme | null) {
  if (!t) return spec;
  const config = spec.config ?? {};
  const axis = { domainColor: t.line, gridColor: t.line, tickColor: t.line, labelColor: t.muted, titleColor: t.fg };
  return {
    ...spec,
    background: "transparent",
    config: {
      ...config,
      axis: { ...axis, ...(config.axis ?? {}) },
      legend: { labelColor: t.muted, titleColor: t.fg, ...(config.legend ?? {}) },
      title: { color: t.fg, ...(config.title ?? {}) },
      view: { stroke: t.line, ...(config.view ?? {}) },
    },
  };
}

async function toBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

/** Re-encodes a PNG/SVG image as JPG or WebP over a solid background. */
export async function convertImage(src: Blob, format: "jpg" | "webp" | "png", background = "#ffffff"): Promise<Blob> {
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = Object.assign(document.createElement("canvas"), { width: img.naturalWidth || 1200, height: img.naturalHeight || 800 });
    const g = c.getContext("2d")!;
    if (format !== "png") {
      g.fillStyle = background;
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(img, 0, 0, c.width, c.height);
    const type = format === "jpg" ? "image/jpeg" : `image/${format}`;
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error(`${format.toUpperCase()} isn't supported by this browser`))), type, 0.92));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A PNG as a one-page lossless PDF; `scale` is the PNG's pixels per CSS pixel (page size in points). */
export async function pngToPdf(png: Blob, scale = 2): Promise<Blob> {
  const img = await createImageBitmap(png);
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const deflated = await deflateRgb(g.getImageData(0, 0, c.width, c.height).data);
  const pdf = imagePdf({ deflated, width: c.width, height: c.height, pageWidth: (c.width / scale) * 0.75, pageHeight: (c.height / scale) * 0.75 });
  return new Blob([pdf as BlobPart], { type: "application/pdf" });
}

const ALWAYS_REMOVED = ["toImage", "sendDataToCloud", "toggleSpikelines", "hoverClosestCartesian", "hoverCompareCartesian", "hoverClosest3d", "hoverClosestGl2d", "hoverClosestPie", "tableRotation", "resetCameraLastSave3d", "resetViews", "resetGeo", "zoomInGeo", "zoomOutGeo", "toggleHover"];
/** Phones keep only buttons that work with a tap (user, 2026-11-05: hide those that don't function on a phone). */
export const TOUCH_BUTTONS = ["zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d", "resetCameraDefault3d"];
/** Desktop keeps the drag tools and reset (user, 2026-11-05); wheel zoom stays on. */
export const DESKTOP_BUTTONS = ["zoom2d", "pan2d", "resetScale2d", "zoom3d", "pan3d", "orbitRotation", "resetCameraDefault3d"];
const ALL_BUTTONS = ["zoom2d", "pan2d", "select2d", "lasso2d", "zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d", "zoom3d", "pan3d", "orbitRotation", "resetCameraDefault3d"];

export interface PlotlyControls {
  displayModeBar: boolean | "hover";
  /** Buttons taken off Plotly's modebar (downloads go through the page's format picker). */
  remove: string[];
  /** Phones: one-finger drag pans, and the title sits under the modebar instead of beneath it. */
  dragmode?: "pan";
  titleUnderBar?: boolean;
}

/** Plotly's modebar for a chart: none inline, the tap buttons on phones, the drag tools on desktop. */
export function plotlyControls(interactive: boolean, coarse: boolean): PlotlyControls {
  if (!interactive) return { displayModeBar: false, remove: ALWAYS_REMOVED };
  const keep = coarse ? TOUCH_BUTTONS : DESKTOP_BUTTONS;
  const remove = [...ALL_BUTTONS.filter((b) => !keep.includes(b)), ...ALWAYS_REMOVED];
  // No hover on touch screens, so the bar shows all the time there.
  return coarse ? { displayModeBar: true, remove, dragmode: "pan", titleUnderBar: true } : { displayModeBar: "hover", remove };
}

/** Phones: room above the plot for the modebar, the title just under it. */
function titleUnderBar(layout: any) {
  const titled = Boolean(layout.title?.text);
  return {
    ...layout,
    margin: { ...(layout.margin ?? {}), t: titled ? 72 : 40 },
    ...(titled ? { title: { ...layout.title, yref: "paper", y: 1, yanchor: "bottom", pad: { b: 8 } } } : {}),
  };
}

const coarsePointer = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Draws a chart into `el`. `interactive` false gives a still chart (inline, in the
 * note) whose taps go to the viewer; true gives zoom, pan, hover and legend toggles.
 * `theme` null keeps the library's own colours (static renders for downloads).
 */
export async function drawChart(el: HTMLElement, lib: ChartLib, version: string, spec: any, opts: { interactive: boolean; theme: Theme | null }): Promise<DrawnChart> {
  if (lib === "plotly") {
    await script(PLOTLY);
    const Plotly = browserGlobals().Plotly;
    const controls = plotlyControls(opts.interactive, coarsePointer());
    const layout = themedPlotly(spec, opts.theme);
    const placed = controls.titleUnderBar ? titleUnderBar(layout) : layout;
    await Plotly.newPlot(el, spec.data ?? [], controls.dragmode ? { ...placed, dragmode: controls.dragmode } : placed, {
      responsive: true,
      displaylogo: false,
      showLink: false,
      showSendToCloud: false,
      showEditInChartStudio: false,
      staticPlot: !opts.interactive,
      displayModeBar: controls.displayModeBar,
      scrollZoom: opts.interactive,
      modeBarButtonsToRemove: controls.remove,
    });
    return {
      image: async (format, scale = 2) => {
        const fmt = format === "jpg" ? "jpeg" : format;
        const r = el.getBoundingClientRect();
        const width = Math.max(600, Math.round(r.width));
        const height = Math.max(400, Math.round(r.height));
        // Downloads use the library's own (light) colours so they read on any background.
        const off = document.createElement("div");
        Object.assign(off.style, { position: "fixed", left: "-10000px", top: "0", width: `${width}px`, height: `${height}px` });
        document.body.append(off);
        try {
          await Plotly.newPlot(off, spec.data ?? [], themedPlotly(spec, null), { staticPlot: true });
          return await toBlob(await Plotly.toImage(off, { format: fmt, width, height, scale: format === "svg" ? 1 : scale }));
        } finally {
          Plotly.purge(off);
          off.remove();
        }
      },
      dispose: () => Plotly.purge(el),
    };
  }
  if (lib === "vega-lite") {
    for (const s of VEGA) await script(s);
    const result = await browserGlobals().vegaEmbed(el, { ...themedVega(spec, opts.theme), width: "container", autosize: { type: "fit", contains: "padding" } }, {
      actions: false,
      renderer: "svg",
      tooltip: opts.interactive ? undefined : false,
    });
    if (!opts.interactive) el.style.pointerEvents = "none";
    return {
      image: async (format, scale = 2) => {
        const plain = await browserGlobals().vegaEmbed(document.createElement("div"), spec, { actions: false, renderer: "canvas" });
        try {
          if (format === "svg") return new Blob([await plain.view.toSVG()], { type: "image/svg+xml" });
          const png = await toBlob(await plain.view.toImageURL("png", scale));
          return format === "png" ? png : convertImage(png, format);
        } finally {
          plain.finalize();
        }
      },
      dispose: () => result.finalize(),
    };
  }
  // Bokeh: its own toolbar gives pan, zoom, reset, hover and legend toggles (as the figure was built).
  await script(bokehScript(version));
  el.id ||= `bk-${Math.random().toString(36).slice(2)}`;
  const manager = await browserGlobals().Bokeh.embed.embed_item(themedBokeh(spec, opts.theme, opts.interactive), el.id);
  // BokehJS 3 answers a ViewManager (iterable, with .roots); older ones an array of views.
  const views: any[] = manager?.roots ? [...manager.roots] : Array.isArray(manager) ? manager : manager ? [...manager] : [];
  if (!opts.interactive) el.style.pointerEvents = "none";
  return {
    image: async (format) => {
      if (format === "svg") throw new FriendlyError("Bokeh charts download as PNG, JPG or WebP.");
      // BokehJS draws into canvases inside shadow roots; its own export composites them.
      const view = views[0];
      if (!view?.export) throw new FriendlyError("Nothing to download yet. Try again in a moment.");
      const png: Blob = await view.export("png").to_blob();
      return format === "png" ? png : convertImage(png, format);
    },
    dispose: () => {
      for (const v of views) v?.remove?.();
      el.replaceChildren();
    },
  };
}

/**
 * Static PNG + SVG of a Plotly or Vega-Lite chart, made at run time on the web and
 * stored with the spec: what Android shows for chart types its renderer doesn't draw yet.
 */
export async function staticRender(lib: ChartLib, version: string, spec: any): Promise<{ png?: Uint8Array; svg?: Uint8Array }> {
  if (lib === "bokeh") return {};
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", width: "800px", height: "500px" });
  document.body.append(host);
  try {
    const chart = await drawChart(host, lib, version, spec, { interactive: false, theme: null });
    try {
      const bytes = async (f: "png" | "svg") => new Uint8Array(await (await chart.image(f, 2)).arrayBuffer());
      return { png: await bytes("png"), svg: await bytes("svg") };
    } finally {
      chart.dispose();
    }
  } catch {
    return {};
  } finally {
    host.remove();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Adds a static PNG + SVG next to each Plotly / Vega-Lite spec before upload (Android's fallback). */
export async function addStaticRenders(c: import("./run/outputs").CapturedOutputs): Promise<import("./run/outputs").CapturedOutputs> {
  const files = { ...c.files };
  const items = await Promise.all(
    c.manifest.items.map(async (item, i) => {
      if (item.kind !== "chart" || !item.files.json || item.lib === "bokeh") return item;
      const spec = JSON.parse(new TextDecoder().decode(files[item.files.json]!));
      const still = await staticRender(item.lib, item.version, spec);
      const extra: Record<string, string> = {};
      for (const f of ["png", "svg"] as const) {
        const bytes = still[f];
        if (bytes) {
          extra[f] = `${i}.${f}`;
          files[`${i}.${f}`] = bytes;
        }
      }
      return { ...item, files: { ...item.files, ...extra } };
    }),
  );
  return { manifest: { ...c.manifest, items }, files };
}

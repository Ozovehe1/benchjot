// Pure: a chart as one self-contained HTML page (the "HTML (interactive)" download), drawn by the
// chart's own library from its CDN with the spec inlined, so a Plotly animation keeps its play
// button and slider, a 3D plot still rotates, and Vega-Lite / Bokeh charts keep their tooltips.
// The same scripts and versions as the app's own viewer (src/lib/run/charts.ts).
import type { ChartLib } from "./outputs";

export const PLOTLY_SCRIPT = "https://cdn.plot.ly/plotly-4.1.1.min.js";
export const VEGA_SCRIPTS = ["https://cdn.jsdelivr.net/npm/vega@6", "https://cdn.jsdelivr.net/npm/vega-lite@6", "https://cdn.jsdelivr.net/npm/vega-embed@7"];
export const bokehScript = (version: string) => `https://cdn.bokeh.org/bokeh/release/bokeh-${version.replace(/[^\d.]/g, "")}.min.js`;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** JSON safe inside a <script>: no "</script>" or "<!--" can end or confuse the element. */
const LINE_SEPARATORS = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
const inline = (specJson: string) =>
  LINE_SEPARATORS.reduce((t, c) => t.split(c).join("\\u" + c.charCodeAt(0).toString(16)), JSON.stringify(JSON.parse(specJson)).replace(/</g, "\\u003c"));

const DRAW: Record<ChartLib, (version: string) => { scripts: string[]; code: string }> = {
  plotly: () => ({
    scripts: [PLOTLY_SCRIPT],
    // frames: an animation's steps; the figure's own buttons and sliders (layout.updatemenus / sliders) drive them.
    code: `Plotly.newPlot(el, { data: spec.data || [], layout: spec.layout || {}, frames: spec.frames || [], config: { responsive: true, displaylogo: false } });`,
  }),
  "vega-lite": () => ({ scripts: VEGA_SCRIPTS, code: `vegaEmbed(el, spec, { actions: false });` }),
  bokeh: (version) => ({ scripts: [bokehScript(version)], code: `Bokeh.embed.embed_item(spec, "chart");` }),
};

/** The page: `specJson` is the chart's stored spec (its .json file) as text. Throws if it isn't JSON. */
export function chartHtml(lib: ChartLib, version: string, specJson: string, title = ""): string {
  const { scripts, code } = DRAW[lib](version);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || "Chart")}</title>
<style>html,body{margin:0;height:100%;font-family:system-ui,sans-serif}#chart{width:100%;height:100vh}</style>
${scripts.map((s) => `<script src="${escapeHtml(s)}"></script>`).join("\n")}
</head>
<body>
<div id="chart"></div>
<script>
const spec = ${inline(specJson)};
const el = document.getElementById("chart");
${code}
</script>
</body>
</html>
`;
}

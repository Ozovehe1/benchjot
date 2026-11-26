// The "HTML (interactive)" download (src/lib/run/chart-html.ts): one page with the chart's own library
// and its spec inlined, so animations and 3D keep working; a spec can't break out of its <script>.
import { describe, expect, it } from "vitest";
import { chartHtml } from "@/lib/run/chart-html";

describe("chartHtml", () => {
  it("Plotly: draws data, layout and the animation's frames with the viewer's own script", () => {
    const spec = JSON.stringify({ data: [{ x: [1], y: [2] }], layout: { title: { text: "Orbit" }, sliders: [{}] }, frames: [{ name: "0", data: [{ x: [2] }] }] });
    const html = chartHtml("plotly", "6.0.0", spec, "Orbit <1>");
    expect(html).toContain('<script src="https://cdn.plot.ly/plotly-4.1.1.min.js"></script>');
    expect(html).toContain("frames: spec.frames || []");
    expect(html).toContain('"frames":[{"name":"0"');
    expect(html).toContain("<title>Orbit &lt;1&gt;</title>");
  });
  it("Vega-Lite and Bokeh use their own embeds (Bokeh's script by the chart's version)", () => {
    expect(chartHtml("vega-lite", "6", '{"mark":"bar"}')).toContain("vegaEmbed(el, spec");
    const bokeh = chartHtml("bokeh", "3.6.3", '{"doc":{}}');
    expect(bokeh).toContain("https://cdn.bokeh.org/bokeh/release/bokeh-3.6.3.min.js");
    expect(bokeh).toContain('Bokeh.embed.embed_item(spec, "chart")');
  });
  it("a spec can't end the script or start a comment", () => {
    const html = chartHtml("plotly", "6", JSON.stringify({ layout: { title: "</script><script>alert(1)</script><!--" } }));
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
    expect(html.match(/<script/g)).toHaveLength(2);
  });
  it("refuses a spec that isn't JSON", () => {
    expect(() => chartHtml("plotly", "6", "not json")).toThrow();
  });
});

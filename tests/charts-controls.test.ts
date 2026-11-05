import { describe, expect, it } from "vitest";
import { plotlyControls } from "@/lib/charts";

const kept = (remove: string[], all: string[]) => all.filter((b) => !remove.includes(b));
const ALL = ["zoom2d", "pan2d", "select2d", "lasso2d", "zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d", "zoom3d", "pan3d", "orbitRotation", "tableRotation", "resetCameraDefault3d", "resetCameraLastSave3d", "toImage"];

describe("plotlyControls", () => {
  it("phones: only the tap buttons, always shown, drag pans, title under the bar", () => {
    const c = plotlyControls(true, true);
    expect(kept(c.remove, ALL)).toEqual(["zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d", "resetCameraDefault3d"]);
    expect(c).toMatchObject({ displayModeBar: true, dragmode: "pan", titleUnderBar: true });
  });
  it("desktop: zoom, pan and reset (2D and 3D) on hover, nothing else", () => {
    const c = plotlyControls(true, false);
    expect(kept(c.remove, ALL)).toEqual(["zoom2d", "pan2d", "resetScale2d", "zoom3d", "pan3d", "orbitRotation", "resetCameraDefault3d"]);
    expect(c.displayModeBar).toBe("hover");
    expect(c.dragmode).toBeUndefined();
  });
  it("never shows a modebar on a still (inline) chart", () => {
    expect(plotlyControls(false, false).displayModeBar).toBe(false);
    expect(plotlyControls(false, true).displayModeBar).toBe(false);
  });
});

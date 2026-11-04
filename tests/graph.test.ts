import { describe, expect, it } from "vitest";
import { buildEdges, layoutGraph } from "@/lib/graph";
import { dragStep, fitView, MAX_ZOOM, zoomAt } from "@/lib/pan-zoom";

const A = "0b6e6a9e-1111-4222-8333-444455556666";
const B = "1c7f7b0f-2222-4333-9444-555566667777";
const C = "2d808c1a-3333-4444-a555-666677778888";
const nodes = [
  { id: A, title: "Alpha", parent_id: null },
  { id: B, title: "Beta", parent_id: A },
  { id: C, title: "Gamma", parent_id: null },
];

describe("buildEdges", () => {
  it("adds parent edges and resolved link edges, once per pair", () => {
    const edges = buildEdges(nodes, [
      { source: A, label: "x", id: C },
      { source: C, label: "Alpha", id: null }, // same pair, other way
      { source: B, label: "Alpha", id: null }, // already parent/child
      { source: C, label: "Gamma", id: null }, // self
      { source: A, label: "Missing", id: null },
      { source: A, label: "gone", id: "00000000-0000-4000-8000-000000000000" },
    ]);
    expect(edges).toEqual([
      { source: A, target: B, kind: "parent" },
      { source: A, target: C, kind: "link" },
    ]);
  });
});

describe("layoutGraph", () => {
  it("places every node at a finite, distinct, repeatable point", () => {
    const edges = buildEdges(nodes, []);
    const a = layoutGraph(nodes, edges);
    const b = layoutGraph(nodes, edges);
    expect(a).toEqual(b);
    expect(a.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(new Set(a.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size).toBe(3);
  });
});

describe("pan and zoom", () => {
  it("keeps the pinch point fixed and clamps the zoom", () => {
    const v = zoomAt({ k: 1, x: 10, y: 20 }, 2, 100, 100);
    expect(v.k).toBe(2);
    // graph point under (100,100) before: (90, 80); after: same
    expect((100 - v.x) / v.k).toBeCloseTo(90);
    expect((100 - v.y) / v.k).toBeCloseTo(80);
    expect(zoomAt({ k: 3, x: 0, y: 0 }, 10, 0, 0).k).toBe(MAX_ZOOM);
  });
  it("fits points into the screen", () => {
    const v = fitView([{ x: -100, y: 0 }, { x: 100, y: 50 }], 360, 600);
    for (const p of [{ x: -100, y: 0 }, { x: 100, y: 50 }]) {
      const sx = p.x * v.k + v.x;
      expect(sx).toBeGreaterThanOrEqual(48 - 1e-9);
      expect(sx).toBeLessThanOrEqual(360 - 48 + 1e-9);
    }
  });
});

describe("dragStep", () => {
  it("pans with one pointer", () => {
    expect(dragStep({ k: 2, x: 0, y: 0 }, { x: 10, y: 10 }, { x: 15, y: 7 }, null)).toEqual({ k: 2, x: 5, y: -3 });
  });
  it("pinches around the midpoint, within the limits given", () => {
    const v = dragStep({ k: 1, x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0 }, 1, 8);
    expect(v.k).toBeCloseTo(2);
    expect(dragStep({ k: 1, x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 1, 8).k).toBe(1);
  });
});

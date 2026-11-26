import { describe, expect, it } from "vitest";
import { arrowHead, buildEdges, edgeEnds, isFiltering, labelsToShow, layoutGraph, mapHref, mapMatches, mapSlice, MAP_MAX_NOTES, NO_FILTER, type MapNote } from "@/lib/notes/graph";
import { dragStep, fitView, MAX_ZOOM, zoomAt } from "@/lib/ui/pan-zoom";

const A = "0b6e6a9e-1111-4222-8333-444455556666";
const B = "1c7f7b0f-2222-4333-9444-555566667777";
const C = "2d808c1a-3333-4444-a555-666677778888";
const note = (id: string, title: string, parent_id: string | null = null): MapNote => ({ id, title, parent_id, derived_from: null, outcome: null, project_id: null, created_at: "2026-11-01T00:00:00Z" });
const nodes = [note(A, "Alpha"), note(B, "Beta", A), note(C, "Gamma")];

describe("buildEdges", () => {
  it("adds parent edges and resolved link edges, once per directed pair; a reverse link is mutual", () => {
    const edges = buildEdges(nodes, [
      { source: A, label: "x", id: C },
      { source: C, label: "Alpha", id: null }, // same pair, other way
      { source: B, label: "Alpha", id: null }, // already parent/child
      { source: C, label: "Gamma", id: null }, // self
      { source: A, label: "Missing", id: null },
      { source: A, label: "gone", id: "00000000-0000-4000-8000-000000000000" },
    ]);
    expect(edges).toEqual([
      { source: A, target: B, kind: "parent", mutual: false },
      { source: A, target: C, kind: "link", mutual: true },
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
  it("puts the focus at the origin", () => {
    const p = layoutGraph(nodes, buildEdges(nodes, []), B).find((n) => n.id === B)!;
    expect([p.x, p.y]).toEqual([0, 0]);
  });
});

describe("edge geometry", () => {
  it("runs rim to rim and points the arrow at the target", () => {
    const e = edgeEnds({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, 10)!;
    expect(e).toEqual({ from: { x: 5, y: 0 }, to: { x: 90, y: 0 } });
    const [tip, l, r] = arrowHead(e.from, e.to, 8);
    expect(tip).toEqual({ x: 90, y: 0 });
    expect(l.x).toBeCloseTo(82);
    expect(r.x).toBeCloseTo(82);
    expect(edgeEnds({ x: 0, y: 0 }, { x: 3, y: 0 }, 5, 5)).toBeNull();
  });
  it("links Around and Everything", () => {
    expect(mapHref(A, 9)).toBe(`/map?focus=${A}&depth=3`);
    expect(mapHref(null)).toBe("/map");
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

describe("mapSlice: a big map draws whole groups, most recent first", () => {
  const node = (id: string) => ({ id, title: id, parent_id: null, derived_from: null, outcome: null, project_id: null, created_at: "2026-01-01T00:00:00Z", degree: 1, radius: 4, mark: "unmarked" as const, label: id });
  // Three groups in recency order: a (3 notes), b (4), c (2).
  const groups = [["a1", "a2", "a3"], ["b1", "b2", "b3", "b4"], ["c1", "c2"]];
  const graph = {
    nodes: ["a1", "b1", "c1", "a2", "b2", "c2", "a3", "b3", "b4"].map(node),
    edges: groups.flatMap((g) => g.slice(1).map((id) => ({ source: g[0]!, target: id, kind: "link" as const, mutual: false }))),
  };
  it("leaves a small map as it is", () => {
    expect(mapSlice(graph, 9)).toEqual({ graph, hidden: 0 });
  });
  it("keeps whole groups from the most recent note, and the edges between them", () => {
    const { graph: g, hidden } = mapSlice(graph, 7);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a1", "a2", "a3", "b1", "b2", "b3", "b4"]);
    expect(g.edges).toHaveLength(5);
    expect(hidden).toBe(2);
  });
  it("cuts only the group that alone passes the limit", () => {
    const { graph: g } = mapSlice(graph, 5);
    expect(g.nodes).toHaveLength(5);
    expect(g.nodes.filter((n) => n.id.startsWith("a"))).toHaveLength(3);
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.source) && g.nodes.some((n) => n.id === e.target))).toBe(true);
  });
  it("is fast for thousands of notes", () => {
    const n = 20_000;
    const big = { nodes: Array.from({ length: n }, (_, i) => node(`n${i}`)), edges: Array.from({ length: n - 1 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}`, kind: "link" as const, mutual: false })) };
    const t = performance.now();
    expect(mapSlice(big, MAP_MAX_NOTES).graph.nodes).toHaveLength(MAP_MAX_NOTES);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("labelsToShow: no two labels overlap, the most important drawn first", () => {
  it("keeps the first of two that would overlap, and both when apart", () => {
    expect([...labelsToShow([{ id: "a", x: 0, y: 0, w: 100 }, { id: "b", x: 50, y: 5, w: 100 }])]).toEqual(["a"]);
    expect([...labelsToShow([{ id: "a", x: 0, y: 0, w: 100 }, { id: "b", x: 0, y: 20, w: 100 }])]).toEqual(["a", "b"]);
  });
  it("is quick for a full map", () => {
    const items = Array.from({ length: MAP_MAX_NOTES }, (_, i) => ({ id: `n${i}`, x: (i * 37) % 1200, y: (i * 53) % 800, w: 160 }));
    const t = performance.now();
    labelsToShow(items);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe("map find and filters", () => {
  const n = { title: "Warmup sweep", mark: "success" as const, project_id: "p" };
  it("matches by title (any case), outcome and project", () => {
    expect(mapMatches(n, NO_FILTER)).toBe(true);
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(mapMatches(n, { ...NO_FILTER, find: "WARM" })).toBe(true);
    expect(mapMatches(n, { ...NO_FILTER, find: "dropout" })).toBe(false);
    expect(mapMatches(n, { ...NO_FILTER, marks: new Set(["failed"]) })).toBe(false);
    expect(mapMatches(n, { ...NO_FILTER, project: "q" })).toBe(false);
    expect(isFiltering({ ...NO_FILTER, project: "p" })).toBe(true);
  });
});

describe("labelsToShow: labels keep off other notes' marks", () => {
  it("skips a label that would cover another note, never its own", () => {
    const marks = [{ id: "a", x: -5, y: 9, r: 5 }, { id: "b", x: 40, y: 9, r: 5 }];
    expect([...labelsToShow([{ id: "a", x: 0, y: 0, w: 100 }], 18, marks)]).toEqual([]);
    expect([...labelsToShow([{ id: "a", x: 0, y: 0, w: 30 }], 18, marks)]).toEqual(["a"]);
  });
});

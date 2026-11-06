// Research Map model against the shared parity fixture (Android checks the same file).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aroundGraph, aroundList, buildGraph, HIT_RADIUS, nodeRadius, parseDepth, RADIUS, DEPTH, showArrow, type EdgeKind, type Lens, type MapNote } from "@/lib/graph";
import type { SourcedLink } from "@/lib/links";
import { ACTION_TEXT } from "@/lib/user-message";
import { BRAND } from "@/lib/brand";

const fx = JSON.parse(readFileSync(new URL("./fixtures/map_model.json", import.meta.url), "utf8"));
const notes = fx.input.notes as MapNote[];
const links = fx.input.links as SourcedLink[];
const graph = buildGraph(notes, links);

describe("map model parity (tests/fixtures/map_model.json)", () => {
  it("builds directed, deduplicated edges", () => {
    expect(graph.edges).toEqual(fx.expect.edges);
  });
  it("gives each node its degree, size, mark and label", () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(fx.expect.nodes.map((n: { id: string }) => n.id));
    graph.nodes.forEach((n, i) => {
      const want = fx.expect.nodes[i];
      expect(n.degree).toBe(want.degree);
      expect(n.radius).toBeCloseTo(want.radius, 5);
      expect(n.mark).toBe(want.mark);
      expect(n.label).toBe(want.label);
    });
    for (const c of fx.expect.radiusCap) expect(nodeRadius(c.degree)).toBe(c.radius);
  });
  it("uses the fixture's constants", () => {
    expect(RADIUS).toMatchObject({ base: fx.rules.radius.base, perSqrtDegree: fx.rules.radius.perSqrtDegree, max: fx.rules.radius.max });
    expect(HIT_RADIUS).toBe(fx.rules.hitRadius);
    expect(DEPTH).toMatchObject({ min: fx.rules.depth.min, max: fx.rules.depth.max, default: fx.rules.depth.default });
    expect(ACTION_TEXT.load_map).toBe(fx.rules.errors.loadMap);
    expect(ACTION_TEXT.new_attempt).toBe(fx.rules.errors.newAttempt);
  });
  it("parses depth", () => {
    for (const c of fx.expect.parseDepth) expect([c.in, parseDepth(c.in)]).toEqual([c.in, c.out]);
  });
  it("decides arrows", () => {
    for (const c of fx.expect.arrows as { kind: EdgeKind; lens: Lens; zoom: number; show: boolean }[]) expect(showArrow(c.kind, c.lens, c.zoom)).toBe(c.show);
  });
  it("builds the Around lens and its list", () => {
    for (const c of fx.expect.around) {
      const a = aroundGraph(graph, c.focus, c.depth);
      expect(a.nodes.map((n) => [n.id, a.hops.get(n.id)])).toEqual(c.nodes);
      expect(a.edges.length).toBe(c.edgeCount);
      expect(aroundList(graph, c.focus, c.depth).map((g) => ({ group: g.group, ids: g.nodes.map((n) => n.id) }))).toEqual(c.list);
    }
  });
});

// WCAG 2.1 relative luminance and contrast ratio.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("map colours (WCAG AA)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const palette: Record<string, string> = { charcoal: BRAND.charcoal, ash: BRAND.ash };
  const at = css.indexOf(".light {");
  const block = { dark: css.slice(css.indexOf(":root"), at), light: css.slice(at, css.indexOf("}", at)) };
  const tokenIn = (theme: "dark" | "light", name: string) => {
    const raw = new RegExp(`--${name}:\\s*([^;]+);`).exec(block[theme])?.[1]?.trim() ?? "";
    const v = /^var\(--(\w+)\)$/.exec(raw)?.[1];
    return (v ? palette[v] : raw)?.toLowerCase();
  };
  for (const theme of ["dark", "light"] as const) {
    const t = fx.tokens[theme] as Record<string, string>;
    it(`${theme}: globals.css matches the fixture tokens`, () => {
      for (const name of Object.keys(t)) expect([name, tokenIn(theme, name)]).toEqual([name, t[name]!.toLowerCase()]);
    });
    it(`${theme}: every mark and line is >= 3:1 on the background, labels >= 4.5:1`, () => {
      for (const m of Object.values(fx.rules.marks) as { color: string }[]) expect(ratio(t[m.color]!, t.bg!)).toBeGreaterThanOrEqual(fx.rules.minContrast.mark);
      for (const e of Object.values(fx.rules.edgeStyle) as { color: string }[]) expect(ratio(t[e.color]!, t.bg!)).toBeGreaterThanOrEqual(fx.rules.minContrast.mark);
      expect(ratio(t.ok!, t.bg!)).toBeGreaterThanOrEqual(fx.rules.minContrast.mark);
      for (const text of ["fg", "muted"]) expect(ratio(t[text]!, t.bg!)).toBeGreaterThanOrEqual(fx.rules.minContrast.text);
    });
  }
});

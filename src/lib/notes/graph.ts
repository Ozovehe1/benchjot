// The Research Map model: notes as nodes; links, parent -> sub-note and
// origin -> attempt (derived_from) as directed edges. Pure functions only.
//
// This is a shared contract: the Android app (core Graph.kt) implements the same
// rules and both are checked against tests/fixtures/map_model.json. Change the
// fixture's rules first, then both apps.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { displayTitle } from "../ui/format";
import type { SourcedLink } from "./links";
import type { Outcome } from "./outcome";

export type EdgeKind = "link" | "parent" | "derived";
export type Lens = "around" | "everything";
export type Mark = "unmarked" | "success" | "failed";

/** What the map needs of a note (the note index row). */
export interface MapNote {
  id: string;
  title: string;
  parent_id: string | null;
  derived_from: string | null;
  outcome: Outcome | null;
  project_id: string | null;
  created_at: string;
}

/** A directed edge. `mutual`: a link that also goes target -> source (arrows at both ends). */
interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  mutual: boolean;
}

export interface GraphNode extends MapNote {
  degree: number;
  radius: number;
  mark: Mark;
  label: string;
}

interface MapGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const RADIUS = { base: 4, perSqrtDegree: 1.5, max: 10 } as const;
/** px around a node that counts as a tap on it: a 48px target whatever the drawn size. */
export const HIT_RADIUS = 24;
export const DEPTH = { min: 1, max: 3, default: 1 } as const;

const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

/**
 * Edges between existing notes. Structural edges first, in note order: parent -> child,
 * then origin -> attempt. Then links in link order: dropped when unresolved, a self-link,
 * from a missing note, on a pair that already has a structural edge, or repeated; a
 * reverse link marks the first one mutual.
 */
export function buildEdges(nodes: readonly MapNote[], links: readonly SourcedLink[]): GraphEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  const structural = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    if (n.parent_id && n.parent_id !== n.id && ids.has(n.parent_id)) {
      structural.add(pairKey(n.parent_id, n.id));
      edges.push({ source: n.parent_id, target: n.id, kind: "parent", mutual: false });
    }
    if (n.derived_from && n.derived_from !== n.id && ids.has(n.derived_from)) {
      structural.add(pairKey(n.derived_from, n.id));
      edges.push({ source: n.derived_from, target: n.id, kind: "derived", mutual: false });
    }
  }
  // Links resolved through maps, as resolveLink does (by id, else the first note with that title):
  // one pass over the notes, not one per link.
  const byTitle = new Map<string, string>();
  for (const n of nodes) {
    const key = n.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, n.id);
  }
  const resolve = (l: SourcedLink) => (l.id ? (ids.has(l.id) ? l.id : undefined) : byTitle.get(l.label.toLowerCase()));
  const linkAt = new Map<string, GraphEdge>(); // "source target" -> edge
  for (const l of links) {
    const target = resolve(l);
    if (!target || target === l.source || !ids.has(l.source) || structural.has(pairKey(l.source, target))) continue;
    if (linkAt.has(`${l.source} ${target}`)) continue;
    const reverse = linkAt.get(`${target} ${l.source}`);
    if (reverse) {
      reverse.mutual = true;
      continue;
    }
    const e: GraphEdge = { source: l.source, target, kind: "link", mutual: false };
    linkAt.set(`${l.source} ${target}`, e);
    edges.push(e);
  }
  return edges;
}

/** Drawn radius for a node with `degree` edges: grows with √degree, capped. */
export function nodeRadius(degree: number): number {
  return Math.min(RADIUS.max, RADIUS.base + RADIUS.perSqrtDegree * Math.sqrt(Math.max(0, degree)));
}

function markFor(outcome: Outcome | null): Mark {
  return outcome ?? "unmarked";
}

const OUTCOME_WORD: Record<Mark, string> = { success: "successful", failed: "failed", unmarked: "unmarked" };

/** The node's accessible name: "Tokenizer test, failed, 4 connections". */
function nodeLabel(title: string, outcome: Outcome | null, degree: number): string {
  return `${displayTitle(title)}, ${OUTCOME_WORD[markFor(outcome)]}, ${degree} ${degree === 1 ? "connection" : "connections"}`;
}

/** The whole map (the Everything lens): every note with its degree, size, mark and label. */
export function buildGraph(notes: readonly MapNote[], links: readonly SourcedLink[]): MapGraph {
  const edges = buildEdges(notes, links);
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes = notes.map((n) => {
    const d = degree.get(n.id) ?? 0;
    return { ...n, degree: d, radius: nodeRadius(d), mark: markFor(n.outcome), label: nodeLabel(n.title, n.outcome, d) };
  });
  return { nodes, edges };
}

/** The most notes the Everything picture lays out and draws (about a third of a second on a laptop). */
export const MAP_MAX_NOTES = 300;

/**
 * The part of a big map that is drawn: whole connected groups, starting from the first notes given
 * (most recently edited first), up to `max` notes, and the edges between them. A group is cut only
 * when it alone would pass the limit. `hidden` is how many notes were left out.
 */
export function mapSlice(graph: MapGraph, max = MAP_MAX_NOTES): { graph: MapGraph; hidden: number } {
  if (graph.nodes.length <= max) return { graph, hidden: 0 };
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    (next.get(e.source) ?? next.set(e.source, []).get(e.source)!).push(e.target);
    (next.get(e.target) ?? next.set(e.target, []).get(e.target)!).push(e.source);
  }
  const kept = new Set<string>();
  for (const n of graph.nodes) {
    if (kept.size >= max) break;
    if (kept.has(n.id)) continue;
    kept.add(n.id);
    const queue = [n.id];
    for (let i = 0; i < queue.length && kept.size < max; i++) {
      for (const m of next.get(queue[i]!) ?? []) {
        if (kept.size >= max) break;
        if (!kept.has(m)) {
          kept.add(m);
          queue.push(m);
        }
      }
    }
  }
  return {
    graph: { nodes: graph.nodes.filter((n) => kept.has(n.id)), edges: graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)) },
    hidden: graph.nodes.length - kept.size,
  };
}

/**
 * Which labels to draw so none overlap: `items` in priority order (the selected note, the one
 * under the pointer, the focus, notes found by a search, then the most connected), each the box its
 * label would take on screen (left, top, width; all `h` tall). A label is drawn when its box clears
 * every label already drawn. The rest show on hover, and as the map zooms in and they spread out.
 */
export function labelsToShow(
  items: readonly { id: string; x: number; y: number; w: number }[],
  h = 18,
  /** The marks themselves (centre and radius, by note): a label may not cover another note's mark. */
  marks: readonly { id: string; x: number; y: number; r: number }[] = [],
): Set<string> {
  const shown = new Set<string>();
  const boxes: { x: number; y: number; w: number }[] = [];
  for (const it of items) {
    if (boxes.some((b) => it.x < b.x + b.w && b.x < it.x + it.w && it.y < b.y + h && b.y < it.y + h)) continue;
    if (marks.some((m) => m.id !== it.id && m.x + m.r > it.x && m.x - m.r < it.x + it.w && m.y + m.r > it.y && m.y - m.r < it.y + h)) continue;
    boxes.push(it);
    shown.add(it.id);
  }
  return shown;
}

/** What the map's find and filters pick out: a note whose title has `find` (any case), with one of `marks`, in `project` (null: any). */
export interface MapFilter {
  find: string;
  marks: ReadonlySet<Mark>;
  project: string | null;
}
export const NO_FILTER: MapFilter = { find: "", marks: new Set<Mark>(["success", "failed", "unmarked"]), project: null };
export const isFiltering = (f: MapFilter) => f.find.trim() !== "" || f.marks.size < 3 || f.project !== null;
export function mapMatches(n: Pick<GraphNode, "title" | "mark" | "project_id">, f: MapFilter): boolean {
  const q = f.find.trim().toLowerCase();
  return (!q || n.title.toLowerCase().includes(q)) && f.marks.has(n.mark) && (f.project === null || n.project_id === f.project);
}

/** Hops from `focus` to every note within `depth`, over every edge, ignoring direction. */
function hopsFrom(graph: MapGraph, focus: string, depth: number): Map<string, number> {
  const hops = new Map<string, number>();
  if (!graph.nodes.some((n) => n.id === focus)) return hops;
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    (next.get(e.source) ?? next.set(e.source, []).get(e.source)!).push(e.target);
    (next.get(e.target) ?? next.set(e.target, []).get(e.target)!).push(e.source);
  }
  hops.set(focus, 0);
  let frontier = [focus];
  for (let d = 1; d <= clampDepth(depth) && frontier.length; d++) {
    const found: string[] = [];
    for (const id of frontier) {
      for (const m of next.get(id) ?? []) {
        if (!hops.has(m)) {
          hops.set(m, d);
          found.push(m);
        }
      }
    }
    frontier = found;
  }
  return hops;
}

/** The Around lens: the focus note's neighbourhood (degrees stay those of the whole map). */
export function aroundGraph(graph: MapGraph, focus: string, depth: number): MapGraph & { hops: Map<string, number> } {
  const hops = hopsFrom(graph, focus, depth);
  return {
    hops,
    nodes: graph.nodes.filter((n) => hops.has(n.id)),
    edges: graph.edges.filter((e) => hops.has(e.source) && hops.has(e.target)),
  };
}

const clampDepth = (d: number) => Math.min(DEPTH.max, Math.max(DEPTH.min, Math.trunc(d)));

/** The `depth` URL/nav value: a whole number clamped to 1–3; anything else gives 1. */
export function parseDepth(value: string | null | undefined): number {
  if (!value || !/^-?\d+$/.test(value)) return DEPTH.default;
  const n = Number(value);
  return n < DEPTH.min ? DEPTH.default : clampDepth(n);
}

/** Whether an edge gets an arrowhead: lineage always; links and sub-notes when close enough to read. */
export function showArrow(kind: EdgeKind, lens: Lens, zoom: number): boolean {
  return kind === "derived" || lens === "around" || zoom >= 1;
}

/** Where the map opens: Around a note (with a depth), or Everything. */
export function mapHref(focus?: string | null, depth: number = DEPTH.default): string {
  return focus ? `/map?focus=${encodeURIComponent(focus)}&depth=${clampDepth(depth)}` : "/map";
}

const LIST_GROUPS = ["Parent", "Sub-notes", "Links to", "Linked from", "Derived from", "Attempts from this", "Further away"] as const;
type ListGroup = (typeof LIST_GROUPS)[number];

/**
 * "Map as list" for the Around lens: the focus's neighbours by how they connect,
 * then everything further out. Items in note order; empty groups left out.
 */
export function aroundList(graph: MapGraph, focus: string, depth: number): { group: ListGroup; nodes: GraphNode[] }[] {
  const around = aroundGraph(graph, focus, depth);
  const groups = new Map<ListGroup, Set<string>>(LIST_GROUPS.map((g) => [g, new Set()]));
  const add = (g: ListGroup, id: string) => groups.get(g)!.add(id);
  for (const e of around.edges) {
    const out = e.source === focus;
    const inn = e.target === focus;
    if (!out && !inn) continue;
    const other = out ? e.target : e.source;
    if (e.kind === "parent") add(out ? "Sub-notes" : "Parent", other);
    else if (e.kind === "derived") add(out ? "Attempts from this" : "Derived from", other);
    else {
      if (out || e.mutual) add("Links to", other);
      if (inn || e.mutual) add("Linked from", other);
    }
  }
  for (const [id, h] of around.hops) if (h >= 2) add("Further away", id);
  return LIST_GROUPS.map((group) => ({ group, nodes: around.nodes.filter((n) => groups.get(group)!.has(n.id)) })).filter((g) => g.nodes.length > 0);
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
}

/**
 * Positions for every node (graph units, centred near 0,0). Deterministic for the same input.
 * With `focus`, the result is shifted so the focus sits at (0,0).
 */
export function layoutGraph(nodes: readonly { id: string }[], edges: readonly { source: string; target: string }[], focus?: string): PlacedNode[] {
  type N = SimulationNodeDatum & { id: string };
  const sim: N[] = nodes.map((n) => ({ id: n.id }));
  const simEdges = edges.map((e) => ({ source: e.source, target: e.target }));
  forceSimulation(sim)
    .force("link", forceLink<N, { source: string; target: string }>(simEdges).id((d) => d.id).distance(80))
    .force("charge", forceManyBody().strength(-220))
    .force("x", forceX().strength(0.06))
    .force("y", forceY().strength(0.06))
    .force("collide", forceCollide(30))
    .stop()
    .tick(300);
  const placed = sim.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 }));
  const f = focus ? placed.find((p) => p.id === focus) : undefined;
  return f ? placed.map((p) => ({ id: p.id, x: p.x - f.x, y: p.y - f.y })) : placed;
}

type Pt = { x: number; y: number };

/** An edge drawn between the rims of its two marks, not their centres, so arrowheads sit on the rim. */
export function edgeEnds(a: Pt, b: Pt, ra: number, rb: number): { from: Pt; to: Pt } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= ra + rb) return null;
  const ux = dx / len;
  const uy = dy / len;
  return { from: { x: a.x + ux * ra, y: a.y + uy * ra }, to: { x: b.x - ux * rb, y: b.y - uy * rb } };
}

/** An arrowhead triangle with its tip at `tip`, pointing away from `from`. */
export function arrowHead(from: Pt, tip: Pt, size = 7): [Pt, Pt, Pt] {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const w = size * 0.5;
  return [tip, { x: bx - uy * w, y: by + ux * w }, { x: bx + uy * w, y: by - ux * w }];
}

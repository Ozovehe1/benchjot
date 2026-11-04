// The note map: notes as nodes, links and parent -> child as edges.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { resolveLink, type SourcedLink } from "./links";
import type { TreeNode } from "./tree";

export type EdgeKind = "link" | "parent";

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

/**
 * Edges between existing notes: one per parent -> child, and one per linked
 * pair (in either direction, duplicates and self-links dropped). A pair that is
 * both parent/child and linked keeps only the parent edge.
 */
export function buildEdges(nodes: readonly TreeNode[], links: readonly SourcedLink[]): GraphEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  const pair = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    if (n.parent_id && ids.has(n.parent_id)) {
      seen.add(pair(n.parent_id, n.id));
      edges.push({ source: n.parent_id, target: n.id, kind: "parent" });
    }
  }
  for (const l of links) {
    const target = resolveLink(l, nodes)?.id;
    if (!target || target === l.source || !ids.has(l.source)) continue;
    const key = pair(l.source, target);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: l.source, target, kind: "link" });
  }
  return edges;
}

export interface PlacedNode {
  id: string;
  title: string;
  x: number;
  y: number;
}

/** Positions for every node (graph units, centred near 0,0). Deterministic for the same input. */
export function layoutGraph(nodes: readonly TreeNode[], edges: readonly GraphEdge[]): PlacedNode[] {
  type N = SimulationNodeDatum & { id: string; title: string };
  const sim: N[] = nodes.map((n) => ({ id: n.id, title: n.title }));
  const simEdges = edges.map((e) => ({ source: e.source, target: e.target }));
  forceSimulation(sim)
    .force("link", forceLink<N, { source: string; target: string }>(simEdges).id((d) => d.id).distance(80))
    .force("charge", forceManyBody().strength(-220))
    .force("x", forceX().strength(0.06))
    .force("y", forceY().strength(0.06))
    .force("collide", forceCollide(30))
    .stop()
    .tick(300);
  return sim.map((n) => ({ id: n.id, title: n.title, x: n.x ?? 0, y: n.y ?? 0 }));
}

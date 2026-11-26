// Lays the research map out off the page's thread (graph.ts's layoutGraph), so a big map never
// freezes scrolling or typing. Message in: { nodes, edges, focus }; out: the placed nodes.
import { layoutGraph } from "./graph";

self.onmessage = (e: MessageEvent<{ nodes: { id: string }[]; edges: { source: string; target: string }[]; focus?: string }>) => {
  const { nodes, edges, focus } = e.data;
  self.postMessage(layoutGraph(nodes, edges, focus));
};

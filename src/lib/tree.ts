// Note nesting: each note has at most one parent note (entries.parent_id).
// The database refuses cycles (entries_parent_no_cycle); these helpers keep
// the UI from offering one and walk the tree for breadcrumbs and sub-notes.

export interface TreeNode {
  id: string;
  title: string;
  parent_id: string | null;
}

/** Ancestors of a note, root first (excludes the note). Stops at a missing parent or a cycle. */
export function ancestors<T extends TreeNode>(id: string, nodes: readonly T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: T[] = [];
  const seen = new Set([id]);
  let next = byId.get(id)?.parent_id ?? null;
  while (next && !seen.has(next)) {
    const node = byId.get(next);
    if (!node) break;
    seen.add(next);
    out.unshift(node);
    next = node.parent_id;
  }
  return out;
}

/** Direct sub-notes of a note, in the given order. */
export function childrenOf<T extends TreeNode>(id: string, nodes: readonly T[]): T[] {
  return nodes.filter((n) => n.parent_id === id);
}

/** Every note below `id` (sub-notes, their sub-notes, ...). */
export function descendantIds(id: string, nodes: readonly TreeNode[]): Set<string> {
  const kids = new Map<string, string[]>();
  for (const n of nodes) if (n.parent_id) kids.set(n.parent_id, [...(kids.get(n.parent_id) ?? []), n.id]);
  const out = new Set<string>();
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (out.has(next) || next === id) continue;
    out.add(next);
    stack.push(...(kids.get(next) ?? []));
  }
  return out;
}

/** True if putting `childId` under `parentId` would make a cycle (including a note under itself). */
export function wouldCycle(childId: string, parentId: string | null, nodes: readonly TreeNode[]): boolean {
  if (!parentId) return false;
  return parentId === childId || descendantIds(childId, nodes).has(parentId);
}

/** Notes that can be the parent of `id`: everything except itself and its descendants. */
export function parentCandidates<T extends TreeNode>(id: string, nodes: readonly T[]): T[] {
  const below = descendantIds(id, nodes);
  return nodes.filter((n) => n.id !== id && !below.has(n.id));
}

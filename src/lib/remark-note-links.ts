// Remark plugin: turns [[...]] note links in text into link nodes.
// Text inside code (inline or fenced) is never a text node, so links there stay literal.
// A resolved link points at /n/<id> and shows the note's current title;
// a missing one is marked data-note="missing" and shows its label.
import { parseLinks, resolveLink, type NoteRef } from "./links";
import { displayTitle } from "./format";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  data?: { hProperties?: Record<string, string> };
}

function linkNode(label: string, target: NoteRef | null): MdNode {
  return {
    type: "link",
    url: target ? `/n/${target.id}` : "",
    data: { hProperties: { "data-note": target ? target.id : "missing" } },
    children: [{ type: "text", value: target ? displayTitle(target.title) : label }],
  };
}

function transform(node: MdNode, notes: readonly NoteRef[]) {
  if (!node.children || node.type === "link" || node.type === "linkReference") return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text" || !child.value?.includes("[[")) {
      transform(child, notes);
      return [child];
    }
    return parseLinks(child.value).map((s) => (s.kind === "text" ? { type: "text", value: s.text } : linkNode(s.label, resolveLink(s, notes))));
  });
}

export function remarkNoteLinks(options: { notes: readonly NoteRef[] }) {
  return (tree: MdNode) => transform(tree, options.notes);
}

import type { Metadata } from "next";
import { NoteMap } from "@/components/note-map";
import { parseDepth } from "@/lib/graph";

export const metadata: Metadata = { title: "Map" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * /map                       Everything: every note.
 * /map?focus=<id>&depth=1..3 Around: that note's neighbourhood (how a note opens the map).
 * /map?focus=<id>&lens=all   Everything, keeping the way back to Around.
 * &view=list                 Map as list: the same map as 48px rows, for keyboard and screen readers.
 */
export default async function MapPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const focus = one(p.focus);
  return (
    <NoteMap
      focus={focus}
      depth={parseDepth(one(p.depth))}
      lens={focus && one(p.lens) !== "all" ? "around" : "everything"}
      asList={one(p.view) === "list"}
    />
  );
}

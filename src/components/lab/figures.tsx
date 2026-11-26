"use client";
// Figures: every visual from every experiment in one place (the lab's results wall), newest first.
// Filter by kind or by words (a title, a note, what the Assistant saw in it); each opens at its cell.
import { useDeferredValue, useMemo, useState } from "react";
import { FigureCard } from "./figure-card";
import { useFigures } from "@/lib/data/figures";
import { useNoteIndex, useProjects } from "@/lib/data";
import type { FigureKind } from "@/lib/run/figures";
import { displayTitle, listDate } from "@/lib/ui/format";
import { Column, IconSearch, Notice, Segmented, TopBar, TextLink, Working } from "../ui";

const KINDS: { value: FigureKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "figure", label: "Plots" },
  { value: "chart", label: "Charts" },
  { value: "animation", label: "Animations" },
  { value: "image", label: "Images" },
];

export function Figures() {
  const { data, error, mutate } = useFigures();
  const { data: index } = useNoteIndex();
  const { data: projects } = useProjects();
  const [kind, setKind] = useState<FigureKind | "all">("all");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const notes = useMemo(() => new Map((index ?? []).map((n) => [n.id, n])), [index]);
  const projectName = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);
  // Only notes that are still there (not in Recently deleted).
  const shown = (data?.figures ?? []).filter((f) => notes.has(f.noteId) && (kind === "all" || f.kind === kind) && (!q || [f.title, f.seen ?? "", notes.get(f.noteId)?.title ?? ""].join(" ").toLowerCase().includes(q)));

  return (
    <Column className="pb-20 xl:max-w-[1120px]">
      <TopBar left={<TextLink href="/">All notes</TextLink>} />
      <header className="mt-2 lg:mt-8">
        <h1 className="text-[34px] font-normal leading-none tracking-[-0.02em] lg:text-[40px]">Figures</h1>
        <p className="mt-2.5 text-sm text-muted">
          {data ? `${shown.length} ${shown.length === 1 ? "visual" : "visuals"} from your experiments' latest runs` : "Every plot, chart and animation your runs made"}
        </p>
      </header>
      <div className="mt-7 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block flex-1">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, notes, what's in them" aria-label="Search figures" className="h-12 w-full rounded-xl border border-line bg-tint/40 pl-10 pr-4 outline-none placeholder:text-faint focus:border-faint focus:bg-transparent" />
        </label>
        <Segmented label="Kind" options={KINDS} value={kind} onChange={setKind} />
      </div>
      {error && <Notice className="mt-4" actions={[{ label: "Try again", onClick: () => void mutate() }]}>Couldn’t load your figures. Check your connection.</Notice>}
      {!data && !error && <Working label="Loading…" className="mt-8" />}
      {data && shown.length === 0 && (
        <p className="mt-10 text-sm text-muted">{data.figures.length ? "Nothing matches." : "No figures yet. Run a cell that plots something, and it appears here."}</p>
      )}
      <ul className="mt-8 grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((f) => {
          const note = notes.get(f.noteId);
          const url = data?.urls[f.path];
          return (
            <li key={f.key}>
              <FigureCard
                href={`/n/${f.noteId}#cell-${f.cellId}`}
                src={url}
                alt={f.seen ?? f.title ?? "Figure"}
                title={f.title || (f.kind === "animation" ? "Animation" : "Figure")}
                sub={`${displayTitle(note?.title ?? "")}${note?.project_id && projectName.get(note.project_id) ? ` · ${projectName.get(note.project_id)}` : ""}${f.ranAt ? ` · ${listDate(f.ranAt)}` : ""}`}
              />
            </li>
          );
        })}
      </ul>
    </Column>
  );
}

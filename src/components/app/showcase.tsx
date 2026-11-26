"use client";
// The landing's product showcase, drawn with the app's own components, so it looks exactly like the
// app: the sidebar (SidebarBody), the note (its title, body, cell frame, code, run output and Runs
// table), the Assistant panel (its message, plan, activity, working line, answer, composer and model),
// Find datasets' rows, Figures' cards and the Research map's marks. The hero lays the desktop app out
// at its real size and scales it to fit. Code, numbers, figures and dataset results are real (the
// sample run, lib/sample-note.ts; public dataset searches); the Assistant's request and plan are an
// illustration, and the page says so. Plays once on screen; reduced motion shows it finished.
import { useEffect, useRef, useState } from "react";
import type { AgentAction } from "@/lib/ai/agent";
import type { Chunk } from "@/lib/run/last-run";
import { cn } from "@/lib/ui/format";
import { SidebarBody } from "./sidebar-body";
import { ActivityList, Composer, Finished, IconAction, ModelTrigger, PlanList, UserMessage, WorkingLine } from "../notes/assistant-parts";
import { CELL_FRAME, NOTE_META_ROW_CLASS, NOTE_TITLE_CLASS, RenderedBody } from "../notes/note-parts";
import { RunsView } from "../notes/runs-view";
import { CellHeader } from "../code/cell-header";
import { RunOutput } from "../outputs/run-output";
import { DatasetRow, PlatformChip } from "../lab/dataset-results";
import { FigureCard } from "../lab/figure-card";
import { EDGE_STYLE, NodeMark } from "../map/map-marks";
import { Column, FIELD, IconSearch, IconX } from "../ui";

/** Whether to show everything finished: reduced motion (and before hydration). */
function useStill(): boolean {
  const [still, setStill] = useState(true);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setStill(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);
  return still;
}

/** True once the element has been on screen. */
function useSeen<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

/** 0 … last, one beat each `ms`, holding `hold` beats at the end, then again; `last` when still. */
function useBeats(last: number, ms: number, run: boolean, still: boolean, hold = 5): number {
  const [beat, setBeat] = useState(last);
  useEffect(() => {
    if (still || !run) {
      setBeat(last);
      return;
    }
    let b = 0;
    setBeat(0);
    const t = setInterval(() => {
      b = b >= last + hold ? 0 : b + 1;
      setBeat(Math.min(b, last));
    }, ms);
    return () => clearInterval(t);
  }, [last, ms, run, still, hold]);
  return beat;
}

/** A desktop-sized layout drawn at its real size and scaled down to the width it has. */
function Scaled({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.8);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setK(Math.min(1, e.contentRect.width / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} style={{ height: height * k }} className="relative w-full overflow-hidden">
      <div style={{ width, height, transform: `scale(${k})`, transformOrigin: "top left" }} className="absolute left-0 top-0">
        {children}
      </div>
    </div>
  );
}

/** A run as the Runs view takes it. */
type ExperimentRun = React.ComponentProps<typeof RunsView>["runs"][number];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const noop = () => {};

export type ShowcaseNote = {
  title: string;
  body: string;
  result: string;
  filename: string;
  code: React.ReactNode;
  progress: readonly string[];
  ms: number;
  runs: readonly ExperimentRun[];
};

const PLAN = ["Write the experiment as a cell", "Run it on the server, 10 seeds", "Log each network's test accuracy", "Write what happened in the note"];
const REQUEST = "Does a 4-layer net beat a 2-layer one on the spirals? 10 seeds, and log test accuracy.";

/**
 * The hero: the app as it is while the Assistant works in a note. Beats: 0 reading, 1 planned,
 * 2 writing the cell, 3 starting the server, 4-7 running (its progress lines), 8 saving, 9 ran,
 * 10 writing in the note, 11 answered.
 */
export function AppShot({ note, answer }: { note: ShowcaseNote; answer: string }) {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const b = useBeats(11, 1150, seen, still);
  const secsRun = Math.round(note.ms / 1000);
  const ranFor = b >= 9 ? secsRun : b >= 4 ? Math.round((secsRun * (b - 3)) / 5) : 0;
  const lines = b >= 8 ? note.progress.length : b >= 4 ? Math.ceil((note.progress.length * (b - 3)) / 5) : 0;

  const actions: AgentAction[] = [];
  if (b >= 3) actions.push({ text: "Added cell 1 · Python", tone: "plain" });
  if (b >= 9) actions.push({ text: `Ran cell 1 on the server · ${(note.ms / 1000).toFixed(1)} s`, tone: "ok" });
  if (b >= 11) actions.push({ text: "Wrote in the note at the end", tone: "plain" });
  const done = b >= 11 ? 4 : b >= 10 ? 3 : b >= 9 ? 2 : b >= 3 ? 1 : 0;
  const doing = b === 0 ? "Reading the note…" : b === 1 ? "Thinking…" : b === 2 ? "Writing a Python cell…" : b <= 8 ? "Running cell 1…" : b === 9 ? "Thinking…" : "Writing in the note…";
  const runStatus = b === 3 ? "Starting server · 0:12" : b === 8 ? "Saving results…" : `Running · ${clock(ranFor)} · ${note.progress[Math.max(0, lines - 1)] ?? ""}`;
  const chunks: Chunk[] = lines ? [{ stream: "stdout", text: note.progress.slice(0, lines).join("\n") + "\n" }] : [];
  const running = b >= 3 && b <= 8;
  // How long it has worked: a few seconds a step, plus the run itself while it runs (the app's own clock).
  const worked = (b <= 3 ? 4 + b * 6 : 22 + ranFor) + (b >= 10 ? (b - 9) * 9 : 0);
  const body = b >= 10 ? `${note.body}\n\n${note.result}` : note.body;

  const assistant = (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex min-h-14 shrink-0 items-center gap-1 px-4">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">Assistant</h2>
        <IconAction label="Close" onClick={noop}>
          <IconX className="size-[18px]" />
        </IconAction>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-4">
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <UserMessage text={REQUEST} voice={false} />
            {b < 11 ? (
              <div className="space-y-3">
                {b >= 1 && <PlanList plan={{ steps: PLAN, done }} working />}
                {b < 1 && (
                  <div aria-hidden className="space-y-2 pt-0.5">
                    <div className="skeleton h-3 w-[92%] rounded" />
                    <div className="skeleton h-3 w-[78%] rounded" />
                    <div className="skeleton h-3 w-[54%] rounded" />
                  </div>
                )}
                <ActivityList actions={actions} onGoToCell={noop} />
                <WorkingLine doing={doing} secs={worked} />
              </div>
            ) : (
              <Finished secs={worked} narration={[]} actions={actions} plan={{ steps: PLAN, done: 4 }} answer={answer} canUndo onUndo={noop} onDelete={noop} onGoToCell={noop} />
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-4 pb-3 pt-2">
        <Composer field={{ current: null }} value="" listening={null} onChange={noop} onSend={noop} working={b < 11} onStop={noop} mic={null} />
        <div className="flex items-center justify-center gap-1.5 px-2 pt-2 text-xs text-faint">
          <ModelTrigger name="Sonnet" open={false} onClick={noop} />
        </div>
      </div>
    </div>
  );

  return (
    <div ref={ref} inert className="relative select-none">
      <div aria-hidden className="pointer-events-none absolute -inset-x-10 -top-24 h-[420px] bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklab,var(--fg)_9%,transparent),transparent)]" />
      {/* Wide screens: the desktop app, sidebar, note and Assistant side by side. */}
      <div className="relative hidden overflow-hidden rounded-[18px] border border-line shadow-float md:block">
        <Scaled width={1440} height={860}>
          <div className="relative h-full w-full bg-bg">
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-shell px-3">
              <SidebarBody path="/" projects={[{ id: "p", name: "Depth vs width" }]} projectId="p" username="you" onNewNote={noop} />
            </aside>
            <main className="absolute inset-y-0 left-64 right-[480px] overflow-hidden">
              <div className="transition-transform duration-700 ease-out" style={{ transform: `translateY(-${b >= 10 ? 520 : b >= 4 ? 360 : b >= 2 ? 120 : 0}px)` }}>
                <Column className="pb-24">
                  <h1 className={NOTE_TITLE_CLASS}>{note.title}</h1>
                  <div className={NOTE_META_ROW_CLASS}>
                    <span>Outcome</span>
                    {/* Only the user marks the outcome; the Assistant never does. */}
                    <span className="inline-flex min-h-12 items-center text-fg">Not marked</span>
                  </div>
                  <RenderedBody value={body} reserve={false} />
                  {b >= 2 && (
                    <div className={cn(CELL_FRAME, "relative")}>
                      {/* The cell's edge, as cell-block draws it: pulsing in the run colour while it runs, green once it ran. */}
                      {b >= 3 && <span aria-hidden className={cn("absolute bottom-5 left-0 top-5 w-[3px] rounded-r-full", running ? "animate-pulse bg-run" : "bg-ok/70")} />}
                      <CellHeader filename={note.filename} language={<span className="-ml-1 px-1">Python</span>} />
                      <div className="max-h-[220px] overflow-hidden">{note.code}</div>
                      {b >= 3 && <RunOutput chunks={chunks} status={running ? runStatus : ""} running={running} result={b >= 9 ? { outcome: "ok", error: null, ms: note.ms } : null} />}
                    </div>
                  )}
                  {b >= 9 && <RunsView runs={note.runs} cells={[{ id: "c1", filename: note.filename, content: "", language: "python" }]} />}
                </Column>
              </div>
            </main>
            <div className="absolute inset-y-0 right-0 w-[480px] border-l border-line">{assistant}</div>
          </div>
        </Scaled>
      </div>
      {/* Phones: the Assistant as the phone shows it, a sheet over the note. */}
      <div className="relative h-[620px] overflow-hidden rounded-t-3xl border border-b-0 border-line md:hidden">
        <div className="flex h-6 items-center justify-center">
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="h-[calc(100%-24px)]">{assistant}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- tiles

export function Tile({ title, text, className, children }: { title: string; text: string; className?: string; children: React.ReactNode }) {
  return (
    <article className={cn("flex flex-col overflow-hidden rounded-3xl border border-line bg-raise", className)}>
      <div className="px-6 pt-6 sm:px-7 sm:pt-7">
        <h3 className="text-[17px] font-medium text-fg">{title}</h3>
        <p className="mt-1.5 max-w-[34rem] text-[14.5px] leading-relaxed text-muted">{text}</p>
      </div>
      <div inert className="mt-6 flex-1 select-none px-6 pb-6 sm:px-7 sm:pb-7">
        {children}
      </div>
    </article>
  );
}

/** Experiment tracking: the note's Runs view itself. */
export function RunsTile({ runs }: { runs: readonly ExperimentRun[] }) {
  return <RunsView runs={runs} cells={[{ id: "c1", filename: "balls.py", content: "", language: "python" }]} className="" />;
}

export type FoundRow = { title: string; platform: string; detail?: string };

/** Find datasets, as the Data page shows it: the query, the platform chips, the rows. */
export function DataTile({ query, rows }: { query: string; rows: readonly FoundRow[] }) {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const b = useBeats(rows.length + query.length, 260, seen, still, 14);
  const typed = query.slice(0, Math.min(query.length, b));
  const shown = Math.max(0, b - query.length);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.platform, (counts.get(r.platform) ?? 0) + 1);
  return (
    <div ref={ref}>
      <label className="relative block">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input type="search" readOnly value={typed} aria-label="Search datasets" className={`${FIELD} pl-10`} />
      </label>
      <div className={cn("mt-4 flex gap-1.5 overflow-x-auto pb-1 transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")}>
        <PlatformChip label="All" count={rows.length} on />
        {[...counts].map(([p, n]) => (
          <PlatformChip key={p} label={p} count={n} on={false} />
        ))}
      </div>
      <ul className="card mt-3 divide-y divide-line overflow-hidden">
        {rows.map((r, i) => (
          <li key={r.title + r.platform} className={cn("transition-opacity duration-300", i < shown ? "opacity-100" : "opacity-0")}>
            <DatasetRow title={r.title} platform={r.platform} detail={r.detail} open={false} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export type FigureTileItem = { src: string; title: string; sub: string };

/** Figures, as the Figures page shows them. */
export function FiguresTile({ items }: { items: readonly FigureTileItem[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-3">
      {items.map((f) => (
        <li key={f.src}>
          <FigureCard href="/example" src={f.src} alt={f.title} title={f.title} sub={f.sub} />
        </li>
      ))}
    </ul>
  );
}

const MAP_NODES = [
  { x: 70, y: 70, title: "Baseline: 2 layers", mark: "success" },
  { x: 230, y: 40, title: "4 layers, same width", mark: "failed" },
  { x: 230, y: 150, title: "Same weights", mark: "success" },
  { x: 390, y: 95, title: "Attempt 2", mark: "success" },
  { x: 390, y: 190, title: "Data shift", mark: "unmarked" },
] as const;
const MAP_EDGES = [
  { a: 0, z: 1, kind: "derived" },
  { a: 0, z: 2, kind: "derived" },
  { a: 1, z: 3, kind: "link" },
  { a: 2, z: 3, kind: "link" },
  { a: 2, z: 4, kind: "parent" },
] as const;

/** The Research map's marks and lines, as the map draws them (an illustration of a line of work). */
export function MapTile() {
  return (
    <svg viewBox="0 0 520 230" className="h-auto w-full" role="img" aria-label="Five notes: attempts, links and a sub-note">
      {MAP_EDGES.map((e, i) => {
        const s = EDGE_STYLE[e.kind];
        const a = MAP_NODES[e.a];
        const z = MAP_NODES[e.z];
        return <line key={i} x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} />;
      })}
      {MAP_NODES.map((n) => (
        <g key={n.title} transform={`translate(${n.x},${n.y})`}>
          <NodeMark mark={n.mark} r={7} />
          <text x={14} y={4} fontSize={12.5} fill="var(--fg)" stroke="var(--raise)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">
            {n.title}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Where code runs, and a cell's own run line as it reads during a server run. */
export function RunTile({ progress }: { progress: readonly string[] }) {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const b = useBeats(40, 300, seen, still, 6);
  const line = progress[Math.min(progress.length - 1, Math.floor(b / 7))] ?? "";
  return (
    <div ref={ref} className="space-y-3">
      {[
        ["Your browser", "Python and R. Free, nothing to install."],
        ["Server", "Julia, MATLAB, C++, Fortran, and Python with PyTorch or TensorFlow. Keeps going after you close the tab."],
        ["Server GPU", "Chosen when the code needs one. 10 runs a day, up to an hour each."],
      ].map(([w, t]) => (
        <div key={w} className="border-t border-line pt-3">
          <p className="text-[14px] text-fg">{w}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{t}</p>
        </div>
      ))}
      <div className="card px-4 pb-2 pt-1">
        <RunOutput chunks={[]} status={`Running · ${clock(b * 2)} · ${line}`} running={!still} result={still ? { outcome: "ok", error: null, ms: 81_000 } : null} />
      </div>
    </div>
  );
}

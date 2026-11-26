"use client";
// The landing's product showcase. The hero is the whole app at work (sidebar, the note, the Assistant
// panel): the Assistant's plan ticks, its actions land, the run's numbers fill the note's Runs table.
// Below it, "What's new": one tile per part of the product, each with its own small live interface.
// Numbers, figures and dataset results are real (the sample run, lib/sample-note.ts; public dataset
// searches); the Assistant's conversation and the map's notes are illustrations and say so.
// Animations play once a part is on screen; with reduced motion everything shows finished.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/format";
import { IconCheck } from "../ui";

/** Whether the visitor asked for less motion (true until known, so the server renders the finished state). */
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
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

/** A beat counter: 0, 1, … `last`, one beat each `ms`, holding at `last` for `hold` beats, then again. Stays at `last` when still. */
function useBeats(last: number, ms: number, run: boolean, still: boolean, hold = 4): number {
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

export type ShowcaseRun = { network: string; lr: string; test: string; outer: string };

// ---------------------------------------------------------------------------------------------- hero

const PLAN = ["Write the experiment as a cell", "Run it on the server, 10 seeds", "Log each network's accuracy", "Write what happened in the note"];

export function AppShot({ title, runs, conclusion, code }: { title: string; runs: readonly ShowcaseRun[]; conclusion: string; code: React.ReactNode }) {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const b = useBeats(9, 1100, seen, still);
  // Beats: 1 plan, 2-3 cell written, 4 running, 5 ran, 6-7 runs logged, 8 written, 9 answer.
  const done = b >= 9 ? 4 : b >= 8 ? 3 : b >= 6 ? 2 : b >= 4 ? 1 : 0;
  const rows = b >= 7 ? runs.length : b >= 6 ? 1 : 0;
  return (
    <div ref={ref} className="relative">
      <div aria-hidden className="pointer-events-none absolute -inset-x-10 -top-24 h-[420px] bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklab,var(--fg)_9%,transparent),transparent)]" />
      <figure aria-label="Benchjot with the Assistant at work" className="relative overflow-hidden rounded-[20px] border border-line bg-bg shadow-float ring-1 ring-fg/[0.04]">
        <div className="flex h-11 items-center gap-2 border-b border-line px-4">
          <span className="size-2.5 rounded-full bg-tint" />
          <span className="size-2.5 rounded-full bg-tint" />
          <span className="size-2.5 rounded-full bg-tint" />
          <span className="ml-3 truncate font-mono text-[11px] text-faint">benchjot.vercel.app</span>
        </div>
        <div className="grid h-[560px] grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[200px_minmax(0,1fr)_360px]">
          {/* Sidebar */}
          <aside aria-hidden className="hidden flex-col bg-shell px-3 py-4 lg:flex">
            <p className="px-2 font-mono text-[12px] text-fg">benchjot</p>
            <ul className="mt-4 space-y-0.5 text-[12.5px] text-muted">
              {["All notes", "Figures", "Data", "Research map"].map((n, i) => (
                <li key={n} className={cn("rounded-lg px-2 py-1.5", i === 0 && "bg-tint text-fg")}>{n}</li>
              ))}
            </ul>
            <p className="eyebrow mt-6 px-2">Notes</p>
            <p className="mt-2 truncate rounded-lg bg-tint/60 px-2 py-1.5 text-[12.5px] text-fg">{title}</p>
          </aside>

          {/* The note */}
          <div aria-hidden className="hidden min-w-0 overflow-hidden border-line px-7 py-6 md:block md:border-r">
            <p className="font-display text-[24px] leading-tight tracking-[-0.01em]">{title}</p>
            <div className={cn("mt-5 transition-all duration-500", b >= 2 ? "opacity-100" : "translate-y-2 opacity-0")}>
              <div className="flex items-center justify-between font-mono text-[11px] text-muted">
                <span>Cell 1 · balls.py · Python</span>
                <span className={cn("rounded-md px-2 py-0.5", b === 4 ? "bg-run/15 text-run" : b >= 5 ? "text-ok" : "bg-tint text-fg")}>{b === 4 ? "Running" : b >= 5 ? "Ran · 7:16" : "Run"}</span>
              </div>
              <div className="relative mt-2 max-h-[118px] overflow-hidden rounded-xl bg-raise [&_pre]:!text-[11.5px]">
                {code}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-raise to-transparent" />
              </div>
            </div>
            <div className={cn("mt-5 transition-all duration-500", b >= 6 ? "opacity-100" : "translate-y-2 opacity-0")}>
              <p className="eyebrow">Runs · spirals</p>
              <table className="mt-2 w-full text-left text-[12px] tabular-nums">
                <thead className="text-faint">
                  <tr><th className="py-1.5 font-normal">network</th><th className="py-1.5 text-right font-normal">lr</th><th className="py-1.5 text-right font-normal">test</th><th className="py-1.5 text-right font-normal">outer arm</th></tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={r.network} className={cn("border-t border-line transition-opacity duration-300", i < rows ? "opacity-100" : "opacity-0")}>
                      <td className="py-1.5 text-fg">{r.network}</td>
                      <td className="py-1.5 text-right text-muted">{r.lr}</td>
                      <td className="py-1.5 text-right text-fg">{r.test}</td>
                      <td className="py-1.5 text-right text-muted">{r.outer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={cn("mt-5 transition-all duration-500", b >= 8 ? "opacity-100" : "translate-y-2 opacity-0")}>
              <p className="eyebrow">Result</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg/90">{conclusion}</p>
            </div>
          </div>

          {/* The Assistant */}
          <div className="flex min-w-0 flex-col bg-raise/60">
            <div className="flex h-11 items-center justify-between border-b border-line px-4 text-[13px]">
              <span className="text-fg">Assistant</span>
              <span className="text-[11px] text-faint">Illustration</span>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-4">
              <p className="ml-6 rounded-2xl rounded-br-md bg-tint px-3.5 py-2.5 text-[13px] leading-relaxed text-fg">
                Does a 4-layer net beat a 2-layer one on the spirals? 10 seeds, and log test accuracy.
              </p>
              {/* The plan exactly as the app draws it (assistant-panel PlanList): finished ✓, the current step breathing, the rest waiting. */}
              <ol aria-label="Plan" className={cn("space-y-1 transition-opacity duration-500", b >= 1 ? "opacity-100" : "opacity-0")}>
                {PLAN.map((p, i) => {
                  const isDone = i < done;
                  const now = i === done && b < 9 && !still;
                  return (
                    <li key={p} className="flex items-start gap-2.5 text-[13px]">
                      <span aria-hidden className="mt-[3px] flex size-4 shrink-0 items-center justify-center">
                        {isDone ? <IconCheck className="size-3.5 text-ok" /> : now ? <span className="breathe size-2.5 rounded-full bg-fg" /> : <span className="size-3 rounded-full border border-faint" />}
                      </span>
                      <span className={cn("leading-relaxed", now ? "shimmer-text" : "text-muted")}>{p}</span>
                    </li>
                  );
                })}
              </ol>
              <ul className="space-y-1 font-mono text-[11px] text-faint">
                {[
                  [2, "Added cell 1 · Python"],
                  [5, "Ran cell 1 on the server · 7:16"],
                  [8, "Wrote in the note under “Result”"],
                ].map(([at, text]) => (
                  <li key={text as string} className={cn("transition-opacity duration-300", b >= (at as number) ? "opacity-100" : "opacity-0")}>· {text}</li>
                ))}
              </ul>
              <p className={cn("text-[13px] leading-relaxed text-fg/90 transition-opacity duration-500", b >= 9 ? "opacity-100" : "opacity-0")}>
                On the spirals, 4 layers beat the small 2-layer net ({runs[1]?.test} vs {runs[0]?.test}), but a 2-layer net with the same number of weights nearly ties ({runs[2]?.test}). None of them extrapolates to the outer arm.
              </p>
            </div>
            <div className="border-t border-line p-3">
              <div className="rounded-xl border border-line bg-bg px-3 py-2.5 text-[12.5px] text-faint">Ask, or tell it what to do…</div>
              <p className="mt-2 px-1 text-[11px] text-faint">Sonnet ▾</p>
            </div>
          </div>
        </div>
      </figure>
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
      <div className="mt-6 flex-1 px-6 pb-6 sm:px-7 sm:pb-7">{children}</div>
    </article>
  );
}

/** Experiment tracking: each network's test accuracy as bars that grow in. */
export function RunsChart({ runs }: { runs: readonly ShowcaseRun[] }) {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const on = still || seen;
  return (
    <div ref={ref} className="rounded-2xl border border-line bg-bg p-5">
      <p className="font-mono text-[12px] text-muted">log(network=name, lr=lr, test=acc)</p>
      <div className="mt-5 space-y-3">
        {runs.map((r, i) => {
          const v = Number.parseFloat(r.test);
          return (
            <div key={r.network} className="grid grid-cols-[9.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-[12.5px]">
              <span className="truncate text-muted">{r.network}</span>
              <span className="h-2 overflow-hidden rounded-full bg-tint">
                <span className="block h-full origin-left rounded-full bg-fg/80 transition-transform duration-1000 ease-out" style={{ transform: `scaleX(${on ? (v - 0.8) / 0.2 : 0})`, transitionDelay: `${i * 180}ms` }} />
              </span>
              <span className="text-right tabular-nums text-fg">{r.test}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11.5px] text-faint">Test accuracy on the spirals, mean of 10 seeds, axis from 0.8. From the sample run.</p>
    </div>
  );
}

const FOUND = [
  { ref: "hf:scikit-learn/iris", title: "scikit-learn/iris", where: "Hugging Face" },
  { ref: "openml:61", title: "iris", where: "OpenML" },
  { ref: "zenodo:1404173", title: "Scikit-Learn IRIS", where: "Zenodo" },
  { ref: "dataverse:R2RGXR", title: "Iris dataset for machine learning", where: "Harvard Dataverse" },
];

/** The Data library's search: the query types itself, then real results from the platforms arrive. */
export function DataSearch() {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const b = useBeats(8, 320, seen, still, 14);
  const q = "iris";
  return (
    <div ref={ref} className="rounded-2xl border border-line bg-bg p-4">
      <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-[13px]">
        <svg viewBox="0 0 16 16" className="size-3.5 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
        <span className="text-fg">{q.slice(0, Math.min(q.length, b))}</span>
        {b < q.length && !still && <span className="h-4 w-px bg-fg [animation:film-caret_1s_steps(1)_infinite]" />}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {FOUND.map((f, i) => (
          <li key={f.ref} className={cn("flex items-center justify-between gap-3 py-2.5 transition-all duration-300", b >= 5 + i * 0.75 ? "opacity-100" : "translate-y-1 opacity-0")}>
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-fg">{f.title}</span>
              <span className="block truncate font-mono text-[11px] text-faint">{f.ref}</span>
            </span>
            <span className="shrink-0 rounded-full bg-tint px-2.5 py-0.5 text-[11.5px] text-muted">{f.where}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-faint">Real results for “iris”, also searched on figshare.</p>
    </div>
  );
}

/** Where code runs, with a run's status line ticking on the GPU. */
export function RunAnywhere() {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLUListElement>();
  const b = useBeats(42, 250, seen, still, 8);
  const rows = [
    { where: "Your browser", what: "Python and R. Free, nothing to install.", on: false },
    { where: "Server", what: "Julia, MATLAB, C++, Fortran, and Python with PyTorch or TensorFlow.", on: false },
    { where: "Server GPU", what: "Chosen when the code needs one. 10 runs a day, up to an hour each.", on: true },
  ];
  return (
    <ul ref={ref} className="space-y-2">
      {rows.map((r) => (
        <li key={r.where} className={cn("rounded-2xl border px-4 py-3", r.on ? "border-run/40 bg-run/[0.06]" : "border-line bg-bg")}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13.5px] text-fg">{r.where}</span>
            {r.on && (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-run">
                <span className={cn("size-1.5 rounded-full bg-run", !still && "breathe")} />
                Running · 0:{String(b).padStart(2, "0")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{r.what}</p>
        </li>
      ))}
    </ul>
  );
}

const MAP_NODES = [
  { x: 60, y: 70, label: "Baseline", state: "ok" },
  { x: 190, y: 40, label: "Deeper net", state: "fail" },
  { x: 200, y: 130, label: "Same weights", state: "ok" },
  { x: 320, y: 70, label: "Attempt 2", state: "ok" },
  { x: 330, y: 160, label: "Data shift", state: "none" },
] as const;
const MAP_EDGES = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4]] as const;

/** The Research map: notes and how they connect (an illustration of its look). */
export function MapSketch() {
  const still = useStill();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const on = still || seen;
  return (
    <div ref={ref} className="rounded-2xl border border-line bg-bg p-3">
      <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label="Five notes linked as attempts and sub-notes">
        {MAP_EDGES.map(([a, z], i) => (
          <line key={i} x1={MAP_NODES[a].x} y1={MAP_NODES[a].y} x2={MAP_NODES[z].x} y2={MAP_NODES[z].y} stroke="var(--line)" strokeWidth="1.5" strokeDasharray="200" strokeDashoffset={on ? 0 : 200} style={{ transition: `stroke-dashoffset 900ms ease ${i * 150}ms` }} />
        ))}
        {MAP_NODES.map((n, i) => (
          <g key={n.label} style={{ opacity: on ? 1 : 0, transition: `opacity 400ms ease ${300 + i * 120}ms` }}>
            <circle cx={n.x} cy={n.y} r="7" fill={n.state === "ok" ? "var(--fg)" : n.state === "fail" ? "var(--fail)" : "var(--bg)"} stroke={n.state === "none" ? "var(--muted)" : "none"} strokeWidth="1.5" />
            <text x={n.x} y={n.y + 22} textAnchor="middle" fontSize="11" fill="var(--muted)">{n.label}</text>
          </g>
        ))}
      </svg>
      <p className="px-2 pb-1 text-[11.5px] text-faint">Illustration. Filled: worked · red: failed · hollow: not marked yet.</p>
    </div>
  );
}

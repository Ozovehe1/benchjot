"use client";
// Experiment tracking in the note: every run whose code called log(), side by side. The columns are
// the names the runs logged; tap a column to sort by it; pick a number column to see how it moved
// across runs; tick two runs to see what differs. Only what the code logged: nothing inferred.
import { useMemo, useState } from "react";
import { deleteRun, useRuns, type ExperimentRun } from "@/lib/data/experiments";
import { chartDefault, differences, formatLogged, loggedColumns, numericColumn, series, sortRuns } from "@/lib/run/logged";
import { cn, listDate } from "@/lib/ui/format";
import { IconTrash, Notice } from "../ui";

type CellRef = { id: string; filename?: string | null; content: string; language: string };

const OUTCOME: Record<ExperimentRun["outcome"], string> = { ok: "", error: "failed", timeout: "ran out of time", stopped: "stopped" };
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** The run's day: "Today", "Yesterday", or its date (listDate gives a time for today, already shown above it). */
const day = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? "Today" : listDate(iso));
const when = (iso: string) => `${day(iso)} ${clock(iso)}`;

export function RunsTable({ noteId, cells, onGoToCell }: { noteId: string; cells: readonly CellRef[]; onGoToCell?: (id: string) => void }) {
  const { data: runs, error, mutate } = useRuns(noteId);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [desc, setDesc] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [metric, setMetric] = useState<string | null>(null);

  const all = useMemo(() => runs ?? [], [runs]);
  const columns = useMemo(() => loggedColumns(all), [all]);
  const numeric = useMemo(() => columns.filter((c) => numericColumn(all, c)), [all, columns]);
  const sorted = useMemo(() => sortRuns(all, sortBy, desc), [all, sortBy, desc]);
  const cellNo = useMemo(() => new Map(cells.map((c, i) => [c.id, { n: i + 1, label: c.filename?.trim() || `Cell ${i + 1}` }])), [cells]);
  const chartMetric = metric && numeric.includes(metric) ? metric : chartDefault(numeric);
  const pair = picked.length === 2 ? picked.map((id) => all.find((r) => r.id === id)).filter((r): r is ExperimentRun => !!r) : [];
  const differ = pair.length === 2 ? new Set(differences(pair[0]!.logged, pair[1]!.logged)) : null;

  if (error) return <Notice className="mt-10" actions={[{ label: "Try again", onClick: () => void mutate() }]}>Couldn’t load this note’s runs.</Notice>;
  if (!runs) return null;
  if (!runs.length) {
    if (!cells.some((c) => c.language === "python")) return null;
    return (
      <section aria-label="Runs" className="mt-12">
        <h2 className="eyebrow mb-1.5">Runs</h2>
        <p className="text-sm text-muted">
          Track a run: add <code className="font-mono text-[13px] text-fg">log(accuracy=acc, lr=lr)</code> to a cell. Each run that logs shows here, side by side, so you can see what changed.
        </p>
      </section>
    );
  }

  const sortOn = (c: string | null) => {
    if (sortBy === c) setDesc((d) => !d);
    else (setSortBy(c), setDesc(true));
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const arrow = (c: string | null) => (sortBy === c ? (desc ? " ↓" : " ↑") : "");

  return (
    <section aria-label="Runs" className="mt-12">
      <div className="mb-3">
        <h2 className="eyebrow">Runs <span className="tabular-nums text-faint">{runs.length}</span></h2>
        <p className="mt-1 text-sm text-muted">
          Every run of a cell that called <code className="font-mono text-[13px] text-fg">log(…)</code>, with what it logged, so you can see what changed between runs.{" "}
          {all.length > 1 && (picked.length === 2 ? "Bold: what differs between the two ticked runs." : "Tick two to compare them.")}
        </p>
      </div>

      {chartMetric && all.length >= 2 && (
        <MetricChart runs={all} metric={chartMetric} options={numeric} onMetric={setMetric} cellNo={cellNo} />
      )}

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="w-10 px-3 py-2.5 font-normal"><span className="sr-only">Compare</span></th>
              <th className="px-3 py-2.5 font-normal">
                <button type="button" onClick={() => sortOn(null)} className="hover:text-fg">Run{arrow(null)}</button>
              </th>
              <th className="px-3 py-2.5 font-normal">Cell</th>
              {columns.map((c) => (
                <th key={c} className={cn("px-3 py-2.5 font-normal", numeric.includes(c) && "text-right")} aria-sort={sortBy === c ? (desc ? "descending" : "ascending") : undefined}>
                  <button type="button" onClick={() => sortOn(c)} className="font-mono hover:text-fg">{c}{arrow(c)}</button>
                </th>
              ))}
              <th className="w-10 px-2 py-2.5"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const cell = cellNo.get(r.cellId);
              const on = picked.includes(r.id);
              return (
                <tr key={r.id} className={cn("border-b border-line last:border-0", on && "bg-tint/60")}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={on} onChange={() => toggle(r.id)} aria-label={`Compare the run of ${when(r.ranAt)}`} className="size-4 accent-current" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 leading-tight" title={when(r.ranAt)}>
                    <span className="block tabular-nums text-fg/85">{clock(r.ranAt)}</span>
                    <span className="block text-[11px] text-faint">
                      {day(r.ranAt)}
                      {OUTCOME[r.outcome] && <span className="ml-1.5 text-fail">{OUTCOME[r.outcome]}</span>}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {cell ? (
                      <button type="button" onClick={() => onGoToCell?.(r.cellId)} className="text-muted underline-offset-4 hover:text-fg hover:underline" title={cell.label}>
                        {cell.n}
                      </button>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  {columns.map((c) => (
                    <td key={c} className={cn("whitespace-nowrap px-3 py-2 font-mono", numeric.includes(c) ? "text-right tabular-nums" : "", on && differ?.has(c) ? "font-semibold text-fg" : "text-fg/90")}>
                      {formatLogged(r.logged[c])}
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <button type="button" aria-label={`Remove the run of ${when(r.ranAt)}`} onClick={() => window.confirm("Remove this run from the table? The cell and its output stay.") && void deleteRun(noteId, r.id)} className="grid size-7 place-items-center rounded-md text-faint hover:bg-tint hover:text-fg">
                      <IconTrash className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One logged number across runs, oldest to newest: a 2px line, a marker per run, a tooltip on hover or tap. */
function MetricChart({ runs, metric, options, onMetric, cellNo }: { runs: readonly ExperimentRun[]; metric: string; options: string[]; onMetric: (m: string) => void; cellNo: Map<string, { n: number; label: string }> }) {
  const points = series(runs, metric);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const W = 640, H = 150, PX = 12, PT = 12, PB = 22;
  const values = points.map((p) => p.value);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (lo === hi) (lo -= Math.abs(lo) * 0.05 || 1, hi += Math.abs(hi) * 0.05 || 1);
  const x = (i: number) => PX + (i * (W - 2 * PX)) / (points.length - 1);
  const y = (v: number) => PT + ((hi - v) * (H - PT - PB)) / (hi - lo);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const h = hover !== null ? points[hover] : null;
  const run = h ? runs.find((r) => r.ranAt === h.at) : null;

  return (
    <figure className="card px-4 pb-3 pt-3.5 sm:px-5">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-muted">
          <span className="font-mono text-fg">{metric}</span> over {points.length} runs
        </span>
        {options.length > 1 && (
          <span role="group" aria-label="Metric" className="flex flex-wrap gap-1">
            {options.map((m) => (
              <button key={m} type="button" aria-pressed={m === metric} onClick={() => onMetric(m)} className={cn("rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors", m === metric ? "bg-fg text-bg" : "bg-tint text-muted hover:text-fg")}>
                {m}
              </button>
            ))}
          </span>
        )}
      </figcaption>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-[150px] w-full text-fg" preserveAspectRatio="none" role="img" aria-label={`${metric} across ${points.length} runs, from ${formatLogged(points[0]!.value)} to ${formatLogged(points.at(-1)!.value)}`} onMouseLeave={() => setHover(null)}>
          <line x1={PX} x2={W - PX} y1={H - PB} y2={H - PB} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={d} fill="none" stroke="currentColor" strokeOpacity={0.85} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => (
            <g key={p.at} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={x(i) - (W - 2 * PX) / (2 * (points.length - 1))} y={0} width={(W - 2 * PX) / (points.length - 1)} height={H} fill="transparent" />
              {hover === i && <line x1={x(i)} x2={x(i)} y1={PT} y2={H - PB} className="stroke-faint" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            </g>
          ))}
        </svg>
        {/* Markers in HTML over the chart, so they stay round however wide the chart is. */}
        {points.map((p, i) => (
          <span key={p.at} aria-hidden className={cn("pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg ring-2 ring-[var(--raise)]", hover === i && "size-2.5")} style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.value) / H) * 150}px` }} />
        ))}
        <span className="absolute right-0 top-0 font-mono text-[11px] tabular-nums text-faint">{formatLogged(hi)}</span>
        <span className="absolute bottom-[22px] right-0 font-mono text-[11px] tabular-nums text-faint">{formatLogged(lo)}</span>
        {h && (
          <div role="status" className={cn("pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-raise px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-line", x(hover!) > W / 2 ? "-translate-x-[calc(100%+12px)]" : "translate-x-3")} style={{ left: `${(x(hover!) / W) * 100}%`, top: `${Math.min(Math.max(y(h.value) - 20, 0), 150 - 52)}px` }}>
            <span className="block font-mono tabular-nums text-fg">{metric} {formatLogged(h.value)}</span>
            <span className="block text-faint">{when(h.at)}{run && cellNo.get(run.cellId) ? ` · cell ${cellNo.get(run.cellId)!.n}` : ""}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{listDate(points[0]!.at)}</span>
        <span>{listDate(points.at(-1)!.at)}</span>
      </div>
    </figure>
  );
}

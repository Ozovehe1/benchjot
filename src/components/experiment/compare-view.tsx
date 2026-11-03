"use client";
import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { useRuns } from "@/lib/data";
import { compareRecords, formatDelta, formatNumber, metricDelta } from "@/lib/compare";
import { cn, shortDate } from "@/lib/format";
import type { Run } from "@/lib/schemas";
import { ErrorState, Skeleton, EmptyState, Button } from "../ui";
import { PageHeader } from "../page-header";

export function CompareView({ experimentId, a, b }: { experimentId: string; a: string; b: string }) {
  const { data: runs, error, mutate } = useRuns(experimentId);
  const back = `/e/${experimentId}?tab=runs`;
  const runA = runs?.find((r) => r.id === a);
  const runB = runs?.find((r) => r.id === b);

  return (
    <>
      <PageHeader back={back} title="Compare runs" narrow />
      <main className="mx-auto max-w-3xl px-4 py-5 md:px-6 md:py-8">
        {error ? (
          <ErrorState error={error} onRetry={() => void mutate()} />
        ) : !runs ? (
          <Skeleton className="h-64" />
        ) : !runA || !runB ? (
          <EmptyState
            icon={<ArrowLeftRight className="size-5" />}
            title="Pick two runs"
            body="One of these runs no longer exists."
            action={
              <Link href={back}>
                <Button>Back to runs</Button>
              </Link>
            }
          />
        ) : (
          <Comparison a={runA} b={runB} swapHref={`/e/${experimentId}/compare?a=${b}&b=${a}`} />
        )}
      </main>
    </>
  );
}

function Comparison({ a, b, swapHref }: { a: Run; b: Run; swapHref: string }) {
  const metrics = compareRecords(a.metrics, b.metrics);
  const params = compareRecords(a.params, b.params);
  const env = compareRecords(a.env, b.env);
  const changed = params.filter((r) => !r.same).length;

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-20 -mx-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur md:top-16 md:mx-0 md:rounded-2xl md:border md:px-4">
        <RunHead run={a} tag="A" />
        <Link href={swapHref} aria-label="Swap A and B" className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg md:size-9">
          <ArrowLeftRight className="size-4" />
        </Link>
        <RunHead run={b} tag="B" align="right" />
      </div>

      <Section title="Metrics" subtitle="B − A">
        {metrics.length === 0 ? (
          <Empty />
        ) : (
          metrics.map((r) => {
            const d = metricDelta(r.a, r.b);
            return (
              <Row key={r.key} label={r.key} differs={!r.same}>
                <Val>{r.a === undefined ? "—" : formatNumber(r.a)}</Val>
                <Val>
                  {r.b === undefined ? "—" : formatNumber(r.b)}
                  {d !== null && d !== 0 && <span className="ml-1.5 text-[11px] font-normal text-muted">{formatDelta(d)}</span>}
                </Val>
              </Row>
            );
          })
        )}
      </Section>

      <Section title="Parameters" subtitle={changed ? `${changed} changed` : "identical"}>
        {params.length === 0 ? <Empty /> : params.map((r) => <TextRow key={r.key} row={r} />)}
      </Section>

      <Section title="Environment">{env.length === 0 ? <Empty /> : env.map((r) => <TextRow key={r.key} row={r} />)}</Section>

      {(a.outcome || b.outcome) && (
        <Section title="Outcome">
          <div className="grid grid-cols-2 gap-3 p-3 text-sm leading-relaxed text-muted">
            <p className="whitespace-pre-wrap">{a.outcome || "—"}</p>
            <p className="whitespace-pre-wrap">{b.outcome || "—"}</p>
          </div>
        </Section>
      )}
    </div>
  );
}

function RunHead({ run, tag, align }: { run: Run; tag: string; align?: "right" }) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Run {tag}</p>
      <p className="truncate font-mono text-sm font-medium">{run.name}</p>
      <p className="text-[11px] text-faint">{shortDate(run.ran_at)}</p>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-faint">{subtitle}</span>}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{children}</div>
    </section>
  );
}

function Row({ label, differs, children }: { label: string; differs: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("px-3 py-2.5", differs && "bg-accent-soft/40")}>
      <p className="mb-1 flex items-center gap-1.5 font-mono text-xs text-muted">
        {differs && <span className="size-1.5 rounded-full bg-accent" aria-label="differs" />}
        {label}
      </p>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Val({ children }: { children: React.ReactNode }) {
  return <p className="min-w-0 break-words font-mono text-[14px] font-semibold tabular-nums">{children}</p>;
}

function TextRow({ row }: { row: { key: string; a?: string; b?: string; same: boolean } }) {
  return (
    <Row label={row.key} differs={!row.same}>
      <p className="min-w-0 break-words font-mono text-[13.5px]">{row.a ?? "—"}</p>
      <p className="min-w-0 break-words font-mono text-[13.5px]">{row.b ?? "—"}</p>
    </Row>
  );
}

function Empty() {
  return <p className="px-3 py-4 text-sm text-faint">Neither run recorded any.</p>;
}

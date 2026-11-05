"use client";
import Link from "next/link";
import { displayFile, outputLabel, type Manifest, type OutputItem, type TableOutput } from "@/lib/run/outputs";
import { ChartView } from "./chart-view";

const INLINE_ROWS = 8;

/** A table preview: index columns muted, numbers right-aligned, scrolls sideways. */
export function TablePreview({ table, rows = INLINE_ROWS }: { table: TableOutput; rows?: number }) {
  const shown = table.rows.slice(0, rows);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse font-mono text-xs">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-medium text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td
                  key={j}
                  className={`whitespace-nowrap border-b border-line px-2 py-1 ${j < table.index_columns ? "text-muted" : ""} ${typeof v === "number" ? "text-right tabular-nums" : ""}`}
                >
                  {v === null ? "" : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.total_rows > shown.length && (
        <p className="py-1 font-mono text-xs text-faint">
          {shown.length} of {table.total_rows} rows
          {table.total_columns + table.index_columns > table.columns.length ? ` · ${table.columns.length - table.index_columns} of ${table.total_columns} columns` : ""}
        </p>
      )}
    </div>
  );
}

type Urls = Readonly<Record<string, string | undefined>>;

function Preview({ item, urls }: { item: OutputItem; urls: Urls }) {
  const url = (name: string | undefined) => (name ? urls[name] : undefined);
  if (item.kind === "table") return <TablePreview table={item} />;
  if (item.kind === "chart") return <ChartView item={item} specUrl={url(item.files.json)} interactive={false} className="h-72" />;
  const src = url(displayFile(item) ?? undefined);
  if (!src) return <div className="h-40" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={item.title || outputLabel(item)} loading="lazy" className="mx-auto max-h-[60vh] w-auto max-w-full rounded-sm" />;
}

/**
 * Figures, tables and charts under a code block, in the order the code made them.
 * `urls`: each file's address, by name. Each opens on its own page (`hrefs[i]`) once the run
 * is saved; until then (`hrefs` null) they show without a link. Plain data, so a server page
 * (the landing's read-only note) can render it too.
 */
export function RunOutputs({
  manifest,
  urls,
  hrefs,
}: {
  manifest: Manifest;
  urls: Urls;
  hrefs: readonly string[] | null;
}) {
  return (
    <section aria-label="Figures and tables" className="space-y-4 pt-2">
      {manifest.items.map((item, i) => {
        const caption = (
          <span className="flex min-h-12 items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-mono text-faint">
              {outputLabel(item)}
              {item.kind !== "table" && item.title ? ` · ${item.title}` : ""}
            </span>
            {hrefs && <span className="shrink-0 text-muted">Open</span>}
          </span>
        );
        const body = (
          <>
            <Preview item={item} urls={urls} />
            {caption}
          </>
        );
        return hrefs?.[i] ? (
          <Link key={i} href={hrefs[i]} aria-label={`Open ${outputLabel(item)} ${i + 1}`} className="block hover:opacity-95">
            {body}
          </Link>
        ) : (
          <div key={i}>{body}</div>
        );
      })}
      {manifest.notes.map((n) => (
        <p key={n} className="font-mono text-xs text-muted">
          {n}
        </p>
      ))}
    </section>
  );
}

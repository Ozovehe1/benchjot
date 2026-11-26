"use client";
import Link from "next/link";
import { displayFile, numericColumns, outputLabel, videoFile, type Manifest, type OutputItem, type TableOutput } from "@/lib/run/outputs";
import { ChartView } from "./chart-view";

const INLINE_ROWS = 8;

/** A table preview: index columns muted, number columns right-aligned (header too), scrolls sideways. */
export function TablePreview({ table, rows = INLINE_ROWS }: { table: TableOutput; rows?: number }) {
  const shown = table.rows.slice(0, rows);
  const numeric = numericColumns(table);
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse font-mono text-xs">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={`whitespace-nowrap border-b border-line px-2 py-1.5 font-medium text-muted ${numeric[i] ? "text-right" : "text-left"}`}>
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
                  className={`whitespace-nowrap border-b border-line px-2 py-1 ${j < table.index_columns ? "text-muted" : ""} ${numeric[j] ? "text-right tabular-nums" : ""}`}
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

function Preview({ item, urls, tableRows }: { item: OutputItem; urls: Urls; tableRows?: number }) {
  const url = (name: string | undefined) => (name ? urls[name] : undefined);
  if (item.kind === "table") return <TablePreview table={item} rows={tableRows} />;
  if (item.kind === "chart") return <ChartView item={item} specUrl={url(item.files.json)} interactive={false} className="h-72" />;
  const src = url(displayFile(item) ?? undefined);
  const video = url(videoFile(item) ?? undefined);
  // A video the code wrote, or an animation with a video (server runs make one beside the GIF):
  // played in place, the video first (full colour, smoother, far smaller than the GIF).
  if (video) return <video src={video} controls autoPlay loop muted playsInline aria-label={item.title || outputLabel(item)} className="mx-auto max-h-[60vh] w-auto max-w-full rounded-sm" />;
  if (!src) return <div className="h-40" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={item.title || outputLabel(item)} loading="lazy" className="mx-auto max-h-[60vh] w-auto max-w-full rounded-sm" />;
}

/**
 * Figures, tables and charts under a code block, in the order the code made them.
 * `urls`: each file's address, by name. Each opens on its own page (`hrefs[i]`) once the run
 * is saved; until then (`hrefs` null) they show without a link. Plain data, so a server page
 * (the landing's read-only note) can render it too. `tableRows`: rows shown per table (default 8).
 */
export function RunOutputs({
  manifest,
  urls,
  hrefs,
  tableRows,
}: {
  manifest: Manifest;
  urls: Urls;
  hrefs: readonly string[] | null;
  tableRows?: number;
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
            <Preview item={item} urls={urls} tableRows={tableRows} />
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

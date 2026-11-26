"use client";
// Find datasets: one search across public data platforms (Hugging Face, Zenodo, OpenML, Harvard
// Dataverse, figshare; no sign-in). Each result says where it's from; open one to see its data files
// and add a file to the library with a tap. Big files point to a server cell instead.
import { useEffect, useState } from "react";
import { DATA_FILE_MAX } from "@/lib/data/datasets";
import { addFoundFile, datasetFiles, searchDatasets, SOURCE_NAMES, type FoundDataset, type FoundFile, type SourceId } from "@/lib/data/dataset-search";
import { cn } from "@/lib/ui/format";
import { Button, FIELD, IconSearch, Notice, Spinner } from "../ui";

const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 10 * 1048576 ? 0 : 1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const PLATFORMS = Object.values(SOURCE_NAMES);
/** Results shown at a time, and a dataset's files shown before "Show all". */
const PAGE = 6;
const FILES_PAGE = 5;

export function DatasetSearch({ onAdded }: { onAdded?: () => void }) {
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [state, setState] = useState<{ phase: "idle" | "searching" | "done" | "error"; results?: FoundDataset[]; missed?: SourceId[]; error?: string }>({ phase: "idle" });
  const [only, setOnly] = useState<SourceId | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** How many results show: a few at a time, more on request, so the list never takes the whole page. */
  const [limit, setLimit] = useState(PAGE);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setState({ phase: "searching" });
    setOpen(null);
    setOnly(null);
    setLimit(PAGE);
    setAsked(q.trim());
    try {
      const r = await searchDatasets(q.trim());
      setState({ phase: "done", results: r.results, missed: r.missed });
    } catch (e) {
      setState({ phase: "error", error: e instanceof Error ? e.message : "Search failed." });
    }
  };

  const results = state.results ?? [];
  const counts = results.reduce<Partial<Record<SourceId, number>>>((c, d) => ({ ...c, [d.source]: (c[d.source] ?? 0) + 1 }), {});
  const matching = only ? results.filter((d) => d.source === only) : results;
  const shown = matching.slice(0, limit);

  return (
    <section aria-label="Find datasets" className="mt-12">
      <h2 className="eyebrow mb-1">Find datasets</h2>
      <p className="mb-3 text-sm text-muted">
        One search across {PLATFORMS.slice(0, -1).join(", ")} and {PLATFORMS.at(-1)}. Public datasets, no sign-in. Add a file and every cell can open it.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
        className="flex gap-2"
      >
        <label className="relative block flex-1">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="iris, titanic, air quality, gene expression…" aria-label="Search datasets" className={`${FIELD} pl-10`} />
        </label>
        <Button type="submit" variant="neutral" disabled={!query.trim() || state.phase === "searching"} className="shrink-0">
          Search
        </Button>
      </form>

      {state.phase === "searching" && (
        <p className="mt-5 flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" /> Searching {PLATFORMS.length} platforms…
        </p>
      )}
      {state.phase === "error" && <Notice className="mt-4">{state.error}</Notice>}
      {state.phase === "done" && (
        <>
          {!!state.missed?.length && <p className="mt-4 text-xs text-faint">{state.missed.map((m) => SOURCE_NAMES[m]).join(", ")} didn’t answer this time; showing the others.</p>}
          {results.length === 0 ? (
            <p className="mt-5 text-sm text-muted">No dataset titles match “{asked}”. Try fewer or other words. OpenML matches exact dataset names only, such as iris or mnist_784.</p>
          ) : (
            <>
              <div role="group" aria-label="Platform" className="-mx-1 mt-5 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {[null, ...(Object.keys(SOURCE_NAMES) as SourceId[])].map((s) => {
                  const n = s ? (counts[s] ?? 0) : results.length;
                  if (s && !n) return null;
                  return (
                    <button key={s ?? "all"} type="button" aria-pressed={only === s} onClick={() => (setOnly(s), setLimit(PAGE))} className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors", only === s ? "bg-fg text-bg" : "bg-tint text-muted hover:text-fg")}>
                      {s ? SOURCE_NAMES[s] : "All"} <span className="tabular-nums opacity-70">{n}</span>
                    </button>
                  );
                })}
              </div>
              <ul className="card mt-3 divide-y divide-line overflow-hidden">
                {shown.map((d) => {
                  const key = `${d.source}:${d.id}`;
                  return (
                    <li key={key}>
                      <button type="button" onClick={() => setOpen((o) => (o === key ? null : key))} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-tint/50 sm:px-5" aria-expanded={open === key}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-fg">{d.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-faint">
                            <span className="text-muted">{SOURCE_NAMES[d.source]}</span>
                            {d.detail ? ` · ${d.detail}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted">{open === key ? "Hide" : "Files"}</span>
                      </button>
                      {open === key && <DatasetFiles dataset={d} onAdded={onAdded} />}
                    </li>
                  );
                })}
              </ul>
              {matching.length > shown.length && (
                <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="mt-3 inline-flex min-h-10 items-center text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
                  Show {Math.min(PAGE, matching.length - shown.length)} more <span className="ml-1.5 text-faint">· {shown.length} of {matching.length}</span>
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function DatasetFiles({ dataset, onAdded }: { dataset: FoundDataset; onAdded?: () => void }) {
  const [files, setFiles] = useState<FoundFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState(false);

  useEffect(() => {
    let live = true;
    datasetFiles(dataset.source, dataset.id)
      .then((f) => live && setFiles(f))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Couldn’t list its files."));
    return () => void (live = false);
  }, [dataset.source, dataset.id]);

  const add = async (f: FoundFile) => {
    setAdding(f.url);
    setProblem(null);
    try {
      await addFoundFile(f);
      setAdded((s) => new Set(s).add(f.url));
      onAdded?.();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn’t add it.");
    } finally {
      setAdding(null);
    }
  };

  const page = (
    <a href={dataset.page} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
      {SOURCE_NAMES[dataset.source]}
    </a>
  );
  return (
    <div className="border-t border-line bg-tint/30 px-4 py-3 sm:px-5">
      {files === null && error === null && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner className="size-3.5" /> Reading its files…
        </p>
      )}
      {error && <p className="text-xs text-muted">{error}</p>}
      {problem && <Notice className="mb-2">{problem}</Notice>}
      {files && files.length === 0 && <p className="text-xs text-muted">No data files here (tables, arrays or data archives). See it on {page}.</p>}
      {files && files.length > 0 && (
        <>
          <ul className="flex flex-col gap-1.5">
            {(allFiles ? files : files.slice(0, FILES_PAGE)).map((f) => {
              const tooBig = f.size > DATA_FILE_MAX;
              return (
                <li key={f.url} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px] text-fg/90">{f.name}</span>
                    <span className="text-xs tabular-nums text-faint">{f.size ? mb(f.size) : "Size not given"}{tooBig ? " · over 50 MB" : ""}</span>
                  </span>
                  {added.has(f.url) ? (
                    <span className="shrink-0 text-xs text-ok">Added</span>
                  ) : tooBig ? (
                    <span className="shrink-0 text-xs text-faint" title="Over the library's 50 MB a file: download it in a server cell instead">Server cell</span>
                  ) : (
                    <Button size="sm" variant="neutral" disabled={adding !== null} loading={adding === f.url} onClick={() => void add(f)} className="shrink-0">
                      Add
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {!allFiles && files.length > FILES_PAGE && (
            <button type="button" onClick={() => setAllFiles(true)} className="mt-2 text-xs text-muted underline-offset-4 hover:text-fg hover:underline">
              Show all {files.length} files
            </button>
          )}
          <p className="mt-2.5 text-xs text-faint">More about it on {page}.</p>
        </>
      )}
    </div>
  );
}

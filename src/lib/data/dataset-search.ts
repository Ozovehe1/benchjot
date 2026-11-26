"use client";
// Find datasets: one search across public data platforms (/api/data/search; Hugging Face, Zenodo,
// OpenML, Harvard Dataverse, figshare; no sign-in), a dataset's files, and adding a file to the Data
// library through its add-by-address.
import { addDatasetFromUrl } from "./datasets";

export type SourceId = "hf" | "zenodo" | "openml" | "dataverse" | "figshare";
/** The platforms, as the user reads them (same order and names as lib/server/data-sources.ts). */
export const SOURCE_NAMES: Record<SourceId, string> = { hf: "Hugging Face", zenodo: "Zenodo", openml: "OpenML", dataverse: "Harvard Dataverse", figshare: "figshare" };
export type FoundDataset = { source: SourceId; id: string; title: string; detail: string; page: string };
export type FoundFile = { name: string; size: number; url: string };

async function get<T>(params: string): Promise<T> {
  const res = await fetch(`/api/data/search?${params}`, { cache: "no-store" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Couldn’t reach the data platforms. Check your connection.");
  }
  return res.json() as Promise<T>;
}

export const searchDatasets = (q: string, sources?: readonly SourceId[]) =>
  get<{ results: FoundDataset[]; missed: SourceId[] }>(`q=${encodeURIComponent(q)}${sources?.length ? `&sources=${sources.join(",")}` : ""}`);
export const datasetFiles = (source: SourceId, id: string) => get<{ files: FoundFile[] }>(`source=${source}&id=${encodeURIComponent(id)}`).then((r) => r.files);

/** Adds one of a dataset's files to the Data library under its own file name. */
export const addFoundFile = (f: FoundFile) => addDatasetFromUrl(f.url, f.name.split("/").pop());

/** The Assistant's find_datasets: words search every platform; "source:id" (as the search lists it) gives that dataset's files. */
export async function findDatasetsForAgent(
  query: string,
): Promise<{ kind: "datasets"; results: { ref: string; title: string; source: string; detail: string }[]; missed: string[] } | { kind: "files"; ref: string; files: FoundFile[] }> {
  const q = query.trim();
  const ref = q.match(/^(hf|zenodo|openml|dataverse|figshare):(.+)$/);
  if (ref) return { kind: "files", ref: q, files: await datasetFiles(ref[1] as SourceId, ref[2]!.trim()) };
  const { results, missed } = await searchDatasets(q);
  return { kind: "datasets", results: results.map((d) => ({ ref: `${d.source}:${d.id}`, title: d.title, source: SOURCE_NAMES[d.source], detail: d.detail })), missed: missed.map((m) => SOURCE_NAMES[m]) };
}

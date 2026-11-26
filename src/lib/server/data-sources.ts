// Server-side only: public data platforms that Find datasets (the Data page, and the Assistant's
// find_datasets) searches at once. None needs a sign-in. Each one searches by words and lists a
// dataset's data files with a public https address, which /api/data/fetch downloads into the Data
// library. A platform that's slow or down is left out of that search, not an error. Checked live
// 2026-11-26: Hugging Face, Zenodo, OpenML (exact names only: its free-text search is closed),
// Harvard Dataverse, figshare.

export type SourceId = "hf" | "zenodo" | "openml" | "dataverse" | "figshare";
export const SOURCES: Record<SourceId, { name: string; site: string }> = {
  hf: { name: "Hugging Face", site: "huggingface.co" },
  zenodo: { name: "Zenodo", site: "zenodo.org" },
  openml: { name: "OpenML", site: "openml.org" },
  dataverse: { name: "Harvard Dataverse", site: "dataverse.harvard.edu" },
  figshare: { name: "figshare", site: "figshare.com" },
};
export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];

/** One dataset in the results. `id` is the platform's own; `page` is where a person reads about it. */
export type FoundDataset = { source: SourceId; id: string; title: string; detail: string; page: string };
/** One of a dataset's files: its name, size in bytes (0 when the platform doesn't say), and download address. */
export type FoundFile = { name: string; size: number; url: string };

/** Files worth putting in a data library: tables, arrays, data archives. Not papers, code or pictures. */
export const DATA_FILE = /\.(csv|tsv|tab|parquet|json|jsonl|ndjson|xlsx?|npy|npz|feather|arrow|txt|arff|h5|hdf5|mat|dta|sav|rds|nc|zip|gz)$/i;

type Get = (url: string, init?: RequestInit) => Promise<unknown>;

const count = (n: number, word: string) => (n > 0 ? `${n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : n} ${word}` : "");
const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
const clean = (t: unknown) => String(t ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

// ------------------------------------------------------------------ each platform

const HF_ID = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

const hf = {
  async search(get: Get, q: string, n: number): Promise<FoundDataset[]> {
    const list = (await get(`https://huggingface.co/api/datasets?search=${encodeURIComponent(q)}&limit=${n}&sort=downloads&direction=-1&full=false`)) as { id?: string; downloads?: number; likes?: number }[];
    return (Array.isArray(list) ? list : []).filter((d) => typeof d.id === "string").map((d) => ({ source: "hf" as const, id: d.id!, title: d.id!, detail: join(count(d.downloads ?? 0, "downloads"), count(d.likes ?? 0, "likes")), page: `https://huggingface.co/datasets/${d.id}` }));
  },
  async files(get: Get, id: string): Promise<FoundFile[]> {
    if (!HF_ID.test(id)) return [];
    const tree = (await get(`https://huggingface.co/api/datasets/${id}/tree/main?recursive=true`)) as { type?: string; path?: string; size?: number }[];
    return (Array.isArray(tree) ? tree : [])
      .filter((f) => f.type === "file" && typeof f.path === "string")
      .map((f) => ({ name: f.path!, size: Number(f.size ?? 0), url: `https://huggingface.co/datasets/${id}/resolve/main/${encPath(f.path!)}` }));
  },
};

const zenodo = {
  async search(get: Get, q: string, n: number): Promise<FoundDataset[]> {
    const r = (await get(`https://zenodo.org/api/records?q=${encodeURIComponent(q)}&type=dataset&size=${n}&sort=bestmatch`)) as { hits?: { hits?: { id?: number; metadata?: { title?: string; publication_date?: string }; stats?: { downloads?: number }; links?: { self_html?: string } }[] } };
    return (r.hits?.hits ?? []).filter((h) => h.id).map((h) => ({ source: "zenodo" as const, id: String(h.id), title: clean(h.metadata?.title) || `Record ${h.id}`, detail: join(h.metadata?.publication_date ?? "", count(h.stats?.downloads ?? 0, "downloads")), page: h.links?.self_html ?? `https://zenodo.org/records/${h.id}` }));
  },
  async files(get: Get, id: string): Promise<FoundFile[]> {
    if (!/^\d{1,12}$/.test(id)) return [];
    const r = (await get(`https://zenodo.org/api/records/${id}`)) as { files?: { key?: string; size?: number; links?: { self?: string } }[] };
    return (r.files ?? []).filter((f) => f.key && f.links?.self).map((f) => ({ name: f.key!, size: Number(f.size ?? 0), url: f.links!.self! }));
  },
};

const openml = {
  /** OpenML's name search is exact (its free-text search isn't open), so the words are tried as a name. */
  async search(get: Get, q: string, n: number): Promise<FoundDataset[]> {
    const name = q.trim().toLowerCase().replace(/\s+/g, "_");
    if (!/^[\w.-]{1,100}$/.test(name)) return [];
    const r = (await get(`https://www.openml.org/api/v1/json/data/list/data_name/${encodeURIComponent(name)}/limit/${n}/status/active`).catch(() => ({}))) as { data?: { dataset?: { did?: number; name?: string; version?: number; quality?: { name?: string; value?: string }[] }[] } };
    return (r.data?.dataset ?? []).filter((d) => d.did).map((d) => {
      const rows = Number(d.quality?.find((x) => x.name === "NumberOfInstances")?.value ?? 0);
      const cols = Number(d.quality?.find((x) => x.name === "NumberOfFeatures")?.value ?? 0);
      return { source: "openml" as const, id: String(d.did), title: `${d.name} (version ${d.version ?? 1})`, detail: join(count(rows, "rows"), count(cols, "columns")), page: `https://www.openml.org/d/${d.did}` };
    });
  },
  async files(get: Get, id: string): Promise<FoundFile[]> {
    if (!/^\d{1,9}$/.test(id)) return [];
    const r = (await get(`https://www.openml.org/api/v1/json/data/${id}`)) as { data_set_description?: { name?: string; file_id?: string | number } };
    const d = r.data_set_description;
    if (!d?.file_id || !d.name) return [];
    const name = `${String(d.name).replace(/[^\w.-]/g, "_")}.csv`;
    return [{ name, size: 0, url: `https://www.openml.org/data/get_csv/${d.file_id}/${encodeURIComponent(name)}` }];
  },
};

const DV = "https://dataverse.harvard.edu";
const dataverse = {
  async search(get: Get, q: string, n: number): Promise<FoundDataset[]> {
    const r = (await get(`${DV}/api/search?q=${encodeURIComponent(q)}&type=dataset&per_page=${n}`)) as { data?: { items?: { name?: string; global_id?: string; url?: string; published_at?: string; fileCount?: number }[] } };
    return (r.data?.items ?? []).filter((d) => d.global_id).map((d) => ({ source: "dataverse" as const, id: d.global_id!, title: clean(d.name) || d.global_id!, detail: join((d.published_at ?? "").slice(0, 10), count(d.fileCount ?? 0, "files")), page: d.url ?? `${DV}/dataset.xhtml?persistentId=${encodeURIComponent(d.global_id!)}` }));
  },
  async files(get: Get, id: string): Promise<FoundFile[]> {
    if (!/^(doi|hdl):[\w./-]{3,120}$/.test(id)) return [];
    const r = (await get(`${DV}/api/datasets/:persistentId/versions/:latest/files?persistentId=${encodeURIComponent(id)}`)) as { data?: { restricted?: boolean; dataFile?: { id?: number; filename?: string; filesize?: number; originalFileName?: string; originalFileSize?: number } }[] };
    return (r.data ?? [])
      .filter((f) => !f.restricted && f.dataFile?.id)
      .map((f) => {
        const d = f.dataFile!;
        // Tables Dataverse converted (.tab) download as the file that was uploaded (often a .csv).
        return d.originalFileName ? { name: d.originalFileName, size: Number(d.originalFileSize ?? d.filesize ?? 0), url: `${DV}/api/access/datafile/${d.id}?format=original` } : { name: d.filename ?? `file-${d.id}`, size: Number(d.filesize ?? 0), url: `${DV}/api/access/datafile/${d.id}` };
      });
  },
};

const figshare = {
  async search(get: Get, q: string, n: number): Promise<FoundDataset[]> {
    const list = (await get("https://api.figshare.com/v2/articles/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ search_for: q, item_type: 3, page_size: n }) })) as { id?: number; title?: string; published_date?: string; url_public_html?: string }[];
    return (Array.isArray(list) ? list : []).filter((d) => d.id).map((d) => ({ source: "figshare" as const, id: String(d.id), title: clean(d.title) || `Item ${d.id}`, detail: (d.published_date ?? "").slice(0, 10), page: d.url_public_html ?? `https://figshare.com/articles/dataset/_/${d.id}` }));
  },
  async files(get: Get, id: string): Promise<FoundFile[]> {
    if (!/^\d{1,12}$/.test(id)) return [];
    const list = (await get(`https://api.figshare.com/v2/articles/${id}/files`)) as { name?: string; size?: number; download_url?: string; is_link_only?: boolean }[];
    return (Array.isArray(list) ? list : []).filter((f) => f.name && f.download_url && !f.is_link_only).map((f) => ({ name: f.name!, size: Number(f.size ?? 0), url: f.download_url! }));
  },
};

const ADAPTERS: Record<SourceId, { search(get: Get, q: string, n: number): Promise<FoundDataset[]>; files(get: Get, id: string): Promise<FoundFile[]> }> = { hf, zenodo, openml, dataverse, figshare };

// ------------------------------------------------------------------ all at once

/** A JSON GET (or POST) with a time limit; throws on a non-2xx answer. */
export function jsonGetter(timeoutMs = 10_000, fetcher: typeof fetch = (u, i) => globalThis.fetch(u, i)): Get {
  return async (url, init) => {
    const res = await fetcher(url, { ...init, headers: { accept: "application/json", "user-agent": "Benchjot-Data/1.0", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
    return res.json();
  };
}

/**
 * True when every searched word is a word of the title, plurals too ("iris" finds "Iris flowers" and "iris_v2", not "Irish"):
 * several platforms match loosely across whole descriptions, which buries the datasets asked for.
 */
export function titleMatches(title: string, q: string): boolean {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const t = title.toLowerCase();
  return words.every((w) => new RegExp(`(^|[^a-z0-9])${w}(e?s)?($|[^a-z])`).test(t));
}

/** Searches the platforms at once (each up to `per` results); a platform that fails is left out and named in `missed`. */
export async function searchAll(get: Get, q: string, sources: readonly SourceId[] = SOURCE_IDS, per = 8): Promise<{ results: FoundDataset[]; missed: SourceId[] }> {
  // More are asked for than shown, since only those whose title has the words are kept.
  const settled = await Promise.allSettled(sources.map((s) => ADAPTERS[s].search(get, q, per * 3)));
  const missed: SourceId[] = [];
  const lists = settled.map((r, i) => (r.status === "fulfilled" ? r.value.filter((d) => titleMatches(d.title, q)).slice(0, per) : (missed.push(sources[i]!), [])));
  // Interleaved, so every platform's best match is near the top.
  const results: FoundDataset[] = [];
  for (let i = 0; i < per; i++) for (const l of lists) if (l[i]) results.push(l[i]!);
  return { results, missed };
}

/** A dataset's data files (tables, arrays, data archives), at most 200. */
export async function filesOf(get: Get, source: SourceId, id: string): Promise<FoundFile[]> {
  const files = await ADAPTERS[source].files(get, id);
  return files.filter((f) => DATA_FILE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
}

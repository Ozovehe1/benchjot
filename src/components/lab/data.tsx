"use client";
// Data: the lab's shelf. Every dataset the user uploaded or the Assistant saved, in one place, ready
// for any cell to open by name (the run puts the file in its folder first: browser, phone, server).
// Below the files, Find datasets: one search across public data platforms; then Sources, the
// accounts runs read from (Hugging Face, for gated and private models and datasets).
import { useRef, useState } from "react";
import { addDataset, addDatasetFromUrl, DATA_FILE_MAX, DATA_QUOTA, removeDataset, useDatasets, type Dataset } from "@/lib/data/datasets";
import { listDate } from "@/lib/ui/format";
import { DatasetSearch } from "./dataset-search";
import { DatasetKeys } from "../account/dataset-keys";
import { Button, Column, FIELD, IconCopy, IconDatabase, IconTrash, IconUpload, Notice, TextLink, TopBar, Working } from "../ui";

const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 10 * 1048576 ? 0 : 1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

/** How a cell opens a file, by its extension: the line to copy. */
export function openLine(name: string): string {
  const q = JSON.stringify(name);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "tsv" || ext === "txt") return `pd.read_csv(${q}${ext === "tsv" ? ', sep="\\t"' : ""})`;
  if (ext === "xlsx" || ext === "xls") return `pd.read_excel(${q})`;
  if (ext === "parquet") return `pd.read_parquet(${q})`;
  if (ext === "json") return `pd.read_json(${q})`;
  if (ext === "npy" || ext === "npz") return `np.load(${q})`;
  return `open(${q}, "rb")`;
}

export function DataLibrary() {
  const { data, error, mutate } = useDatasets();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const used = (data ?? []).reduce((n, f) => n + f.size, 0);

  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "That didn’t work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const upload = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    void act("Adding…", async () => {
      for (const f of list) await addDataset(f);
    });
  };

  const copy = (f: Dataset) => {
    void navigator.clipboard?.writeText(openLine(f.name)).then(() => {
      setCopied(f.name);
      setTimeout(() => setCopied((c) => (c === f.name ? null : c)), 1500);
    });
  };

  return (
    <Column className="pb-20">
      <TopBar left={<TextLink href="/">All notes</TextLink>} />
      <header className="mt-2 lg:mt-8">
        <h1 className="text-[34px] font-normal leading-none tracking-[-0.02em] lg:text-[40px]">Data</h1>
        <p className="mt-2.5 text-sm text-muted">Datasets you or the Assistant added. Any cell opens one by its name, in the browser, on the phone or on the server.</p>
      </header>

      <section aria-label="Add data" className="mt-8 flex flex-col gap-3 sm:flex-row">
        <input ref={picker} type="file" multiple className="hidden" onChange={(e) => (upload(e.target.files), (e.target.value = ""))} />
        <Button variant="neutral" onClick={() => picker.current?.click()} disabled={!!busy} className="shrink-0">
          <IconUpload className="size-4" /> Upload files
        </Button>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const u = url.trim();
            if (u) void act("Downloading…", async () => (await addDatasetFromUrl(u), setUrl("")));
          }}
        >
          <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Or paste a file’s https address" aria-label="File address" className={FIELD} />
          <Button type="submit" variant="neutral" disabled={!url.trim() || !!busy} className="shrink-0">
            Add
          </Button>
        </form>
      </section>
      {busy && <Working label={busy} className="mt-4" />}
      {problem && <Notice className="mt-4">{problem}</Notice>}
      {error && <Notice className="mt-4" actions={[{ label: "Try again", onClick: () => void mutate() }]}>Couldn’t load your data. Check your connection.</Notice>}

      <section aria-label="Your datasets" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="eyebrow">Files</h2>
          {data && (
            <span className="text-xs tabular-nums text-faint">
              {mb(used)} of {mb(DATA_QUOTA)} · up to {mb(DATA_FILE_MAX)} a file
            </span>
          )}
        </div>
        {data && <div aria-hidden className="mb-4 h-1 overflow-hidden rounded-full bg-tint"><div className="h-full bg-muted" style={{ width: `${Math.min(100, (used / DATA_QUOTA) * 100)}%` }} /></div>}
        {!data && !error && <Working label="Loading…" />}
        {data && data.length === 0 && (
          <div className="card flex items-start gap-4 px-5 py-5">
            <IconDatabase className="mt-0.5 size-5 shrink-0 text-faint" />
            <p className="text-sm text-muted">No datasets yet. Upload a CSV, Excel, Parquet or any file, paste an address, or search the platforms below, or ask the Assistant to find one: it saves what it downloads here.</p>
          </div>
        )}
        {data && data.length > 0 && (
          <ul className="card divide-y divide-line overflow-hidden">
            {data.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[14px] text-fg">{f.name}</span>
                  <span className="mt-0.5 block text-xs tabular-nums text-faint">
                    {mb(f.size)}
                    {f.updatedAt ? ` · ${listDate(f.updatedAt)}` : ""}
                  </span>
                </span>
                <button type="button" onClick={() => copy(f)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted transition-colors hover:bg-tint hover:text-fg" title={openLine(f.name)} aria-label={`Copy code that opens ${f.name}`}>
                  <IconCopy className="size-3.5" />
                  <span className={copied === f.name ? "" : "max-sm:sr-only"}>{copied === f.name ? "Copied" : "Copy code"}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  disabled={!!busy}
                  onClick={() => window.confirm(`Remove ${f.name}? Cells that open it will say it’s missing.`) && void act("Removing…", () => removeDataset(f.name))}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-tint hover:text-fg"
                >
                  <IconTrash className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DatasetSearch onAdded={() => void mutate()} />

      <section aria-label="Sources" className="mt-12">
        <h2 className="eyebrow mb-1">Sources</h2>
        <p className="mb-3 text-sm text-muted">Data platforms your runs read from directly, with your own account. Public data needs none.</p>
        <div className="card px-5">
          <DatasetKeys next="/data" />
        </div>
      </section>
    </Column>
  );
}

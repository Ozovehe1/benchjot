"use client";
// The Data library (supabase/migrations/20261126000000_datasets.sql): the user's datasets in the
// private "datasets" bucket, under their own folder. Listed, added, removed, and signed for runs.
import useSWR, { mutate } from "swr";
import { supabase } from "./supabase/client";
import { cleanDataName, DATA_BUCKET, validDataName } from "../run/datasets-match";
import { FriendlyError } from "../ui/user-message";
import { fetchToLibrary } from "../run/server-client";

export { DATA_BUCKET };
export const DATA_FILE_MAX = 50 * 1024 * 1024;
export const DATA_QUOTA = 250 * 1024 * 1024;
const KEY = ["datasets"] as const;

export type Dataset = { name: string; size: number; updatedAt: string };

async function uid(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new FriendlyError("Sign in first.");
  return id;
}

const bucket = () => supabase().storage.from(DATA_BUCKET);

export async function listDatasets(): Promise<Dataset[]> {
  const me = await uid();
  const { data, error } = await bucket().list(me, { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
  if (error) throw new Error(error.message, { cause: error });
  return (data ?? [])
    .filter((f) => f.name && !f.name.startsWith("."))
    .map((f) => ({ name: f.name, size: Number((f.metadata as { size?: number } | null)?.size ?? 0), updatedAt: f.updated_at ?? f.created_at ?? "" }));
}

export function useDatasets() {
  return useSWR(KEY, listDatasets, { revalidateOnFocus: false });
}

/** Adds (or replaces) a file in the library under its own name. */
export async function addDataset(file: File, name = cleanDataName(file.name)): Promise<string> {
  if (!validDataName(name)) throw new FriendlyError("Give the file a plain name with an extension, like iris.csv.");
  if (file.size > DATA_FILE_MAX) throw new FriendlyError("That file is over 50 MB, the most one dataset can be.");
  const { error } = await bucket().upload(`${await uid()}/${name}`, file, { upsert: true, contentType: file.type || "application/octet-stream" });
  if (error) throw new FriendlyError(/row-level security|policy/i.test(error.message) ? "Your data library is full (250 MB). Remove a dataset to make room." : "Couldn’t add the file. Try again.");
  await mutate(KEY);
  return name;
}

export async function removeDataset(name: string): Promise<void> {
  const { error } = await bucket().remove([`${await uid()}/${name}`]);
  if (error) throw new FriendlyError("Couldn’t remove it. Try again.");
  await mutate(KEY);
}

/** Download addresses for these datasets (an hour), by name: for a run to fetch them into its folder. */
export async function signDatasets(names: readonly string[]): Promise<{ name: string; url: string }[]> {
  if (!names.length) return [];
  const me = await uid();
  const { data, error } = await bucket().createSignedUrls(names.map((n) => `${me}/${n}`), 3600);
  if (error) throw new Error(error.message, { cause: error });
  return (data ?? []).filter((r) => r.signedUrl && r.path).map((r) => ({ name: r.path!.slice(me.length + 1), url: r.signedUrl as string }));
}

export async function dataBytes(): Promise<number> {
  const { data } = await supabase().rpc("data_bytes");
  return typeof data === "number" ? data : 0;
}

/** Adds a file from a public https address (the server downloads it), then refreshes the list. */
export async function addDatasetFromUrl(url: string, name?: string): Promise<{ name: string; size: number }> {
  const got = await fetchToLibrary(url, name);
  await mutate(KEY);
  return got;
}

"use client";
// Run outputs in Supabase Storage (private bucket, owner-only RLS by folder):
// upload a finished run's files, sign URLs to show them, delete a replaced run's.
// The only module that talks to the run-outputs bucket.
import useSWR from "swr";
import { supabase } from "../supabase/client";
import { firstIssue } from "../schemas";
import { manifest as manifestSchema, MIME, OUTPUTS_BUCKET, outputDir, outputPath, outputPaths, type CapturedOutputs, type SavedOutputs } from "./outputs";

const bucket = () => supabase().storage.from(OUTPUTS_BUCKET);
const ext = (name: string) => name.slice(name.lastIndexOf(".") + 1);
const SIGNED_SECONDS = 60 * 60;

async function userId(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw Object.assign(new Error("no session for outputs"), { status: 401 });
  return id;
}

/** Uploads every output file of a run into a fresh folder; returns what the run record keeps. */
export async function uploadOutputs(snippetId: string, captured: CapturedOutputs): Promise<SavedOutputs> {
  const parsed = manifestSchema.safeParse(captured.manifest);
  if (!parsed.success) throw new Error(`Outputs don't match the contract: ${firstIssue(parsed.error)}`);
  const dir = outputDir(await userId(), snippetId, crypto.randomUUID());
  const names = parsed.data.items.flatMap((i) => Object.values(i.files) as string[]);
  await Promise.all(
    names.map(async (name) => {
      const data = captured.files[name];
      if (!data) throw new Error(`Output file ${name} is missing`);
      const { error } = await bucket().upload(outputPath(dir, name), data, { contentType: MIME[ext(name)] ?? "application/octet-stream", upsert: false });
      if (error) throw new Error(error.message, { cause: error });
    }),
  );
  return { ...parsed.data, dir };
}

/** Best effort: a replaced or cleared run's files. Failures only leave orphans in the user's own folder. */
export async function deleteOutputs(o: SavedOutputs | null | undefined): Promise<void> {
  if (!o) return;
  const paths = outputPaths(o);
  if (paths.length) await bucket().remove(paths);
}

/** Signed URLs for every file of a stored run, by file name. */
export async function signOutputs(o: SavedOutputs): Promise<Record<string, string>> {
  const paths = outputPaths(o);
  if (!paths.length) return {};
  const { data, error } = await bucket().createSignedUrls(paths, SIGNED_SECONDS);
  if (error) throw new Error(error.message, { cause: error });
  const urls: Record<string, string> = {};
  for (const row of data ?? []) if (row.signedUrl && row.path) urls[row.path.slice(o.dir.length + 1)] = row.signedUrl;
  return urls;
}

export function useOutputUrls(o: SavedOutputs | null | undefined) {
  return useSWR(o ? ["output-urls", o.dir] : null, () => signOutputs(o!), { revalidateOnFocus: false, dedupingInterval: (SIGNED_SECONDS - 300) * 1000 });
}

/** One stored file's bytes. */
export async function fetchOutput(o: SavedOutputs, name: string): Promise<Uint8Array> {
  const { data, error } = await bucket().download(outputPath(o.dir, name));
  if (error || !data) throw new Error(error?.message ?? "output download returned nothing", { cause: error ?? undefined });
  return new Uint8Array(await data.arrayBuffer());
}

/** Every file of a stored run (for the run archive). */
export async function fetchAllOutputs(o: SavedOutputs): Promise<Record<string, Uint8Array>> {
  const names = o.items.flatMap((i) => Object.values(i.files) as string[]);
  const entries = await Promise.all(names.map(async (n) => [n, await fetchOutput(o, n)] as const));
  return Object.fromEntries(entries);
}

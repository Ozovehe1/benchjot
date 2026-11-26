// Adds a file from a public https address to the caller's Data library (the Data page's "Add by
// address", and the Assistant's save_data tool). Stored as the caller, so the bucket's own rules
// (their folder, 50 MB a file, 250 MB in all) decide what goes in.
import { NextResponse } from "next/server";
import { z } from "zod";
import { cleanDataName, DATA_BUCKET, validDataName } from "@/lib/run/datasets-match";
import { FetchRefused, fetchPublic, nameFromUrl } from "@/lib/server/fetch-public";
import { apiError, jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 120;

const FILE_MAX = 50 * 1024 * 1024;

const body = z.object({ url: z.string().min(1).max(2048), name: z.string().max(120).optional() });

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => body.safeParse(v));
  if (input instanceof NextResponse) return input;
  const storage = session.db.storage;
  if (!storage) return apiError("server", 503);

  let got: Awaited<ReturnType<typeof fetchPublic>>;
  try {
    got = await fetchPublic(input.url.trim(), FILE_MAX);
  } catch (e) {
    if (e instanceof FetchRefused) return jsonError(400, e.message);
    console.error("data fetch failed", e);
    return apiError("server", 502);
  }
  const name = cleanDataName(input.name?.trim() || nameFromUrl(got.finalUrl));
  if (!validDataName(name)) return jsonError(400, "Give the file a plain name with an extension, like iris.csv.");

  const { error } = await storage.from(DATA_BUCKET).upload(`${session.userId}/${name}`, got.bytes, { upsert: true, contentType: got.type });
  if (error) {
    if (/row-level security|policy|quota/i.test(error.message)) return jsonError(400, "Your data library is full (250 MB). Remove a dataset to make room.");
    console.error("data store failed", error);
    return apiError("server", 503);
  }
  return NextResponse.json({ name, size: got.bytes.byteLength });
}

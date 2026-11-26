// GET /api/data/search — Find datasets: searches public data platforms at once (lib/server/data-sources.ts:
// Hugging Face, Zenodo, OpenML, Harvard Dataverse, figshare; no sign-in), or lists one dataset's data files.
//   ?q=titanic[&sources=hf,zenodo]   → { results: [{ source, id, title, detail, page }], missed: [sources that didn't answer] }
//   ?source=zenodo&id=7267888        → { files: [{ name, size, url }] }
// The browser's Data page and the Assistant's find_datasets use it; a file goes into the library through /api/data/fetch.
import { NextResponse } from "next/server";
import { filesOf, jsonGetter, searchAll, SOURCE_IDS, type SourceId } from "@/lib/server/data-sources";
import { apiError, jsonError, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const isSource = (s: string | null): s is SourceId => !!s && (SOURCE_IDS as string[]).includes(s);

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const source = url.searchParams.get("source");
  const id = url.searchParams.get("id")?.trim() ?? "";
  const get = jsonGetter();
  const headers = { "cache-control": "no-store" };
  try {
    if (id) {
      if (!isSource(source) || id.length > 200) return jsonError(400, "That isn’t a dataset this can open.");
      return NextResponse.json({ files: await filesOf(get, source, id) }, { headers });
    }
    if (!q || q.length > 200) return jsonError(400, "Type what to search for.");
    const asked = (url.searchParams.get("sources") ?? "").split(",").filter(isSource);
    return NextResponse.json(await searchAll(get, q, asked.length ? asked : SOURCE_IDS), { headers });
  } catch (e) {
    console.error("data search failed", e);
    return apiError("server", 502);
  }
}

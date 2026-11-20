// POST /api/share/refresh — the owner changed a link (locked it, made a new one, removed someone,
// changed what it shows): the cached shared page for that token is dropped at once, so the change
// holds for every visitor now instead of within the cache's half minute. Harmless for any token (it
// only empties a cache), so it asks only for a signed-in caller.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SHARE_TOKEN } from "@/lib/share/share";
import { shareTag } from "@/lib/server/shared-note";
import { readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => z.object({ tokens: z.array(z.string().regex(SHARE_TOKEN)).min(1).max(4) }).safeParse(v));
  if (input instanceof NextResponse) return input;
  for (const t of input.tokens) revalidateTag(shareTag(t));
  return new NextResponse(null, { status: 204 });
}

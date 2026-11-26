// POST /api/share/view — counts one view of a shared note. The page asks once per browser per day,
// after it has shown, so link previews and crawlers (which don't run it) aren't counted, and a
// popular link costs one small write per visitor per day.
import { NextResponse } from "next/server";
import { z } from "zod";
import { countView, visitorToken } from "@/lib/server/shared-note";
import { SHARE_TOKEN, isBot } from "@/lib/share/share";
import { readBody } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await readBody(request, (v) => z.object({ token: z.string().regex(SHARE_TOKEN) }).safeParse(v));
  if (input instanceof NextResponse) return input;
  if (!isBot(request.headers.get("user-agent"))) await countView(input.token, await visitorToken(request).catch(() => null)).catch(() => undefined);
  return new NextResponse(null, { status: 204 });
}

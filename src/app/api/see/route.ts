// POST /api/see — the seer (lib/ai/seer.ts): Claude looks at a run's figures, images,
// animations or charts and says what they show. The files are read from the user's own run-outputs
// folder with their own session (Storage RLS), never from a URL the client gives. Same model and
// allowance as the Assistant; one request for up to three pictures. Nothing is stored here:
// the browser keeps the words with the run.
import { NextResponse } from "next/server";
import { readSeerReply, seeRequest, seerPrompt, SEE_MAX_BYTES, SEER_RULES } from "@/lib/ai/seer";
import { MIME, OUTPUTS_BUCKET, outputPath } from "@/lib/run/outputs";
import { askVision, modelFrom } from "@/lib/server/llm";
import { jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => seeRequest.safeParse(v));
  if (input instanceof NextResponse) return input;
  if (!input.dir.startsWith(`${session.userId}/`)) return jsonError(403, "Not your run.");
  const storage = session.db.storage;
  if (!storage) return jsonError(500, "Storage isn't available.");
  const bucket = storage.from(OUTPUTS_BUCKET);
  const pictures = await Promise.all(
    input.items.map(async (it) => {
      const { data, error } = await bucket.download(outputPath(input.dir, it.file));
      if (error || !data || data.size > SEE_MAX_BYTES) return null;
      const ext = it.file.slice(it.file.lastIndexOf(".") + 1);
      return { item: it, url: `data:${MIME[ext] ?? "image/png"};base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}` };
    }),
  );
  const ready = pictures.filter((p) => p !== null);
  if (!ready.length) return NextResponse.json({ seen: [] });
  const items = ready.map((p) => p.item);
  return askVision(session, modelFrom(request), SEER_RULES, seerPrompt({ ...input, items }), ready, (reply) => readSeerReply(reply, items));
}

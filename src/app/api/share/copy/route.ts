// POST /api/share/copy — copies a shared note into the caller's own account (when its owner allows
// copies): copy_shared_note() makes the note and its cells; then each cell's figures and tables are
// copied from the shared note (readable only through the link) into the caller's own folder, so the
// copy shows what the original showed and stays theirs if the link is stopped. Answers the new note's id.
import { NextResponse } from "next/server";
import { z } from "zod";
import { MIME, OUTPUTS_BUCKET, outputDir, outputPath, savedOutputs, type SavedOutputs } from "@/lib/run/outputs";
import { linkStorage, visitorToken } from "@/lib/server/shared-note";
import { SHARE_TOKEN } from "@/lib/share/share";
import { jsonError, readBody, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Files bigger than this in all are left out of a copy (its text, code and printed output still come). */
const MAX_COPY_BYTES = 80 * 1024 * 1024;

const copied = z.object({ id: z.string().uuid(), cells: z.array(z.object({ id: z.string().uuid(), outputs: z.unknown().nullable().optional() })) });

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => z.object({ token: z.string().regex(SHARE_TOKEN, "That link isn't valid") }).safeParse(v));
  if (input instanceof NextResponse) return input;

  const { data, error } = await session.db.rpc("copy_shared_note", { t: input.token });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "P0002") return jsonError(404, "This note can’t be copied: its owner locked it, changed the link, or turned copying off.");
    console.error("copy_shared_note failed", error);
    return jsonError(500, "The note couldn’t be copied. Try again.");
  }
  const made = copied.parse(data);
  const from = linkStorage(input.token, await visitorToken(request)).from(OUTPUTS_BUCKET);
  const to = session.db.storage!.from(OUTPUTS_BUCKET);
  let budget = MAX_COPY_BYTES;

  for (const cell of made.cells) {
    const parsed = savedOutputs.safeParse(cell.outputs);
    if (!parsed.success) continue;
    const source: SavedOutputs = parsed.data;
    try {
      const dir = outputDir(session.userId, cell.id, crypto.randomUUID());
      const names = source.items.flatMap((i) => Object.values(i.files) as string[]);
      for (const name of names) {
        const { data: blob, error: readError } = await from.download(outputPath(source.dir, name));
        if (readError || !blob) throw new Error(readError?.message ?? "missing file");
        budget -= blob.size;
        if (budget < 0) throw new Error("copy too large");
        const ext = name.slice(name.lastIndexOf(".") + 1);
        const { error: writeError } = await to.upload(outputPath(dir, name), blob, { contentType: MIME[ext] ?? "application/octet-stream", upsert: false });
        if (writeError) throw new Error(writeError.message);
      }
      const { data: row } = await session.db.from!("cells").select("last_run").eq("id", cell.id).single();
      const lastRun = (row as { last_run: Record<string, unknown> | null } | null)?.last_run;
      if (lastRun) await session.db.from!("cells").update({ last_run: { ...lastRun, outputs: { ...source, dir } } }).eq("id", cell.id);
    } catch (e) {
      // The copy keeps its text, code and printed output; only this cell's figures are left out.
      console.error("copying a shared cell's files failed", e);
    }
  }
  return NextResponse.json({ id: made.id });
}

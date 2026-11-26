// note-search: the Assistant's search by meaning (find_notes). Runs as the signed-in user (their JWT,
// so RLS keeps everything to their own notes). Each call first embeds a few of their notes that are
// new or edited since their embedding (the gte-small model built into Supabase's Edge Runtime: no
// outside AI, no AI request counted), then answers one of:
//   { query }  -> their notes closest in meaning to the words
//   { note }   -> their notes closest in meaning to that note
// with [{ id, similarity }], most similar first. The text embedded per note: its title, its text
// (links read as their titles) and, per cell, its first comment, its notes and what the seer saw.
import { createClient } from "jsr:@supabase/supabase-js@2";

const session = new Supabase.ai.Session("gte-small");
const embed = async (text: string) => (await session.run(text, { mean_pool: true, normalize: true })) as number[];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/** Most notes embedded per call, and the model time they may take (the function's CPU limit is 2 s). */
const REFRESH = { notes: 12, ms: 900 } as const;
/** How alike a note must be to count: gte-small scores even unrelated text around 0.7. */
const MIN = { query: 0.78, note: 0.8 } as const;
const MAX_TEXT = 1800;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK = /\[\[([^\]|\n]+)(?:\|[0-9a-fA-F-]{36})?\]\]/g;

type Cell = { note_id: string; position: number; content: string; note_before: string; note_after: string; last_run: { outputs?: { items?: { seen?: string }[] } } | null };

/** A cell's first comment line: what it says it is for. */
function purpose(code: string): string {
  for (const line of code.split("\n").slice(0, 12)) {
    const m = /^\s*(?:#+|\/\/+|%+|!+|--)\s*(.{4,})$/.exec(line);
    if (m && !/^(pip|gpu|timeout|network)\s*:/i.test(m[1]!)) return m[1]!.trim();
  }
  return "";
}

/** The text a note is embedded as. */
export function noteText(title: string, body: string, cells: Cell[]): string {
  const parts = [title.trim(), body.replace(LINK, (_m, label: string) => label.trim()).trim()];
  for (const c of cells) {
    parts.push(purpose(c.content), c.note_before.trim(), c.note_after.trim());
    for (const it of c.last_run?.outputs?.items ?? []) if (it.seen) parts.push(it.seen);
  }
  return parts.filter(Boolean).join("\n").replace(/\s+\n/g, "\n").slice(0, MAX_TEXT);
}

async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("authorization");
  if (!auth) return json({ error: "Sign in first" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const input = (await req.json().catch(() => ({}))) as { query?: unknown; note?: unknown; count?: unknown };
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 500) : "";
  const note = typeof input.note === "string" && UUID.test(input.note) ? input.note : null;
  const count = typeof input.count === "number" && input.count > 0 ? Math.min(Math.floor(input.count), 20) : 8;

  // Catch up on notes that are new or edited since their embedding, newest first, while time allows.
  let refreshed = 0;
  const stale = await sb.rpc("stale_note_embeddings", { p_limit: REFRESH.notes });
  const due = (stale.data ?? []) as { id: string; embedded_hash: string | null }[];
  if (due.length) {
    const ids = due.map((d) => d.id);
    const [notes, cells] = await Promise.all([
      sb.from("notes").select("id, title, notes").in("id", ids),
      sb.from("cells").select("note_id, position, content, note_before, note_after, last_run").in("note_id", ids).order("position"),
    ]);
    let spent = 0;
    for (const d of due) {
      const n = (notes.data ?? []).find((x) => x.id === d.id);
      if (!n) continue;
      const text = noteText(n.title ?? "", n.notes ?? "", ((cells.data ?? []) as Cell[]).filter((c) => c.note_id === d.id));
      const hash = await sha256(text);
      const now = new Date().toISOString();
      if (hash === d.embedded_hash) {
        await sb.from("note_embeddings").update({ embedded_at: now }).eq("note_id", d.id);
        continue;
      }
      if (spent > REFRESH.ms) break;
      const t0 = performance.now();
      const embedding = await embed(text || "(empty note)");
      spent += performance.now() - t0;
      const { error } = await sb.from("note_embeddings").upsert({ note_id: d.id, embedding: JSON.stringify(embedding), source_hash: hash, embedded_at: now });
      if (error) console.error("embedding not saved", error.message);
      else refreshed++;
    }
  }

  let matches: { id: string; similarity: number }[] = [];
  if (query) {
    const r = await sb.rpc("match_notes", { p_embedding: JSON.stringify(await embed(query)), p_count: count, p_exclude: note, p_min: MIN.query });
    if (r.error) return json({ error: "Search failed" }, 500);
    matches = r.data ?? [];
  } else if (note) {
    const r = await sb.rpc("similar_notes", { p_note: note, p_count: count, p_min: MIN.note });
    if (r.error) return json({ error: "Search failed" }, 500);
    matches = r.data ?? [];
  }
  return json({ matches, refreshed, pending: Math.max(0, due.length - refreshed) });
});

// Server-side only: what every server run checks before it starts, shared by /api/run (the run
// waits in the request) and /api/runs (background runs): who is asking, the cell's directives, CPU
// or GPU (compute.ts), the daily GPU runs (GPU_RUNS, counted by run_take), and the caller's own
// dataset keys. Every account gets server runs and GPUs; only runs that get a GPU are counted.
import { hfRunToken } from "./hf-grant";
import { appOrigin } from "./huggingface";
import { NextResponse } from "next/server";
import { z } from "zod";
import { GPU_RUNS } from "@/config/app";
import { chooseCompute, computeNote } from "@/lib/run/compute";
import { datasetEnv, DirectiveError, LIMITS, parseDirectives, runsOnServer, SYNC_MAX_TIMEOUT_SEC, type Directives, type ServerLanguageId } from "@/lib/run/server-languages";
import { waitText } from "@/lib/ui/user-message";
import { DATA_BUCKET, datasetsIn, savesIn } from "@/lib/run/datasets-match";
import { apiError, jsonError, readBody, requireSession, type Session } from "./session";

const runBody = z.object({
  language: z.string().refine(runsOnServer, "This language doesn't run on the server"),
  code: z.string().min(1, "Nothing to run").max(LIMITS.maxCodeChars, "Code is too long"),
  /** Background runs: the cell, so a page opened later finds its run. */
  cellId: z.string().uuid().optional(),
});

interface PreparedRun {
  session: Session;
  language: ServerLanguageId;
  code: string;
  cellId?: string;
  directives: Directives;
  /** Where it runs, when chosen automatically (shown before the output); "" otherwise. */
  notice: string;
}

/**
 * Reads and checks a run request. `waits`: the run waits in the request (so at most
 * SYNC_MAX_TIMEOUT_SEC). Doesn't count a GPU run yet: takeGpuRun does, once nothing else refuses it.
 */
export async function prepareRun(request: Request, waits: boolean): Promise<PreparedRun | NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const input = await readBody(request, (v) => runBody.safeParse(v));
  if (input instanceof NextResponse) return input;
  if (!runsOnServer(input.language)) return jsonError(400, "This language doesn't run on the server");

  let directives: Directives;
  try {
    directives = parseDirectives(input.language, input.code);
  } catch (e) {
    if (e instanceof DirectiveError) return jsonError(400, e.message);
    throw e;
  }
  // No `# timeout:` line: the most a run may take (users shouldn't need to know the directive; like
  // Colab, a cell runs until it's done, and Stop is always there): an hour for a background run, the
  // waiting maximum for a run that waits.
  if (!directives.timeoutSet) directives = { ...directives, timeoutSec: defaultTimeoutSec(waits) };
  if (waits && directives.timeoutSec > SYNC_MAX_TIMEOUT_SEC) {
    return jsonError(400, `This run waits for its result, so it can be up to ${SYNC_MAX_TIMEOUT_SEC} s. Lower # timeout: to ${SYNC_MAX_TIMEOUT_SEC} or less.`);
  }
  // No `# gpu:` line: CPU or GPU from the code (compute.ts), and the run says which and why.
  let notice = "";
  if (directives.gpuChoice === "auto") {
    const choice = chooseCompute(input.language, input.code);
    directives = { ...directives, gpu: choice.gpu };
    notice = computeNote(choice);
  }
  return { session, language: input.language, code: input.code, cellId: input.cellId, directives, notice };
}

/** A run's time limit when the cell doesn't set one. */
function defaultTimeoutSec(waits: boolean): number {
  return waits ? SYNC_MAX_TIMEOUT_SEC : LIMITS.timeoutSec.max;
}

/**
 * A run that gets a GPU counts against the account's GPU runs for the day (GPU_RUNS.perDay in a
 * rolling 24 hours, run_take): refused with the wait once they're used, else null after counting it.
 * CPU runs aren't counted. Fails closed.
 */
export async function takeGpuRun(session: Session, d: Directives): Promise<NextResponse | null> {
  if (!d.gpu) return null;
  const { data: wait, error } = await Promise.resolve(session.db.rpc("run_take", { per_day: GPU_RUNS.perDay })).catch((e: unknown) => ({ data: null, error: e }));
  if (error || typeof wait !== "number" || !Number.isFinite(wait)) {
    console.error("run_take failed", error ?? `unexpected answer: ${JSON.stringify(wait)}`);
    return apiError("server", 503, "run_server");
  }
  if (wait > 0) return jsonError(429, `You’ve used today’s ${GPU_RUNS.perDay} GPU runs. More in ${waitText(wait)}. To run it now on the CPU, add # gpu: none at the top of the cell: its GPU calls (PyTorch, CuPy) move to the CPU, slower.`, wait);
  return null;
}

/**
 * Gives a GPU run back when the server couldn't run it (the sandbox didn't start, the provider
 * failed): the user's code never executed, so it isn't a run. Needs the server's RUN_REFUND_KEY
 * (run_refund checks it, so a user can't refund themselves); without it, or if the refund fails,
 * nothing changes. Never throws.
 */
export async function refundGpuRun(session: Session, d: Directives): Promise<void> {
  const key = process.env.RUN_REFUND_KEY;
  if (!d.gpu || !key) return;
  const r = await Promise.resolve(session.db.rpc("run_refund", { key })).catch((e: unknown) => ({ data: null, error: e }));
  if (r.error) console.error("run_refund failed", r.error);
}

/**
 * The run's environment: the caller's own Hugging Face token (renewed first when it expires soon),
 * BJ_DATA, the Data library files the code names (datasetsIn) with an hour's download address
 * each, which bj_capture.py fetches into the run's folder before the code starts, and BJ_SAVE, the
 * upload slots for files the code saves to the library (saveSlots).
 */
export async function runEnv(session: Session, request: Request, code = ""): Promise<Record<string, string>> {
  const env = datasetEnv({ hf_token: await hfRunToken(session, appOrigin(request)) });
  const files = await libraryFiles(session, code);
  const slots = await saveSlots(session, code);
  return { ...env, ...(files.length ? { BJ_DATA: JSON.stringify(files) } : {}), ...(/\bsave_data\(/.test(code) ? { BJ_SAVE: JSON.stringify(slots) } : {}) };
}

/**
 * Upload addresses (valid 2 hours, replacing a file of the same name) for the names the code passes
 * to save_data(...) (savesIn), so a server cell can put a file it made or downloaded into the caller's
 * Data library: bj_capture uploads to them. The bucket's own rules still apply (50 MB a file, the
 * account's quota). [] when there are none or signing fails (save_data then says so).
 */
export async function saveSlots(session: Session, code: string): Promise<{ name: string; url: string }[]> {
  const storage = session.db.storage;
  const names = code ? savesIn(code) : [];
  if (!storage || !names.length) return [];
  const bucket = storage.from(DATA_BUCKET);
  const out: { name: string; url: string }[] = [];
  for (const name of names) {
    try {
      const { data } = await bucket.createSignedUploadUrl(`${session.userId}/${name}`, { upsert: true });
      if (data?.signedUrl) out.push({ name, url: data.signedUrl });
    } catch (e) {
      console.error("data save slot failed", e);
    }
  }
  return out;
}

/** The caller's datasets that this code names, signed for download; [] when none (or storage fails: the run goes ahead and its open() says the file is missing). */
export async function libraryFiles(session: Session, code: string): Promise<{ name: string; url: string }[]> {
  const storage = session.db.storage;
  if (!storage || !code) return [];
  try {
    const bucket = storage.from(DATA_BUCKET);
    const { data } = await bucket.list(session.userId, { limit: 1000 });
    const names = datasetsIn(code, (data ?? []).map((f) => f.name).filter(Boolean));
    if (!names.length) return [];
    const signed = await bucket.createSignedUrls(names.map((n) => `${session.userId}/${n}`), 3600);
    return (signed.data ?? []).filter((r) => r.signedUrl && r.path).map((r) => ({ name: r.path!.slice(session.userId.length + 1), url: r.signedUrl as string }));
  } catch (e) {
    console.error("data library sign failed", e);
    return [];
  }
}

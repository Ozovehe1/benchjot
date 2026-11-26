"use client";
// Browser side of server runs, Fix and the Assistant: call the API routes, map answers to the
// same RunResult the in-browser runners give, so RunOutput shows both alike.
import { aiModel } from "@/lib/ai/model-choice";
import type { SeeReply, SeeRequest } from "../ai/seer";
import type { FixAnswer } from "../ai/fix";
import type { AgentReply, AgentRequest } from "../ai/agent";
import type { Outcome } from "../notes/outcome";
import type { ServerRunResponse } from "./server-languages";
import type { CapturedOutputs, Manifest } from "./outputs";
import type { RunHandle, RunResult, Stream } from "./types";
import { FriendlyError, userMessage } from "../ui/user-message";

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The server's inline outputs as the browser runner gives them (validated again before upload). */
export function serverOutputs(o: ServerRunResponse["outputs"]): CapturedOutputs | null {
  if (!o) return null;
  const files = Object.fromEntries(Object.entries(o.files).map(([k, v]) => [k, fromBase64(v)]));
  const manifest = o.manifest as Manifest;
  return manifest.items?.length ? { manifest, files } : null;
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-benchjot-model": aiModel() }, body: JSON.stringify(body), signal });
  return answer<T>(url, res);
}

/** Downloads a public https file into the caller's Data library (/api/data/fetch). Throws FriendlyError with the route's reason. */
export function fetchToLibrary(url: string, name?: string): Promise<{ name: string; size: number }> {
  return post<{ name: string; size: number }>("/api/data/fetch", { url, ...(name ? { name } : {}) });
}

/** A route's answer: its JSON, or the error it stands for (thrown). */
async function answer<T>(url: string, res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: unknown; code?: unknown; retryAfter?: unknown; offer?: unknown };
  if (!res.ok) {
    // The route's own text ("notice") shows as is; any other answer is classified by its code and status.
    // `offer` tells the screen what it can suggest: "hf" (Connect Hugging Face).
    if (data.code === "notice" && typeof data.error === "string") throw Object.assign(new FriendlyError(data.error), typeof data.offer === "string" ? { offer: data.offer } : {});
    const retryAfter = typeof data.retryAfter === "number" ? data.retryAfter : Number(res.headers.get("retry-after")) || undefined;
    throw Object.assign(new Error(`${url} answered ${res.status}`), { status: res.status, code: typeof data.code === "string" ? data.code : undefined, retryAfter });
  }
  return data;
}

export function toRunResult(r: ServerRunResponse): { chunks: { stream: Stream; text: string }[]; result: RunResult } {
  const failed = r.outcome !== "ok";
  const chunks = [
    { stream: "stderr" as const, text: r.notice ?? "" },
    { stream: "stdout" as const, text: r.stdout },
    ...(failed ? [] : [{ stream: "stderr" as const, text: r.stderr }]),
  ].filter((c) => c.text);
  const errorText = r.outcome === "timeout" ? r.stderr : r.stderr || `Exited with code ${r.exitCode}`;
  const outputs = serverOutputs(r.outputs);
  return { chunks, result: { outcome: r.outcome, error: failed ? { text: errorText, line: r.line } : null, ms: r.ms, ...(outputs ? { outputs } : {}) } };
}

/** Runs code on the server; output arrives in one piece when the run ends. */
export function runOnServer(language: string, code: string, onOutput: (stream: Stream, text: string) => void, onStatus: (s: string) => void): RunHandle {
  const abort = new AbortController();
  const started = Date.now();
  onStatus("Running on server…");
  const done = post<ServerRunResponse>("/api/run", { language, code }, abort.signal).then(
    (r) => {
      const { chunks, result } = toRunResult(r);
      for (const c of chunks) onOutput(c.stream, c.text);
      return result;
    },
    (e: Error): RunResult =>
      abort.signal.aborted ? { outcome: "stopped", error: null, ms: Date.now() - started } : { outcome: "error", error: { text: userMessage(e, "run_server"), line: null }, ms: Date.now() - started },
  );
  return { done, stop: () => abort.abort() };
}

/** A background run as GET /api/runs/[id] answers (src/lib/server/background-runs.ts RunState). */
export interface BackgroundRun {
  id: string;
  status: "running" | "done" | "stopped" | "failed";
  startedAt: string;
  limitSec: number;
  notice?: string;
  result?: ServerRunResponse | null;
  error?: string;
  /** While running: the phase, the seconds the code has run, its latest output line. */
  live?: { phase: "running" | "saving"; elapsedSec: number; line: string };
}

/**
 * What the cell says while a background run is going, so the user knows what the wait is:
 *   "Starting server · 0:25"                       the machine is being prepared (a GPU, a first use
 *                                                  or new packages take longer); the clock is the wait
 *   "Running · 0:42 · epoch 3: loss 0.412"         the code's own time and its latest line of output
 *   "Saving results…"                              the code is done; figures and output are coming back
 */
export function runStatusText(run: Pick<BackgroundRun, "startedAt" | "live">, now: number, liveAt: number | null, reconnecting = false): string {
  if (reconnecting) return `Reconnecting… · ${elapsedText(now - Date.parse(run.startedAt))}`;
  const live = run.live;
  if (!live || liveAt === null) return `Starting server · ${elapsedText(now - Date.parse(run.startedAt))}`;
  if (live.phase === "saving") return "Saving results…";
  const ran = live.elapsedSec * 1000 + (now - liveAt); // ticks on between checks
  return `Running · ${elapsedText(ran)}${live.line ? ` · ${live.line.length > 70 ? `${live.line.slice(0, 69)}…` : live.line}` : ""}`;
}

/** The line a finished background run adds about its time: how long the server took to be ready, and the code. */
export function timingNote(totalMs: number, codeMs: number): string {
  const wait = Math.max(0, totalMs - codeMs);
  const secs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : elapsedText(ms));
  return wait >= 5_000 ? `[Benchjot] Server ready in ${secs(wait)}; your code ran for ${secs(codeMs)}.\n` : "";
}

/** m:ss or h:mm:ss. */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** How long to wait before asking again: often at first, then less (a long run doesn't need it). */
export function pollDelay(elapsedMs: number): number {
  return elapsedMs < 60_000 ? 2_000 : elapsedMs < 10 * 60_000 ? 5_000 : 10_000;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** What a finished background run gives the page: its RunResult (with the run's id, to clear it once saved). */
function backgroundResult(run: BackgroundRun, onOutput: (stream: Stream, text: string) => void): RunResult {
  if (run.status === "stopped") return { outcome: "stopped", error: null, ms: Date.now() - Date.parse(run.startedAt), serverRunId: run.id };
  if (run.status === "failed" || !run.result) {
    return { outcome: "error", error: { text: run.error ?? "The server run ended without sending its result.", line: null }, ms: Date.now() - Date.parse(run.startedAt), serverRunId: run.id };
  }
  // First: where it ran (when chosen automatically) and how the time was spent.
  const timing = timingNote(Date.now() - Date.parse(run.startedAt), run.result.ms);
  const notice = `${run.notice ?? ""}${timing}`;
  const { chunks, result } = toRunResult({ ...run.result, ...(notice ? { notice } : {}) });
  for (const c of chunks) onOutput(c.stream, c.text);
  return { ...result, serverRunId: run.id };
}

/**
 * Follows a background run until it ends: asks GET /api/runs/[id] (pollDelay apart), shows
 * "Running on server · 4:12", keeps asking through dropped connections. Stop asks the server to
 * stop it. `first`: the run as last known (from starting it, or from the database).
 */
export function followBackgroundRun(first: BackgroundRun, onOutput: (stream: Stream, text: string) => void, onStatus: (s: string) => void): RunHandle {
  const abort = new AbortController();
  let stopRequested = false;
  const done = (async (): Promise<RunResult> => {
    let run = first;
    let failures = 0;
    let liveAt: number | null = first.live ? Date.now() : null; // when `run.live` was read, so the clock ticks between checks
    const show = () => onStatus(runStatusText(run, Date.now(), liveAt, failures > 0));
    const tick = setInterval(show, 1_000);
    abort.signal.addEventListener("abort", () => clearInterval(tick), { once: true });
    try {
    while (run.status === "running" && !abort.signal.aborted) {
      const elapsed = Date.now() - Date.parse(run.startedAt);
      show();
      await sleep(Math.min(pollDelay(elapsed), 1_000 + failures * 2_000), abort.signal);
      if (abort.signal.aborted) break;
      try {
        const res = await fetch(`/api/runs/${run.id}`, { signal: abort.signal, cache: "no-store" });
        if (res.status === 404) return { outcome: "error", error: { text: "This server run is no longer available.", line: null }, ms: elapsed };
        if (!res.ok) throw new Error(`status ${res.status}`);
        const next = (await res.json()) as BackgroundRun;
        // A check that couldn't read the sandbox keeps the last known progress (no flicker back to "Starting").
        run = next.status === "running" && !next.live && run.live ? { ...next, live: run.live } : next;
        if (next.live) liveAt = Date.now();
        failures = 0;
      } catch {
        if (abort.signal.aborted) break;
        failures = Math.min(failures + 1, 5);
      }
    }
    } finally {
      clearInterval(tick);
    }
    if (stopRequested) {
      const res = await fetch(`/api/runs/${run.id}`, { method: "DELETE" }).catch(() => null);
      const stopped = res?.ok ? ((await res.json()) as BackgroundRun) : { ...run, status: "stopped" as const };
      return backgroundResult(stopped, onOutput);
    }
    return backgroundResult(run, onOutput);
  })();
  return {
    done,
    stop: () => {
      stopRequested = true;
      abort.abort();
    },
  };
}

/** Starts a Python run in the background (POST /api/runs), then follows it. */
export function startBackgroundRun(language: string, code: string, cellId: string | undefined, onOutput: (stream: Stream, text: string) => void, onStatus: (s: string) => void): RunHandle {
  const started = Date.now();
  let inner: RunHandle | null = null;
  let stopped = false;
  onStatus("Preparing server…");
  const done = post<BackgroundRun>("/api/runs", { language, code, ...(cellId ? { cellId } : {}) }).then(
    (run) => {
      inner = followBackgroundRun(run, onOutput, onStatus);
      if (stopped) inner.stop();
      return inner.done;
    },
    (e: Error): RunResult => ({ outcome: "error", error: { text: userMessage(e, "run_server"), line: null }, ms: Date.now() - started }),
  );
  return {
    done,
    stop: () => {
      stopped = true;
      inner?.stop();
    },
  };
}

export function requestFix(language: string, code: string, error: string, outcome: Outcome | null = null): Promise<FixAnswer> {
  return post<FixAnswer>("/api/fix", { language, code, error, outcome });
}

/** One step of the voice agent: the calls to make next (lib/ai/agent.ts). */
export function requestAgentStep(body: AgentRequest, signal?: AbortSignal): Promise<AgentReply> {
  return post<AgentReply>("/api/agent", body, signal);
}

/** The seer (lib/ai/seer.ts): what a run's pictures show. */
export function requestSee(body: SeeRequest, signal?: AbortSignal): Promise<SeeReply> {
  return post<SeeReply>("/api/see", body, signal);
}



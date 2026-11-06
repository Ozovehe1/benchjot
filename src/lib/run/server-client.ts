"use client";
// Browser side of server runs, Fix and the Helper: call the API routes, map answers to the
// same RunResult the in-browser runners give, so RunOutput shows both alike.
import type { FixAnswer } from "../fix";
import type { HelperAnswer, HelperRequest } from "../helper";
import type { Outcome } from "../outcome";
import type { ServerRunResponse } from "./server-languages";
import type { CapturedOutputs, Manifest } from "./outputs";
import type { RunHandle, RunResult, Stream } from "./types";
import { FriendlyError, userMessage } from "../user-message";

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
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => ({}))) as T & { error?: unknown; code?: unknown; retryAfter?: unknown };
  if (!res.ok) {
    // The route's own text ("notice") shows as is; any other answer is classified by its code and status.
    if (data.code === "notice" && typeof data.error === "string") throw new FriendlyError(data.error);
    const retryAfter = typeof data.retryAfter === "number" ? data.retryAfter : Number(res.headers.get("retry-after")) || undefined;
    throw Object.assign(new Error(`${url} answered ${res.status}`), { status: res.status, code: typeof data.code === "string" ? data.code : undefined, retryAfter });
  }
  return data;
}

export function toRunResult(r: ServerRunResponse): { chunks: { stream: Stream; text: string }[]; result: RunResult } {
  const failed = r.outcome !== "ok";
  const chunks = [{ stream: "stdout" as const, text: r.stdout }, ...(failed ? [] : [{ stream: "stderr" as const, text: r.stderr }])].filter((c) => c.text);
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

export function requestFix(language: string, code: string, error: string, outcome: Outcome | null = null): Promise<FixAnswer> {
  return post<FixAnswer>("/api/fix", { language, code, error, outcome });
}

export function requestHelper(body: HelperRequest, signal?: AbortSignal): Promise<HelperAnswer> {
  return post<HelperAnswer>("/api/helper", body, signal);
}

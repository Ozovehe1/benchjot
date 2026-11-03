"use client";
// Browser side of server runs and Fix: call the API routes, map answers to the
// same RunResult the in-browser runners give, so RunOutput shows both alike.
import type { FixAnswer } from "../fix";
import type { Outcome } from "../outcome";
import type { ServerRunResponse } from "./server-languages";
import type { RunHandle, RunResult, Stream } from "./types";

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function toRunResult(r: ServerRunResponse): { chunks: { stream: Stream; text: string }[]; result: RunResult } {
  const failed = r.outcome !== "ok";
  const chunks = [{ stream: "stdout" as const, text: r.stdout }, ...(failed ? [] : [{ stream: "stderr" as const, text: r.stderr }])].filter((c) => c.text);
  const errorText = r.outcome === "timeout" ? r.stderr : r.stderr || `Exited with code ${r.exitCode}`;
  return { chunks, result: { outcome: r.outcome, error: failed ? { text: errorText, line: r.line } : null, ms: r.ms } };
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
      abort.signal.aborted ? { outcome: "stopped", error: null, ms: Date.now() - started } : { outcome: "error", error: { text: e.message, line: null }, ms: Date.now() - started },
  );
  return { done, stop: () => abort.abort() };
}

export function requestFix(language: string, code: string, error: string, outcome: Outcome | null = null): Promise<FixAnswer> {
  return post<FixAnswer>("/api/fix", { language, code, error, outcome });
}

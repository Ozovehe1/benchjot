// The latest run of a code block, as stored in snippets.last_run, and the
// conversions to and from what RunOutput shows. Pure: no browser or DB imports.
import type { LastRun } from "../schemas";
import type { RunResult, Stream } from "./types";

export type { LastRun };

export const MAX_SAVED_STREAM = 64 * 1024;

export interface Chunk {
  stream: Stream;
  text: string;
}

/** Keeps the first `max` characters and says how much was cut. */
export function truncate(text: string, max = MAX_SAVED_STREAM): string {
  if (text.length <= max) return text;
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  return `${text.slice(0, max)}\n[output truncated: saved the first ${kb(max)} of ${kb(text.length)}]\n`;
}

/** Fast, stable 53-bit hash (cyrb53) of the code, as hex. Used only to tell if code changed since a run. */
export function codeHash(code: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Builds the stored record from a finished run. */
export function toLastRun(chunks: Chunk[], result: RunResult, where: LastRun["where"], code: string, now = new Date()): LastRun {
  const join = (s: Stream) => chunks.filter((c) => c.stream === s).map((c) => c.text).join("");
  return {
    outcome: result.outcome,
    stdout: truncate(join("stdout")),
    stderr: truncate(join("stderr")),
    error_line: result.error ? truncate(result.error.text) : null,
    line: result.error?.line ?? null,
    ms: Math.max(0, Math.round(result.ms)),
    where,
    code_hash: codeHash(code),
    ran_at: now.toISOString(),
  };
}

/** What RunOutput shows for a stored run. */
export function fromLastRun(run: LastRun): { chunks: Chunk[]; result: RunResult } {
  const chunks: Chunk[] = [
    { stream: "stdout" as const, text: run.stdout },
    { stream: "stderr" as const, text: run.stderr },
  ].filter((c) => c.text);
  return {
    chunks,
    result: { outcome: run.outcome, error: run.error_line !== null ? { text: run.error_line, line: run.line } : null, ms: run.ms },
  };
}

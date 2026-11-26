// Server-side only: background server runs (rows in public.server_runs; supabase/migrations/
// 20261118030000_server_runs.sql). Shared by /api/runs (start), /api/runs/[id] (status, stop) and
// /api/runs/[id]/complete (the sandbox sending its result).
import { createHash, randomBytes } from "node:crypto";
import type { RunMeta, ServerRunResponse } from "@/lib/run/server-languages";

export type RunStatus = "running" | "done" | "stopped" | "failed";

/** A run as the page sees it (GET /api/runs/[id], and the start answer). */
interface RunState {
  id: string;
  status: RunStatus;
  startedAt: string;
  limitSec: number;
  notice?: string;
  /** When done: the run, until the page saves it as the cell's last run. */
  result?: ServerRunResponse | null;
  /** When failed: why. */
  error?: string;
  /** While running: what it is doing right now (absent until the machine has started the code). */
  live?: LiveStatus;
}

/** A run's progress as its sandbox reports it. */
interface LiveStatus {
  phase: "running" | "saving";
  /** Seconds the user's code has run. */
  elapsedSec: number;
  /** The code's latest line of output ("" when none yet). */
  line: string;
}

/** A sandbox's status file as a LiveStatus, or null when it isn't one (it's the sandbox's own text: never trusted). */
export function toLiveStatus(raw: unknown): LiveStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.phase !== "running" && o.phase !== "saving") return null;
  const elapsed = typeof o.elapsedSec === "number" && Number.isFinite(o.elapsedSec) && o.elapsedSec >= 0 ? o.elapsedSec : 0;
  const line = typeof o.line === "string" ? o.line.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160) : "";
  return { phase: o.phase, elapsedSec: elapsed, line };
}

/** Seconds past its time limit a run may take to send its result (image start, upload) before it counts as lost. */
const RESULT_GRACE_SEC = 300;

/** A run's one-time token (sent to its sandbox) and the hash kept in the database. */
export function newRunToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: tokenHash(token) };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Whether a still-"running" row is past the time its result could still arrive. */
export function overdue(startedAt: string, limitSec: number, now = Date.now()): boolean {
  return now > Date.parse(startedAt) + (limitSec + RESULT_GRACE_SEC) * 1000;
}

/** Where the app is reachable from a sandbox: APP_ORIGIN when set (a custom domain), else the request's own origin. */
export function appOrigin(request: Request): string {
  return (process.env.APP_ORIGIN ?? new URL(request.url).origin).replace(/\/+$/, "");
}

/** The database row's columns as a RunState. */
export function toRunState(row: {
  id: string;
  status: RunStatus;
  started_at: string;
  limit_sec: number;
  notice: string | null;
  result: unknown;
  error: string | null;
}): RunState {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    limitSec: row.limit_sec,
    ...(row.notice ? { notice: row.notice } : {}),
    ...(row.status === "done" ? { result: (row.result as ServerRunResponse | null) ?? null } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

export type { RunMeta };

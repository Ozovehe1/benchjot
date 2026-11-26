// A request the Assistant was in the middle of when the page was left (another note, a reload, the tab
// closed or killed in the background): kept on this device after every step, so opening the note again
// picks it up from that step instead of losing it. Browser storage only: it never leaves the device,
// and a request older than RESUME_HOURS is let go. Pure apart from localStorage, which may be missing.
import type { AgentCheckpoint, AgentUndo } from "./agent";
import type { AssistantHistory } from "./assistant";

/** A request kept to be picked up again. */
export type KeptRun = { v: 1; request: string; voice: boolean; at: string; undo: AgentUndo; history: AssistantHistory; mine: string[]; checkpoint: AgentCheckpoint; savedAt: string };

/** A request left longer than this isn't picked up again (what it did stays in the note, with Undo in its saved turn when it had finished). */
export const RESUME_HOURS = 6;

/** Why a request was stopped when the page was left (not the user's Stop): it is kept to go on. */
export const LEAVING = "leaving";

const key = (noteId: string) => `bj-agent-run:${noteId}`;

export function keepRun(noteId: string, run: Omit<KeptRun, "v" | "savedAt">, now = new Date()): void {
  try {
    localStorage.setItem(key(noteId), JSON.stringify({ v: 1, ...run, savedAt: now.toISOString() } satisfies KeptRun));
  } catch {
    // Storage full or blocked: the request still runs; it just can't be picked up again.
  }
}

/** The request kept for this note, if it is recent and reads back whole. */
export function keptRun(noteId: string, now = new Date()): KeptRun | null {
  try {
    const raw = localStorage.getItem(key(noteId));
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<KeptRun>;
    const fresh = typeof r.savedAt === "string" && now.getTime() - Date.parse(r.savedAt) < RESUME_HOURS * 3_600_000;
    const whole = r.v === 1 && typeof r.request === "string" && !!r.undo && !!r.checkpoint && Array.isArray(r.checkpoint.sent) && Array.isArray(r.mine) && !!r.history;
    if (fresh && whole) return r as KeptRun;
    localStorage.removeItem(key(noteId));
  } catch {
    // Unreadable: nothing to pick up.
  }
  return null;
}

export function dropRun(noteId: string): void {
  try {
    localStorage.removeItem(key(noteId));
  } catch {
    // Nothing kept, or storage blocked.
  }
}

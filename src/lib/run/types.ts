// Run contracts shared by the UI and the runners (no heavy imports here).
import type { CapturedOutputs } from "./outputs";

/** The user's code (and capturing its outputs); setup before it never counts. */
export const RUN_TIMEOUT_MS = 30_000;
/**
 * Python's setup before the code starts: Pyodide and the packages the code imports, downloaded
 * on the first run (about 40 MB for numpy + scikit-learn + matplotlib: ~5 min at 1 Mbps) and
 * imported. Past it the run fails with SETUP_TIMEOUT_TEXT rather than waiting forever.
 */
export const SETUP_TIMEOUT_MS = 10 * 60_000;
export const SETUP_TIMEOUT_TEXT = `Python packages didn't finish loading in ${SETUP_TIMEOUT_MS / 60_000} min. Check your connection and run again (what downloaded is kept).`;

export type Stream = "stdout" | "stderr";

export interface RunEvents {
  onStatus: (text: string) => void;
  onOutput: (stream: Stream, text: string) => void;
}

export interface RunResult {
  outcome: "ok" | "error" | "timeout" | "stopped";
  error: { text: string; line: number | null } | null;
  ms: number;
  /** Figures, tables and charts the run produced (Python), before upload. */
  outputs?: CapturedOutputs | null;
}

export interface RunHandle {
  done: Promise<RunResult>;
  stop: () => void;
}

/** Languages that run in the browser, for free. */
export const BROWSER_LANGUAGES = ["python", "javascript", "typescript"] as const;
export type BrowserLanguage = (typeof BROWSER_LANGUAGES)[number];

export function runsInBrowser(language: string): language is BrowserLanguage {
  return (BROWSER_LANGUAGES as readonly string[]).includes(language);
}

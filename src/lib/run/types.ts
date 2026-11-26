// Run contracts shared by the UI and the runners (no heavy imports here).
import type { CapturedOutputs, Logged } from "./outputs";

/**
 * Browser runs have no time limit by default (2026-11-18, like Colab and Jupyter): the code runs in
 * a worker, so the page stays responsive and Stop always works, and it costs nothing but the
 * device's own time. A cell may set one with `# timeout: 60`.
 * Only the user's code counts: not setup before it, nor drawing its figures and GIFs after it.
 */
const RUN_TIMEOUT_MS: number | null = null;
/** The longest `# timeout:` a browser run may ask for (a day). */
export const MAX_BROWSER_TIMEOUT_SEC = 86_400;

/** A browser run's time limit in ms from its `# timeout: N` line (seconds), or RUN_TIMEOUT_MS. */
export function browserTimeoutMs(code: string): number | null {
  const m = /^\s*#\s*timeout\s*:\s*(\S+)/im.exec(code);
  if (!m) return RUN_TIMEOUT_MS;
  const v = (m[1] ?? "").toLowerCase().replace(/s$/, "");
  if (["none", "off", "no"].includes(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_BROWSER_TIMEOUT_SEC) * 1000 : RUN_TIMEOUT_MS;
}
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
  /** Files the code passed to save_data(), for the Data library (browser Python). */
  onSaved?: (files: { name: string; data: Uint8Array }[]) => void;
}

export interface RunResult {
  outcome: "ok" | "error" | "timeout" | "stopped";
  error: { text: string; line: number | null } | null;
  ms: number;
  /** A background server run's id: the page clears its stored result once it saved the run. */
  serverRunId?: string;
  /** The limit a "timeout" run hit, in ms (the stop message says it). */
  limitMs?: number;
  /** Figures, tables and charts the run produced (Python), before upload. */
  outputs?: CapturedOutputs | null;
  /** What the code logged with log(), kept even when the run drew nothing (experiment tracking). */
  logged?: Logged | null;
  /**
   * The browser can't run this code (Python that needs TensorFlow, PyTorch, or an R package with
   * no browser build); nothing of it ran. Run sends it to the server instead.
   */
  needsServer?: boolean;
}

export interface RunHandle {
  done: Promise<RunResult>;
  stop: () => void;
}

/** Languages that run in the browser (Python in Pyodide, R in WebR); the same two run on the server. */
export const BROWSER_LANGUAGES = ["python", "r"] as const;
export type BrowserLanguage = (typeof BROWSER_LANGUAGES)[number];

export function runsInBrowser(language: string): language is BrowserLanguage {
  return (BROWSER_LANGUAGES as readonly string[]).includes(language);
}

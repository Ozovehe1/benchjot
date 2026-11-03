// Run contracts shared by the UI and the runners (no heavy imports here).

export const RUN_TIMEOUT_MS = 30_000;

export type Stream = "stdout" | "stderr";

export interface RunEvents {
  onStatus: (text: string) => void;
  onOutput: (stream: Stream, text: string) => void;
}

export interface RunResult {
  outcome: "ok" | "error" | "timeout" | "stopped";
  error: { text: string; line: number | null } | null;
  ms: number;
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

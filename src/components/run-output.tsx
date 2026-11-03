"use client";
import type { Chunk } from "@/lib/run/last-run";
import { RUN_TIMEOUT_MS, type RunResult } from "@/lib/run/types";
import { TextButton } from "./ui";

function summary(result: RunResult | null, running: boolean, status: string): string {
  if (running) return status || "Running…";
  if (!result) return "";
  const time = `${(result.ms / 1000).toFixed(2)} s`;
  switch (result.outcome) {
    case "ok":
      return time;
    case "error":
      return result.error?.line ? `Error on line ${result.error.line} · ${time}` : `Error · ${time}`;
    case "timeout":
      return `Stopped after ${RUN_TIMEOUT_MS / 1000} s (time limit)`;
    case "stopped":
      return `Stopped · ${time}`;
  }
}

/** Plain monospace output under a code block: stdout, stderr (muted), the error, then time. */
export function RunOutput({
  chunks,
  status,
  running,
  result,
  stale = false,
  note = null,
  onClear,
}: {
  chunks: Chunk[];
  status: string;
  running: boolean;
  result: RunResult | null;
  /** The code changed since this run. */
  stale?: boolean;
  /** A quiet line under the status, e.g. a save failure. */
  note?: string | null;
  onClear: () => void;
}) {
  const error = result?.error?.text;
  return (
    <section aria-label="Output" className="border-t border-line pt-2">
      {(chunks.length > 0 || error) && (
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">
          {chunks.map((c, i) => (
            <span key={i} className={c.stream === "stderr" ? "text-muted" : undefined}>
              {c.text}
            </span>
          ))}
          {error && <span>{error}</span>}
        </pre>
      )}
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-xs text-faint">
          <span role="status" aria-label="Run status">
            {summary(result, running, status)}
          </span>
          {stale && <span> · Output from an earlier version</span>}
        </span>
        {!running && (
          <TextButton onClick={onClear}>
            Clear
          </TextButton>
        )}
      </div>
      {note && <p className="pb-1 font-mono text-xs text-muted">{note}</p>}
    </section>
  );
}

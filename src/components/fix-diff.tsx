"use client";
// The proposed fix as a minimal line diff: only changed lines and one line of
// context around them. Accept replaces the code; Reject drops the proposal.
import { diffHunks, lineDiff } from "@/lib/fix";
import { cn } from "@/lib/format";
import { Button, TextButton } from "./ui";

const MARK = { same: " ", del: "−", add: "+" } as const;

export function FixDiff({ before, after, summary, onAccept, onReject }: { before: string; after: string; summary: string; onAccept: () => void; onReject: () => void }) {
  const hunks = diffHunks(lineDiff(before, after));
  return (
    <section aria-label="Proposed fix" className="border-t border-line pt-2">
      {summary && <p className="text-sm text-muted">{summary}</p>}
      {hunks.length === 0 ? (
        <p className="py-2 text-sm text-muted">No change suggested.</p>
      ) : (
        <pre className="mt-2 overflow-x-auto font-mono text-[12.5px] leading-relaxed">
          {hunks.map((h, i) =>
            h === null ? (
              <div key={i} className="text-faint">⋯</div>
            ) : (
              <div key={i} data-kind={h.kind} className={cn("flex", h.kind === "add" && "bg-tint text-fg", h.kind === "del" && "text-muted line-through decoration-faint", h.kind === "same" && "text-faint")}>
                <span aria-hidden className="w-9 shrink-0 select-none pr-2 text-right text-faint">{h.line}</span>
                <span aria-hidden className="w-4 shrink-0 select-none">{MARK[h.kind]}</span>
                <span className="whitespace-pre">{h.text || " "}</span>
              </div>
            ),
          )}
        </pre>
      )}
      <div className="mt-2 flex items-center gap-5">
        {hunks.length > 0 && <Button onClick={onAccept}>Accept fix</Button>}
        <TextButton onClick={onReject}>{hunks.length > 0 ? "Reject" : "Close"}</TextButton>
      </div>
    </section>
  );
}

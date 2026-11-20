"use client";
// The note's save status, quiet when all is well: "Saving…", "Saved". When a save fails it says
// so in place and offers Save now (it is also retried by itself, and as soon as the connection is back).
import { useSaveStatus } from "@/lib/ui/autosave";
import { cn } from "@/lib/ui/format";
import { Spinner } from "../ui";

export function SaveIndicator() {
  const { state, error, flushAll } = useSaveStatus();
  if (state === "error")
    return (
      <span role="status" aria-label="Save status" className="inline-flex items-center gap-2 text-xs text-fg" title={error ?? undefined}>
        <Dot className="bg-fail" />
        Not saved
        <button type="button" onClick={() => void flushAll()} className="-mx-1 min-h-8 rounded px-1 font-medium underline-offset-4 hover:bg-tint hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40">
          Save now
        </button>
      </span>
    );
  return (
    <span role="status" aria-label="Save status" className="inline-flex items-center gap-1.5 text-xs text-faint">
      {state === "saving" && <Spinner className="size-3" />}
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}
    </span>
  );
}

function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 rounded-full", className)} />;
}

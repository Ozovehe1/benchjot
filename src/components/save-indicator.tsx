"use client";
import { useSaveStatus } from "@/lib/autosave";

/** Quiet status: "Saved" after a save, "Not saved" on failure, nothing otherwise. */
export function SaveIndicator() {
  const { state, error } = useSaveStatus();
  const text = state === "saved" ? "Saved" : state === "error" ? "Not saved" : "";
  return (
    <span role="status" aria-label="Save status" title={error ?? undefined} className={state === "error" ? "text-xs text-fg" : "text-xs text-faint"}>
      {text}
    </span>
  );
}

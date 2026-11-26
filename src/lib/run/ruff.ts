"use client";
// Ruff (WASM) for Python lint and autofix. Loaded on first use; the 10 MB wasm
// is served from /vendor (copied at build time) and cached by the service worker.
import type { Diagnostic as RuffDiagnostic, Workspace } from "@astral-sh/ruff-wasm-web";
import { applyEdits, type Edit } from "./ruff-fix";

export type { RuffDiagnostic };

const SETTINGS = {
  "line-length": 100,
  "indent-width": 4,
  // Real problems only (pyflakes, syntax, bugbear); no style or import-order noise.
  lint: { select: ["E4", "E7", "E9", "F", "B"] },
};

let workspace: Promise<Workspace> | null = null;

function load(): Promise<Workspace> {
  workspace ??= (async () => {
    const ruff = await import("@astral-sh/ruff-wasm-web");
    await ruff.default({ module_or_path: "/vendor/ruff_wasm_bg.wasm" });
    return new ruff.Workspace(SETTINGS, ruff.PositionEncoding.Utf16);
  })();
  workspace.catch(() => (workspace = null));
  return workspace;
}

export async function ruffCheck(code: string): Promise<RuffDiagnostic[]> {
  return (await load()).check(code) as RuffDiagnostic[];
}

/** Applies every available fix, re-checking until nothing more is fixable (max 5 passes). */
export async function ruffFixAll(code: string): Promise<string> {
  let text = code;
  for (let pass = 0; pass < 5; pass++) {
    const edits: Edit[] = (await ruffCheck(text)).flatMap((d) => d.fix?.edits ?? []);
    if (!edits.length) break;
    const next = applyEdits(text, edits);
    if (next === text) break;
    text = next;
  }
  return text;
}

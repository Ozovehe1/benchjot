// JS/TS to plain JS for the worker, with sucrase (small, keeps line numbers).
// The same parse gives syntax diagnostics for the editor.
import { transform } from "sucrase";

export interface SyntaxIssue {
  message: string;
  line: number; // 1-based
  column: number; // 1-based
}

export type TranspileResult = { ok: true; code: string } | { ok: false; issue: SyntaxIssue };

export function transpile(code: string, language: "javascript" | "typescript"): TranspileResult {
  try {
    const out = transform(code, {
      transforms: language === "typescript" ? ["typescript"] : [],
      disableESTransforms: true,
      keepUnusedImports: true,
    });
    return { ok: true, code: out.code };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const m = /\((\d+):(\d+)\)\s*$/.exec(message);
    return {
      ok: false,
      issue: {
        message: message.replace(/\s*\(\d+:\d+\)\s*$/, ""),
        line: m ? Number(m[1]) : 1,
        column: m ? Number(m[2]) : 1,
      },
    };
  }
}

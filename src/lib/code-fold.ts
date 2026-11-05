// Long code blocks show folded (the user's rule, 2026-11-05): over FOLD_LINES lines, a block
// shows its first FOLD_LINES with a fade and a "Show all N lines" / "Show less" toggle.
// The same numbers on Android (core CodeFold.kt, checked by the code_fold.json fixture).

export const FOLD_LINES = 12;

export function lineCount(code: string): number {
  return code === "" ? 1 : code.split("\n").length;
}

export function folds(code: string): boolean {
  return lineCount(code) > FOLD_LINES;
}

export function foldLabel(code: string, open: boolean): string {
  return open ? "Show less" : `Show all ${lineCount(code)} lines`;
}

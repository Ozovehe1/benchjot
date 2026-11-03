// AI Fix, the pure parts: the prompt sent to Groq, reading its answer, and the
// minimal line diff the user accepts or rejects. No network here.
import { z } from "zod";
import { OUTCOMES, outcomeContext } from "./outcome";

export const FIX_LIMITS = { maxCodeChars: 50_000, maxErrorChars: 8_000 } as const;

export const fixRequest = z.object({
  language: z.string().min(1).max(40),
  code: z.string().min(1, "Nothing to fix").max(FIX_LIMITS.maxCodeChars, "Code is too long to fix"),
  error: z.string().min(1, "Run it first: Fix needs the error").max(FIX_LIMITS.maxErrorChars * 4),
  /** The note's outcome, as context. */
  outcome: z.enum(OUTCOMES).nullable().optional(),
});
export type FixRequest = z.infer<typeof fixRequest>;

export const fixAnswer = z.object({
  code: z.string(),
  summary: z.string().max(400).default(""),
});
export type FixAnswer = z.infer<typeof fixAnswer>;

const SYSTEM = [
  "You fix one bug in a code snippet given the error it produced.",
  "Change as few lines as possible. Keep the author's style, names, comments and formatting.",
  "Do not refactor, reformat, add features or add explanations inside the code.",
  'Reply with JSON only: {"code": "<the whole corrected file>", "summary": "<one short sentence saying what you changed>"}.',
].join(" ");

/** Chat messages for the model. Long errors keep their tail (where the cause is). */
export function fixMessages({ language, code, error, outcome }: FixRequest) {
  const err = error.length > FIX_LIMITS.maxErrorChars ? error.slice(-FIX_LIMITS.maxErrorChars) : error;
  const context = outcomeContext(outcome);
  return [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: `Language: ${language}\n${context ? `${context}\n` : ""}\nCode:\n\`\`\`\n${code}\n\`\`\`\n\nError:\n\`\`\`\n${err}\n\`\`\`` },
  ];
}

/** Reads the model's JSON reply (tolerating a ```json fence). Throws on anything else. */
export function parseFixAnswer(content: string): FixAnswer {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = fixAnswer.parse(JSON.parse(text));
  return { ...parsed, code: parsed.code.replace(/\r\n/g, "\n") };
}

export type DiffOp = { kind: "same" | "del" | "add"; text: string };

/** Line diff by longest common subsequence. Falls back to delete-all/add-all on huge inputs. */
export function lineDiff(before: string, after: string): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i++]! });
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) ops.push({ kind: "del", text: a[i++]! });
    else ops.push({ kind: "add", text: b[j++]! });
  }
  while (i < n) ops.push({ kind: "del", text: a[i++]! });
  while (j < m) ops.push({ kind: "add", text: b[j++]! });
  return ops;
}

export interface DiffLine extends DiffOp {
  /** Line number in the old code (same/del) or new code (add). */
  line: number;
}

/**
 * Only the changed lines plus `context` unchanged lines around each change;
 * `null` marks a gap between hunks. Empty when nothing changed.
 */
export function diffHunks(ops: DiffOp[], context = 1): (DiffLine | null)[] {
  const numbered: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const op of ops) {
    if (op.kind !== "add") oldLine++;
    if (op.kind !== "del") newLine++;
    numbered.push({ ...op, line: op.kind === "add" ? newLine : oldLine });
  }
  const keep = numbered.map(() => false);
  numbered.forEach((op, k) => {
    if (op.kind === "same") return;
    for (let x = Math.max(0, k - context); x <= Math.min(numbered.length - 1, k + context); x++) keep[x] = true;
  });
  const out: (DiffLine | null)[] = [];
  numbered.forEach((op, k) => {
    if (keep[k]) out.push(op);
    else if (out.length && out[out.length - 1] !== null && keep.slice(k).some(Boolean)) out.push(null);
  });
  return out;
}

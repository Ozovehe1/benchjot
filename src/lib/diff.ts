import { diffLines } from "diff";

export type DiffLine = { type: "add" | "del" | "same"; text: string };

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
}

/** Line-level diff from `before` to `after`. */
export function lineDiff(before: string, after: string): DiffResult {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const type = part.added ? "add" : part.removed ? "del" : "same";
    const chunk = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    for (const text of chunk.split("\n")) {
      lines.push({ type, text });
      if (type === "add") added++;
      if (type === "del") removed++;
    }
  }
  return { lines, added, removed };
}

/**
 * Collapse long unchanged stretches, keeping `context` lines around changes.
 * Collapsed stretches are returned as { type: "skip", count }.
 */
export type HunkLine = DiffLine | { type: "skip"; count: number };

export function withContext(lines: DiffLine[], context = 3): HunkLine[] {
  const keep = lines.map((l) => l.type !== "same");
  const near = lines.map((_, i) => {
    for (let d = -context; d <= context; d++) if (keep[i + d]) return true;
    return false;
  });
  const out: HunkLine[] = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (near[i]) {
      if (skipped) out.push({ type: "skip", count: skipped });
      skipped = 0;
      out.push(line);
    } else skipped++;
  });
  if (skipped) out.push({ type: "skip", count: skipped });
  return out;
}

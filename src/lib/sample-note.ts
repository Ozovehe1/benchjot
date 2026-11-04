// The example note on the signed-out home page, shaped like a real saved note:
// a title, a body, and one Python code block with its saved latest run.
// tests/note-preview.test.tsx checks the hash and that the saved output is what
// the code prints. Type-only imports: the Android repo's scripts/web-fixtures.mjs
// loads this file with plain Node, and the Android landing shows the same note.
import type { Entry, Snippet } from "./schemas";

const code = `acc = {0.1: [91.8, 92.4, 92.1],
       0.3: [90.9, 90.7, 91.1]}
for p, r in acc.items():
    print(p, round(sum(r) / len(r), 1))`;

export const SAMPLE_ENTRY: Pick<Entry, "title" | "notes"> = {
  title: "Exp 3: dropout 0.1 vs 0.3",
  notes: "Lower dropout should help on the small set. Mean accuracy over three seeds:",
};

export const SAMPLE_SNIPPETS: Pick<Snippet, "id" | "filename" | "language" | "content" | "last_run">[] = [
  {
    id: "sample-dropout",
    filename: "dropout.py",
    language: "python",
    content: code,
    last_run: {
      outcome: "ok",
      stdout: "0.1 92.1\n0.3 90.9\n",
      stderr: "",
      error_line: null,
      line: null,
      ms: 42,
      where: "browser",
      code_hash: "e5852ecfac5c2", // codeHash(code)
      ran_at: "2026-11-04T09:00:00.000Z",
    },
  },
];

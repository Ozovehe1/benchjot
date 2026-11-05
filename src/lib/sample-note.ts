// The example note on the signed-out home page, shaped like a real saved note:
// a title, a body, its outcome, and one Python code block with its saved latest run.
// The run is real: scripts/sample-note/make.py runs experiment.py through bj_capture.py
// and writes sample-run.json (code + run record) and its files into public/sample-outputs/,
// which the landing serves as they are (no Storage). tests/note-preview.test.tsx checks it.
// Type-only imports: the Android repo's scripts/web-fixtures.mjs loads this file with plain
// Node, and the Android landing shows the same note (bundling the same files).
import type { Entry, LastRun, Snippet } from "./schemas";
import run from "./sample-run.json" with { type: "json" };

/** Where the sample's output files are served from (public/sample-outputs). */
export const SAMPLE_OUTPUTS_BASE = "/sample-outputs";

export const SAMPLE_ENTRY: Pick<Entry, "title" | "notes" | "outcome"> = {
  title: "Digits: logistic regression vs random forest",
  notes: [
    "**Goal** Pick a baseline for the 8×8 handwritten digits set (1,797 images, 10 classes).",
    "**Setup** Stratified 75/25 split, seed 0, pixels scaled to 0–1. Logistic regression vs a 200-tree random forest.",
    "**Result** The forest wins: 0.987 test accuracy vs 0.969. Both find 8 the hardest digit (F1 0.966 vs 0.905). Keep the forest as the baseline.",
  ].join("\n\n"),
  outcome: "success",
};

export const SAMPLE_SNIPPETS: Pick<Snippet, "id" | "filename" | "language" | "content" | "last_run">[] = [
  {
    id: "sample-digits",
    filename: "digits.py",
    language: "python",
    content: run.code,
    last_run: run.last_run as LastRun,
  },
];

const sampleOutputs = run.last_run.outputs;

/** Each of the sample's output files by name, as served from public/sample-outputs. */
export const SAMPLE_OUTPUT_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  sampleOutputs.items.flatMap((i) => (Object.values(i.files) as (string | undefined)[]).filter((n): n is string => Boolean(n))).map((n) => [n, `${SAMPLE_OUTPUTS_BASE}/${n}`]),
);

// The example note on the signed-out home page: a real note with two Python cells and their saved
// runs, copied as they ran (2026-11-18, on a CPU and a GPU; scripts/sample-note/README.md). sample-run.json holds
// each cell's code, note before the run and run record; the run's files are in
// public/sample-outputs/<cell>/ (checked against public/sample-outputs/SHA256SUMS), served as they
// are (no Storage). tests/note-preview.test.tsx checks it.
// Type-only imports, so the file also loads with plain Node.
import type { Note, LastRun, Cell } from "./notes/schemas";
import run from "./sample-run.json" with { type: "json" };

/** Where the sample's output files are served from (public/sample-outputs/<cell>/). */
export const SAMPLE_OUTPUTS_BASE = "/sample-outputs";

export const SAMPLE_NOTE: Pick<Note, "title" | "notes" | "outcome"> = {
  title: "Do 4 layers beat 2? Balls vs handwritten digits",
  notes: [
    "**Question** Does a 4-layer network beat a 2-layer one? On a simple task (red/blue balls), on a hierarchical one (handwritten digits), and on data the networks never saw.",
    "**Setup** Each 4-layer net is compared with a 2-layer net of the same width and one with the same number of weights; digits also get a 4-layer convolutional net. Same optimiser and number of weight updates; each net's learning rate chosen on validation; 10 seeds; Welch's t-test.",
    "**Result** On familiar data, depth makes no real difference once the nets are the same size. Under shift (moved digits, another dataset) 4 dense layers do slightly better than 2. The large gains come from convolution: +18 points on shifted digits, +4.7 on USPS. No network extrapolates the spiral.",
  ].join("\n\n"),
  outcome: "success",
};

const NOTES_AFTER: Record<string, string> = {
  balls:
    "Partly right. Moons: no difference. Spirals: 4 layers beat the small 2-layer net (1.000 vs 0.863), but a 2-layer net with the same weights nearly ties (0.997). Wrong about extrapolation: every net fails on the outer arm (about 0.2).",
  digits:
    "Mostly right. The dense nets tie on new writers (0.978–0.979); the convolutional net leads on shifted digits (0.70 vs 0.52) and USPS (0.93 vs 0.89). Missed: 4 dense layers beat 2 under shift, and the convolutional net is worse on noisy digits (0.85 vs 0.94).",
};

type SampleCell = (typeof run.cells)[number];

/** The run's own messages, without the app's bracketed notes about the machine it ran on then. */
const ownOutput = (stderr: string) => stderr.replace(/^\[Benchjot\][^\n]*\n/gm, "");

/** Whether each cell's run used a GPU (from the run's record), in the same order as SAMPLE_CELLS. */
export const SAMPLE_USED_GPU: readonly boolean[] = run.cells.map((c: SampleCell) => /Ran on an? \w+ GPU/.test(c.last_run.stderr));

/** The note's code cells, in order, shaped like saved cells. */
export const SAMPLE_CELLS: Pick<Cell, "id" | "filename" | "language" | "content" | "last_run" | "note_before" | "note_after">[] = run.cells.map((c: SampleCell) => ({
  id: `sample-${c.id}`,
  filename: c.filename,
  language: "python",
  content: c.code,
  last_run: { ...(c.last_run as LastRun), stderr: ownOutput(c.last_run.stderr) },
  note_before: c.note_before,
  note_after: NOTES_AFTER[c.id] ?? "",
}));

/** Each cell's output folder name, in the same order as SAMPLE_CELLS. */
export const SAMPLE_CELL_IDS: readonly string[] = run.cells.map((c: SampleCell) => c.id);

/** Each cell's output files by name, as served from public/sample-outputs/<cell>/. */
export const SAMPLE_OUTPUT_URLS: readonly Readonly<Record<string, string>>[] = run.cells.map((c: SampleCell) =>
  Object.fromEntries(
    c.last_run.outputs.items
      .flatMap((i) => Object.values(i.files) as (string | undefined)[])
      .filter((n): n is string => Boolean(n))
      .map((n) => [n, `${SAMPLE_OUTPUTS_BASE}/${c.id}/${n}`]),
  ),
);

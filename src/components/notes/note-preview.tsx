// A note shown read-only, built from the note screen's own pieces: the title
// type, the outcome row, the rendered body, the code block header, highlighted code,
// the saved output panel and its figures, tables and charts, and each cell's notes
// ("Note before run" above, "Note after run" below its output; empty ones show nothing). No inputs, no Run, no
// data access; it renders on the server, so it ships no editor or runtime code.
// Each cell's outputs come from its own `outputs` note (bundled files for the landing). Parts carry
// data-cell / data-part so the landing's tour can point at them. Tables show all their rows.
import { LANGUAGES } from "@/lib/code/languages";
import { OUTCOME_LABEL } from "@/lib/notes/outcome";
import { fromLastRun } from "@/lib/run/last-run";
import type { Note, Cell } from "@/lib/notes/schemas";
import { cn } from "@/lib/ui/format";
import { FoldedCode } from "../code/folded-code";
import { CellNoteText, NOTE_META_ROW_CLASS, NOTE_TITLE_CLASS, RenderedBody, CELL_FRAME } from "./note-parts";
import { RunOutput } from "../outputs/run-output";
import { RunOutputs } from "../outputs/run-outputs";
import { CellHeader } from "../code/cell-header";
import { StaticCode } from "../code/static-code";

// Cell notes are optional so a note without them (the landing's sample) needs no empty fields.
type PreviewCell = Pick<Cell, "id" | "filename" | "language" | "content" | "last_run"> & Partial<Pick<Cell, "note_before" | "note_after">>;
type Outputs = { urls: Readonly<Record<string, string>>; hrefs: readonly string[] | null };

export function NotePreview({
  note,
  cells,
  outputs = [],
  showCode = true,
}: {
  note: Pick<Note, "title" | "notes" | "outcome">;
  cells: readonly PreviewCell[];
  outputs?: readonly Outputs[];
  /** False for a note shared with its results only: each cell shows its notes and what it made, not its code. */
  showCode?: boolean;
}) {
  return (
    <>
      <div data-part="question">
        <h2 className={cn(NOTE_TITLE_CLASS, "break-words")}>{note.title}</h2>
        {note.outcome && (
          <div className={NOTE_META_ROW_CLASS} data-part="outcome">
            <span>Outcome</span>
            <span className="inline-flex min-h-12 items-center text-fg">{OUTCOME_LABEL[note.outcome]}</span>
          </div>
        )}
        <RenderedBody value={note.notes} reserve={false} />
      </div>
      <section aria-label="Code" className="mt-10">
        {cells.map((s, i) => (
          <CellView key={s.id} cell={s} index={i} outputs={outputs[i] ?? NO_OUTPUTS} showCode={showCode} />
        ))}
      </section>
    </>
  );
}

const NO_OUTPUTS: Outputs = { urls: {}, hrefs: null };

function CellView({ cell, index, outputs, showCode }: { cell: PreviewCell; index: number; outputs: Outputs; showCode: boolean }) {
  const label = LANGUAGES.find((l) => l.id === cell.language)?.label ?? cell.language;
  const run = cell.last_run ? fromLastRun(cell.last_run) : null;
  const manifest = cell.last_run?.outputs;
  return (
    <div className={CELL_FRAME} data-cell={index}>
      <div data-part="before">
        <CellNoteText side="before" value={cell.note_before ?? ""} filename={cell.filename} index={index} />
      </div>
      <div data-part="code">
        <CellHeader filename={cell.filename} language={<span className="-ml-1 px-1">{label}</span>} />
        {showCode ? (
          <FoldedCode code={cell.content}>
            <StaticCode code={cell.content} language={cell.language} label={`Code ${index + 1}`} />
          </FoldedCode>
        ) : (
          <p className="pb-2 text-xs text-faint">The author shared the results, not the code.</p>
        )}
      </div>
      {run && (
        <div data-part="run">
          <RunOutput chunks={run.chunks} status="" running={false} result={run.result} />
        </div>
      )}
      {manifest && (
        <div data-part="outputs">
          <RunOutputs manifest={manifest} urls={outputs.urls} hrefs={outputs.hrefs} tableRows={Number.POSITIVE_INFINITY} />
        </div>
      )}
      <div data-part="after">
        <CellNoteText side="after" value={cell.note_after ?? ""} filename={cell.filename} index={index} />
      </div>
    </div>
  );
}

// A note shown read-only, built from the note screen's own pieces: the title
// type, the outcome row, the rendered body, the code block header, highlighted code,
// the saved output panel and its figures, tables and charts. No inputs, no Run, no
// data access; it renders on the server, so it costs no editor or runtime JavaScript.
// Outputs come from `outputUrls` (bundled files for the landing) and open at `outputHref(i)`.
import { LANGUAGES } from "@/lib/languages";
import { OUTCOME_LABEL } from "@/lib/outcome";
import { fromLastRun } from "@/lib/run/last-run";
import type { Entry, Snippet } from "@/lib/schemas";
import { cn } from "@/lib/format";
import { FoldedCode } from "./folded-code";
import { NOTE_META_ROW_CLASS, NOTE_TITLE_CLASS, RenderedBody } from "./note-parts";
import { RunOutput } from "./run-output";
import { RunOutputs } from "./run-outputs";
import { SnippetHeader } from "./snippet-header";
import { StaticCode } from "./static-code";

type PreviewSnippet = Pick<Snippet, "id" | "filename" | "language" | "content" | "last_run">;
type Outputs = { urls: Readonly<Record<string, string>>; hrefs: readonly string[] | null };

export function NotePreview({
  entry,
  snippets,
  outputs = { urls: {}, hrefs: null },
}: {
  entry: Pick<Entry, "title" | "notes" | "outcome">;
  snippets: readonly PreviewSnippet[];
  outputs?: Outputs;
}) {
  return (
    <>
      <h2 className={cn(NOTE_TITLE_CLASS, "break-words")}>{entry.title}</h2>
      {entry.outcome && (
        <div className={NOTE_META_ROW_CLASS}>
          <span>Outcome</span>
          <span className="inline-flex min-h-12 items-center text-fg">{OUTCOME_LABEL[entry.outcome]}</span>
        </div>
      )}
      <RenderedBody value={entry.notes} reserve={false} />
      <section aria-label="Code" className="mt-10">
        {snippets.map((s, i) => (
          <SnippetView key={s.id} snippet={s} index={i} outputs={outputs} />
        ))}
      </section>
    </>
  );
}

function SnippetView({ snippet, index, outputs }: { snippet: PreviewSnippet; index: number; outputs: Outputs }) {
  const label = LANGUAGES.find((l) => l.id === snippet.language)?.label ?? snippet.language;
  const run = snippet.last_run ? fromLastRun(snippet.last_run) : null;
  const manifest = snippet.last_run?.outputs;
  return (
    <div className="border-t border-line">
      <SnippetHeader filename={snippet.filename} language={<span className="-ml-1 px-1">{label}</span>} />
      <FoldedCode code={snippet.content}>
        <StaticCode code={snippet.content} language={snippet.language} label={`Code ${index + 1}`} />
      </FoldedCode>
      {run && <RunOutput chunks={run.chunks} status="" running={false} result={run.result} />}
      {manifest && <RunOutputs manifest={manifest} urls={outputs.urls} hrefs={outputs.hrefs} />}
    </div>
  );
}

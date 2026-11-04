// A note shown read-only, built from the note screen's own pieces: the title
// type, the rendered body, the code block header, highlighted code and the
// saved output panel. No inputs, no Run, no data access, and it renders on
// the server, so it costs no editor or runtime JavaScript.
import { LANGUAGES } from "@/lib/languages";
import { fromLastRun } from "@/lib/run/last-run";
import type { Entry, Snippet } from "@/lib/schemas";
import { cn } from "@/lib/format";
import { NOTE_TITLE_CLASS, RenderedBody } from "./note-parts";
import { RunOutput } from "./run-output";
import { SnippetHeader } from "./snippet-header";
import { StaticCode } from "./static-code";

type PreviewSnippet = Pick<Snippet, "id" | "filename" | "language" | "content" | "last_run">;

export function NotePreview({ entry, snippets }: { entry: Pick<Entry, "title" | "notes">; snippets: readonly PreviewSnippet[] }) {
  return (
    <>
      <h2 className={cn(NOTE_TITLE_CLASS, "break-words")}>{entry.title}</h2>
      <RenderedBody value={entry.notes} />
      <section aria-label="Code" className="mt-10">
        {snippets.map((s, i) => (
          <SnippetView key={s.id} snippet={s} index={i} />
        ))}
      </section>
    </>
  );
}

function SnippetView({ snippet, index }: { snippet: PreviewSnippet; index: number }) {
  const label = LANGUAGES.find((l) => l.id === snippet.language)?.label ?? snippet.language;
  const run = snippet.last_run ? fromLastRun(snippet.last_run) : null;
  return (
    <div className="border-t border-line">
      <SnippetHeader filename={snippet.filename} language={<span className="-ml-1 px-1">{label}</span>} />
      <StaticCode code={snippet.content} language={snippet.language} label={`Code ${index + 1}`} />
      {run && <RunOutput chunks={run.chunks} status="" running={false} result={run.result} />}
    </div>
  );
}

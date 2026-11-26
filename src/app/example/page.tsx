import type { Metadata } from "next";
import { NotePreview } from "@/components/notes/note-preview";
import { SampleNoteTag } from "@/components/notes/note-parts";
import { SiteFooter } from "@/components/app/site-footer";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { sampleOutputPath } from "@/lib/web/paths";
import { SAMPLE_CELLS, SAMPLE_NOTE, SAMPLE_OUTPUT_URLS } from "@/lib/sample-note";

export const metadata: Metadata = { title: "A real note · Benchjot" };

const OUTPUTS = SAMPLE_CELLS.map((s, cell) => ({
  urls: SAMPLE_OUTPUT_URLS[cell] ?? {},
  hrefs: (s.last_run?.outputs?.items ?? []).map((_, i) => sampleOutputPath(cell, i)),
}));

// The landing's sample note, whole: both experiments, their code, runs, tables and figures, as they ran.
export default function ExampleNote() {
  const ran = SAMPLE_CELLS[0]?.last_run?.ran_at;
  return (
    <div className="mx-auto w-full max-w-[860px] px-5">
      <header className="flex h-16 items-center justify-between">
        <Logo />
        <TextLink href="/login" strong>Sign in</TextLink>
      </header>
      <main className="pb-16">
        <p className="mt-4 flex items-center gap-3 text-[13px] text-muted">
          <SampleNoteTag />
          A real run{ran ? ` · ${new Date(ran).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}
        </p>
        <div className="mt-6">
          <NotePreview note={SAMPLE_NOTE} cells={SAMPLE_CELLS} outputs={OUTPUTS} />
        </div>
        <div className="mt-14 flex flex-col items-start gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] text-muted">Keep your own experiments like this.</p>
          <ButtonLink href="/login?mode=signup" className="w-full sm:w-auto">Create account</ButtonLink>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

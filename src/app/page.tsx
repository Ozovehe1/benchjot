import { NoteList } from "@/components/notes/note-list";
import { SampleNoteTag } from "@/components/notes/note-parts";
import { NotePreview } from "@/components/notes/note-preview";
import { ProductTour, type TourCell, type TourStep } from "@/components/app/product-tour";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { APP_DESCRIPTION } from "@/config/app";
import { AndroidDownload } from "@/components/account/android-download";
import { sampleOutputPath } from "@/lib/web/paths";
import { SAMPLE_NOTE, SAMPLE_OUTPUT_URLS, SAMPLE_CELLS, SAMPLE_USED_GPU } from "@/lib/sample-note";
import { isSignedIn, setupPending } from "@/lib/server/account";
import { redirect } from "next/navigation";
import type { LastRun } from "@/lib/notes/schemas";

const SAMPLE_OUTPUTS = SAMPLE_CELLS.map((s, cell) => ({
  urls: SAMPLE_OUTPUT_URLS[cell] ?? {},
  hrefs: (s.last_run?.outputs?.items ?? []).map((_, i) => sampleOutputPath(cell, i)),
}));

/** The tour, top to bottom: the note's question, then each experiment's four parts. */
const TOUR_STEPS: readonly TourStep[] = [
  { title: "Question", text: "Start a note with the question and how you'll test it. The result goes here when you know it.", part: "question" },
  { title: "Expect", text: "Write what you expect above the code, before you run it.", part: "before" },
  { title: "Run", text: "Run in your browser, or on a server with a GPU when the code needs one. Long runs keep going if you close the app, and the run is kept with the note.", part: "run" },
  { title: "Keep", text: "Tables, figures and files are saved with the note. Download any of them, or export the whole note to Jupyter, a web page or Markdown.", part: "outputs", focus: "img" },
  { title: "Conclude", text: "Write what happened next to what you expected, and mark the outcome.", part: "after" },
];

/** A run step's replay: the states the app shows while a long run goes, from that run's own record. */
function runReplay(run: LastRun | null | undefined, gpu: boolean): string[] {
  if (!run) return [];
  const done = run.stdout.split("\n").filter((l) => / done\b/.test(l));
  const s = Math.round(run.ms / 1000);
  const ran = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return ["Starting…", ...done.map((l) => `Running · ${l}`), "Saving results…", `Done · ran for ${ran} on ${gpu ? "a GPU" : "the CPU"}`];
}

const TOUR_CELLS: readonly TourCell[] = SAMPLE_CELLS.map((s, i) => ({ label: s.filename, replay: runReplay(s.last_run, SAMPLE_USED_GPU[i] ?? false) }));

/** A few facts, one line each. */
const FACTS = [
  { label: "Languages", text: "Python, R, Julia, MATLAB, C++, Fortran. Python and R run in your browser; all of them run on the server, with a GPU when the code needs one, and Hugging Face models and datasets one tap away." },
  { label: "Anywhere", text: "In your browser and on Android. The same notes on both, and the Android app works offline; export them to Jupyter, a web page or Markdown." },
  { label: "AI", text: "Suggests fixes and code, or does the work in the note when you ask, by voice or text. Stop it any time; Undo puts everything back." },
  { label: "Free", text: "No card, no trial. GPU runs included (10 a day); AI runs on a free account of your own, set up in a minute." },
] as const;


// Home: the list for signed-in users, the landing page for everyone else. The landing is a tour of
// a real note (a frozen run): the pitch and the four steps on one side, the
// note on the other; phones read the pitch, then the steps above the note. Kept short on purpose.
export default async function Home() {
  if (await isSignedIn()) {
    // The connect step (free AI) is passed through once; it holds nobody.
    if (await setupPending()) redirect("/welcome/boosts");
    return <NoteList />;
  }
  const run = SAMPLE_CELLS[0]?.last_run;
  return (
    <div>
    <div className="mx-auto w-full max-w-[1120px] px-5 lg:px-10">
      <header className="flex h-14 items-center justify-between">
        <Logo />
        <nav aria-label="Site" className="flex items-center gap-5">
          <TextLink href="/guide" className="hidden sm:inline-flex">
            Guide
          </TextLink>
          <TextLink href="/free" className="hidden sm:inline-flex">
            Free plan
          </TextLink>
          <TextLink href="/login" strong>
            Sign in
          </TextLink>
        </nav>
      </header>

      <main>
        <div className="pt-8 pb-14 lg:pt-14 lg:pb-20">
          <ProductTour
            steps={TOUR_STEPS}
            cells={TOUR_CELLS}
            caption={
              <>
                <SampleNoteTag />
                <span className="truncate text-[13px] text-muted">
                  A real run{run ? ` · ${new Date(run.ran_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}
                </span>
              </>
            }
            intro={
              <>
                <h1 className="text-[42px] font-normal leading-[1.02] tracking-[-0.02em] lg:text-[64px]">
                  {APP_DESCRIPTION}
                </h1>
                <p className="mt-5 max-w-[34rem] text-[16px] leading-relaxed text-muted lg:text-[18px]">
                  For students and researchers who experiment in code. Write down what you expect, run the code, and keep what happened, in one note per experiment. Each new attempt links to the last, so you can see what you tried and what worked.
                </p>
                <nav aria-label="Account" className="mt-8 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
                  <ButtonLink href="/login?mode=signup" className="w-full sm:w-auto">
                    Create account
                  </ButtonLink>
                  <TextLink href="/login" strong className="justify-center">
                    Sign in
                  </TextLink>
                  <AndroidDownload className="justify-center" />
                </nav>
                <p className="mt-3 text-[13px] text-muted">Free. Python runs in your browser, with nothing to install.</p>
              </>
            }
          >
            <NotePreview note={SAMPLE_NOTE} cells={SAMPLE_CELLS} outputs={SAMPLE_OUTPUTS} />
          </ProductTour>
        </div>

        <section aria-label="Details" className="py-12 lg:py-20">
          <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {FACTS.map((f) => (
              <div key={f.label} className="border-t border-line pt-5">
                <dt className="eyebrow">{f.label}</dt>
                <dd className="mt-3 text-[15px] leading-relaxed text-fg/90">{f.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="start" className="mb-16 flex flex-col items-start gap-6 border-t border-line pt-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="start" className="font-display text-[28px] font-normal leading-tight tracking-[-0.01em] lg:text-[36px]">
              Start with one experiment
            </h2>
            <p className="mt-1.5 text-[15px] text-muted">Free. Runs in your browser and on a GPU server; no card.</p>
          </div>
          <ButtonLink href="/login?mode=signup" className="w-full sm:w-auto">
            Create account
          </ButtonLink>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-6 text-[13px] text-muted">
        <span>benchjot</span>
        <span className="flex flex-wrap gap-x-5">
          <TextLink href="/guide" className="text-[13px]">
            Guide
          </TextLink>
          <TextLink href="/free" className="text-[13px]">
            Free plan
          </TextLink>
          <TextLink href="/security" className="text-[13px]">
            Security
          </TextLink>
          <TextLink href="/privacy" className="text-[13px]">
            Privacy
          </TextLink>
          <TextLink href="/terms" className="text-[13px]">
            Terms
          </TextLink>
        </span>
      </footer>
    </div>
    </div>
  );
}

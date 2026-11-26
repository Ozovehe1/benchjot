import { NoteList } from "@/components/notes/note-list";
import { SiteFooter } from "@/components/app/site-footer";
import { AppShot, DataTile, FiguresTile, MapTile, RunsTile, RunTile, Tile, type FigureTileItem, type FoundRow, type ShowcaseNote } from "@/components/app/showcase";
import { StaticCode } from "@/components/code/static-code";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { AI_MODEL_NAMES } from "@/config/app";
import { AndroidDownload } from "@/components/account/android-download";
import { SAMPLE_NOTE, SAMPLE_OUTPUT_URLS, SAMPLE_CELLS } from "@/lib/sample-note";
import { isSignedIn } from "@/lib/server/account";
import type { ExperimentRun } from "@/lib/data/experiments";
import { listDate } from "@/lib/ui/format";

/** The sample note's first cell and its run, as the hero's note shows them. */
function heroNote(): ShowcaseNote {
  const cell = SAMPLE_CELLS[0]!;
  const run = cell.last_run!;
  const [question = "", setup = "", result = ""] = SAMPLE_NOTE.notes.split("\n\n");
  return {
    title: SAMPLE_NOTE.title,
    body: `${question}\n\n${setup}`,
    result,
    filename: cell.filename ?? "balls.py",
    code: <StaticCode code={cell.content} language="python" label="Code 1" />,
    progress: run.stdout.split("\n").filter((l) => / done\b/.test(l)),
    ms: run.ms,
    runs: spiralRuns(),
  };
}

/** The sample run's spirals results, one row per network, as the Runs view shows logged runs. */
function spiralRuns(): ExperimentRun[] {
  const run = SAMPLE_CELLS[0]!.last_run!;
  const table = run.outputs?.items.find((i) => i.kind === "table");
  const rows = table && table.kind === "table" ? table.rows.filter((r) => r[0] === "spirals") : [];
  const mean = (v: unknown) => Number.parseFloat(String(v ?? "").split(" ")[0] ?? "");
  return rows.map((r, i) => ({
    id: `run-${i}`,
    cellId: "c1",
    ranAt: new Date(Date.parse(run.ran_at) + i * 60_000).toISOString(),
    outcome: "ok" as const,
    ms: run.ms,
    where: "server" as const,
    codeHash: run.code_hash,
    logged: { network: String(r[1]), lr: Number(r[3]), test_accuracy: mean(r[5]), outer_arm_accuracy: mean(r[8]) },
  }));
}

/** Every figure the sample note's runs drew, as Figures shows them. */
function sampleFigures(): FigureTileItem[] {
  return SAMPLE_CELLS.flatMap((c, cell) =>
    (c.last_run?.outputs?.items ?? []).flatMap((it) =>
      it.kind === "image" && it.files.png && SAMPLE_OUTPUT_URLS[cell]?.[it.files.png]
        ? [{ src: SAMPLE_OUTPUT_URLS[cell]![it.files.png]!, title: it.title, sub: `${SAMPLE_NOTE.title} · ${listDate(c.last_run!.ran_at)}` }]
        : [],
    ),
  );
}

/** Real results for "iris" from the platforms' public searches (checked 26 Nov 2026). */
const IRIS: FoundRow[] = [
  { title: "scikit-learn/iris", platform: "Hugging Face" },
  { title: "iris", platform: "OpenML" },
  { title: "Scikit-Learn IRIS", platform: "Zenodo" },
  { title: "Iris dataset for machine learning", platform: "Harvard Dataverse" },
];

// Home: the list for signed-in users; for everyone else, the product showcase, drawn with the app's own
// components (components/app/showcase.tsx): the app at work, then what's new, then one way to start.
export default async function Home() {
  if (await isSignedIn()) {
    return <NoteList />;
  }
  const note = heroNote();
  const answer = SAMPLE_CELLS[0]!.note_after ?? "";
  const models = Object.values(AI_MODEL_NAMES).join(" or ");

  return (
    <div className="overflow-x-clip">
      <div className="mx-auto w-full max-w-[1240px] px-5 lg:px-10">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <nav aria-label="Site" className="flex items-center gap-5">
            <TextLink href="#new" className="hidden sm:inline-flex">What&apos;s new</TextLink>
            <TextLink href="/example" className="hidden sm:inline-flex">Example</TextLink>
            <TextLink href="/guide" className="hidden sm:inline-flex">Guide</TextLink>
            <TextLink href="/login" strong>Sign in</TextLink>
          </nav>
        </header>

        <main>
          <section className="mx-auto max-w-[880px] pt-12 text-center lg:pt-20">
            <a href="#new" className="inline-flex items-center gap-2 rounded-full border border-line bg-raise px-3.5 py-1.5 text-[12.5px] text-muted transition-colors hover:text-fg">
              <span className="size-1.5 rounded-full bg-ok" />
              New: the Assistant, experiment tracking and the Data library
            </a>
            <h1 className="mt-7 font-display text-[44px] font-normal leading-[1.02] tracking-[-0.025em] sm:text-[62px] lg:text-[80px]">
              Ask for the experiment.
              <br />
              <span className="text-muted">Keep what happened.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[38rem] text-[17px] leading-relaxed text-muted lg:text-[19px]">
              Benchjot is a research notebook with an assistant that writes the code, runs it in your browser or on a GPU, logs every run, and writes up the result next to what you expected.
            </p>
            <nav aria-label="Account" className="mt-9 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center sm:gap-6">
              <ButtonLink href="/login?mode=signup" className="sm:w-auto">Start free</ButtonLink>
              <TextLink href="/example" strong className="justify-center">See a real note</TextLink>
              <AndroidDownload className="justify-center" />
            </nav>
            <p className="mt-4 text-[13px] text-faint">No card. Nothing to install. 50 AI requests and 10 GPU runs a day.</p>
          </section>

          <section aria-label="The app at work" className="mt-14 lg:mt-20">
            <AppShot note={note} answer={answer} />
            <p className="mt-4 text-center text-[12.5px] text-faint">
              The app as it is. The request and plan are an illustration; the code, its run, the numbers and the conclusion are from a real run.
            </p>
          </section>

          <section id="new" aria-labelledby="new-title" className="scroll-mt-8 pt-28 lg:pt-36">
            <div className="max-w-[44rem]">
              <p className="eyebrow">What&apos;s new</p>
              <h2 id="new-title" className="mt-3 font-display text-[36px] font-normal leading-[1.05] tracking-[-0.02em] lg:text-[52px]">Everything an experiment needs, in one note.</h2>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-6">
              <Tile className="lg:col-span-3" title="Experiment tracking" text="End a cell with log(…) and every run joins the note's Runs table and chart, side by side, so the best settings are a glance away.">
                <RunsTile runs={note.runs} />
              </Tile>

              <Tile className="lg:col-span-3" title="Data from five platforms" text="Search Hugging Face, Zenodo, OpenML, Harvard Dataverse and figshare at once. Cells open library files by name; save_data() keeps what a cell downloads.">
                <DataTile query="iris" rows={IRIS} />
              </Tile>

              <Tile className="lg:col-span-6" title="Figures, all in one place" text="Every figure, table and animation is kept with its run. Figures gathers them from all your notes; each downloads as PNG, SVG or PDF.">
                <FiguresTile items={sampleFigures()} />
              </Tile>

              <Tile className="lg:col-span-3" title="Runs where it needs to" text={`Each cell goes where it can run, by itself. The Assistant runs on ${models}, your choice under the chat box.`}>
                <RunTile progress={note.progress} />
              </Tile>

              <Tile className="lg:col-span-3" title="Research map" text="Links, sub-notes and attempts drawn as a map: filled dots worked, red failed, hollow not marked yet.">
                <MapTile />
              </Tile>
            </div>

            <dl className="mt-16 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Undo everything", "The Assistant shows each step as it goes, and Undo puts back all it changed."],
                ["Share a note", "By username, or with a link anyone can open. You choose whether they see the code."],
                ["Export", "A whole note as a Jupyter notebook, a web page or Markdown."],
                ["Android", "The same notes on your phone, Python included, offline too."],
              ].map(([t, d]) => (
                <div key={t} className="border-t border-line pt-5">
                  <dt className="text-[15px] font-medium text-fg">{t}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="start" className="my-28 rounded-[28px] border border-line bg-raise px-6 py-16 text-center lg:my-36 lg:py-24">
            <h2 id="start" className="font-display text-[36px] font-normal leading-tight tracking-[-0.02em] lg:text-[56px]">Run your next experiment here.</h2>
            <p className="mt-3 text-[15px] text-muted">Free. No card. Web and Android.</p>
            <ButtonLink href="/login?mode=signup" className="mt-9 w-full sm:w-auto">Start free</ButtonLink>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}

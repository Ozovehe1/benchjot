import Image from "next/image";
import { NoteList } from "@/components/notes/note-list";
import { SiteFooter } from "@/components/app/site-footer";
import { AppShot, DataSearch, MapSketch, RunAnywhere, RunsChart, Tile, type ShowcaseRun } from "@/components/app/showcase";
import { StaticCode } from "@/components/code/static-code";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { AI_MODEL_NAMES } from "@/config/app";
import { AndroidDownload } from "@/components/account/android-download";
import { SAMPLE_NOTE, SAMPLE_OUTPUT_URLS, SAMPLE_CELLS } from "@/lib/sample-note";
import { isSignedIn } from "@/lib/server/account";

/** The sample run's spirals rows (task, network, weights, lr, train, test, noisier, 200 points, outer arm), as the showcase shows them. */
function spiralRuns(): ShowcaseRun[] {
  const table = SAMPLE_CELLS[0]?.last_run?.outputs?.items.find((i) => i.kind === "table");
  const rows = table && table.kind === "table" ? table.rows.filter((r) => r[0] === "spirals") : [];
  const mean = (v: unknown) => String(v ?? "").split(" ")[0] ?? "";
  return rows.map((r) => ({ network: String(r[1]), lr: String(r[3]), test: mean(r[5]), outer: mean(r[8]) }));
}

/** Every figure the sample note's runs drew, with its title: the Figures tile. */
function sampleFigures(): { src: string; title: string; width: number; height: number }[] {
  return SAMPLE_CELLS.flatMap((c, cell) =>
    (c.last_run?.outputs?.items ?? []).flatMap((it) => (it.kind === "image" && it.files.png ? [{ src: SAMPLE_OUTPUT_URLS[cell]?.[it.files.png] ?? "", title: it.title, width: it.width, height: it.height }] : [])),
  ).filter((f) => f.src);
}

const FIRST_LINES = 9;

// Home: the list for signed-in users; for everyone else, the product showcase. A centred promise, the
// whole app at work, then "What's new": one tile per part of the product with its own live interface,
// and one way to start.
export default async function Home() {
  if (await isSignedIn()) {
    return <NoteList />;
  }
  const runs = spiralRuns();
  const figures = sampleFigures();
  const cell = SAMPLE_CELLS[0]!;
  const code = cell.content.split("\n").slice(0, FIRST_LINES).join("\n");
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
            <AppShot title={SAMPLE_NOTE.title} runs={runs} conclusion={cell.note_after ?? ""} code={<StaticCode code={code} language="python" label="Code 1" />} />
          </section>

          <section id="new" aria-labelledby="new-title" className="scroll-mt-8 pt-28 lg:pt-36">
            <div className="max-w-[44rem]">
              <p className="eyebrow">What&apos;s new</p>
              <h2 id="new-title" className="mt-3 font-display text-[36px] font-normal leading-[1.05] tracking-[-0.02em] lg:text-[52px]">Everything an experiment needs, in one note.</h2>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-6">
              <Tile className="lg:col-span-3" title="An assistant that does the work" text={`Ask in words. It plans, writes cells, runs them, reads the error when one fails and fixes the cause. It never invents data or results, and Undo takes it all back. ${models}, your choice.`}>
                <ul className="space-y-2">
                  {[
                    ["Plans and keeps you posted", "Its checklist ticks as each step finishes"],
                    ["Runs and fixes", "Ran cell 2 · failed  →  Changed cell 2  →  Ran cell 2 · 8.9 s"],
                    ["Finds real data", "Found 6 datasets  →  Saved N87.h5 to Data · 1.9 MB"],
                    ["Reads your other notes", "Finds them by words or meaning, and asks them what they found"],
                  ].map(([a, b]) => (
                    <li key={a} className="rounded-2xl border border-line bg-bg px-4 py-3">
                      <p className="text-[13.5px] text-fg">{a}</p>
                      <p className="mt-0.5 font-mono text-[11.5px] text-faint">{b}</p>
                    </li>
                  ))}
                </ul>
              </Tile>

              <Tile className="lg:col-span-3" title="Experiment tracking" text="End a cell with log(…) and every run joins the note's Runs table and chart, side by side, so the best settings are a glance away.">
                <RunsChart runs={runs} />
              </Tile>

              <Tile className="lg:col-span-2" title="Data from five platforms" text="Search Hugging Face, Zenodo, OpenML, Harvard Dataverse and figshare at once. Cells open library files by name; save_data() keeps what a cell downloads.">
                <DataSearch />
              </Tile>

              <Tile className="lg:col-span-2" title="Runs where it needs to" text="Each cell goes where it can run, by itself. Server runs keep going after you close the tab.">
                <RunAnywhere />
              </Tile>

              <Tile className="lg:col-span-2" title="Research map" text="Links, sub-notes and attempts, drawn as a map, so a line of work stays in one picture.">
                <MapSketch />
              </Tile>

              <Tile className="lg:col-span-4" title="Figures, all in one place" text="Every figure, table and animation is kept with its run. Figures gathers them from all your notes; each downloads as PNG, SVG or PDF.">
                <div className="grid grid-cols-3 gap-3">
                  {figures.map((f) => (
                    <figure key={f.src} className="overflow-hidden rounded-xl border border-line bg-white">
                      <Image src={f.src} alt={f.title} width={f.width} height={f.height} className="aspect-[4/3] h-auto w-full object-contain" sizes="(min-width: 1024px) 260px, 33vw" />
                    </figure>
                  ))}
                </div>
                <p className="mt-3 text-[11.5px] text-faint">The figures from the sample note&apos;s runs.</p>
              </Tile>

              <Tile className="lg:col-span-2" title="Share, export, take it with you" text="Share by username or a link. Export to Jupyter, a web page or Markdown. The Android app has the same notes, offline.">
                <div className="space-y-2">
                  <div className="truncate rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-[12px] text-muted">benchjot.vercel.app/s/…</div>
                  <div className="flex flex-wrap gap-2">
                    {[".ipynb", "Web page", "Markdown", "Android"].map((x) => (
                      <span key={x} className="rounded-full bg-tint px-3 py-1 text-[12px] text-muted">{x}</span>
                    ))}
                  </div>
                </div>
              </Tile>
            </div>
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

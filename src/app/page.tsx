import { NoteList } from "@/components/notes/note-list";
import { SiteFooter } from "@/components/app/site-footer";
import { ProductFilm } from "@/components/app/product-film";
import { RunOutputs } from "@/components/outputs/run-outputs";
import { StaticCode } from "@/components/code/static-code";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { APP_DESCRIPTION, AI_MODEL_NAMES } from "@/config/app";
import { AndroidDownload } from "@/components/account/android-download";
import { sampleOutputPath } from "@/lib/web/paths";
import { SAMPLE_NOTE, SAMPLE_OUTPUT_URLS, SAMPLE_CELLS, SAMPLE_USED_GPU } from "@/lib/sample-note";
import { filmOutputs, progressLines, ranFor } from "@/lib/landing";
import { isSignedIn } from "@/lib/server/account";
import { OUTCOME_LABEL } from "@/lib/notes/outcome";

/** The results table's columns the film shows (the index columns, task and network, always stay). */
const FILM_COLUMNS = ["test (same distribution)", "outer arm (extrapolation)"];

/** What the Assistant does in a note, each as the line the app shows for it. */
const ASSISTANT_ACTS = [
  { act: "Writes and runs cells", line: "Added cell 2 · Python  ·  Ran cell 2 on the server · 8.9 s" },
  { act: "Reads the error and fixes it", line: "Ran cell 2 · failed: ImportError  ·  Changed cell 2" },
  { act: "Finds real data", line: "Found 6 datasets  ·  Saved N87.h5 to Data · 1.9 MB" },
  { act: "Writes up what happened", line: "Wrote in the note under “Result”" },
];

const PLATFORMS = ["Hugging Face", "Zenodo", "OpenML", "Harvard Dataverse", "figshare"];

/** A few facts, one line each. */
const FACTS = [
  { label: "Any language", text: "Python and R in your browser. Julia, MATLAB, C++ and Fortran on a GPU server." },
  { label: "Runs that outlast the tab", text: "Server runs go on for up to an hour after you close it." },
  { label: "Web and Android", text: "The same notes on both, offline on the phone. Export to Jupyter or Markdown." },
  { label: "Free", text: "No card. 10 GPU runs and 50 AI requests a day." },
] as const;

// Home: the list for signed-in users, the landing page for everyone else. The landing leads with a
// centred promise and a replay of a real note in the app's window (product-film.tsx); below it, what
// the app does about the usual pains of experiments, each with the real thing, and one way to start.
export default async function Home() {
  if (await isSignedIn()) {
    return <NoteList />;
  }
  const cell = SAMPLE_CELLS[0]!;
  const run = cell.last_run;
  const film = filmOutputs(run?.outputs, FILM_COLUMNS);
  const hrefs = (run?.outputs?.items ?? []).map((_, i) => sampleOutputPath(0, i));
  // The narrowed table and the figure keep their own files and pages (the first table, then the image).
  const filmHrefs = film ? film.items.map((it) => hrefs[(run?.outputs?.items ?? []).findIndex((o) => o.kind === it.kind)] ?? "") : null;
  const spirals = (run?.outputs?.items.find((i) => i.kind === "table")?.rows ?? []).filter((r) => r[0] === "spirals");
  const where = SAMPLE_USED_GPU[0] ? "a server GPU" : "the server's CPU";

  return (
    <div className="overflow-x-clip">
      <div className="mx-auto w-full max-w-[1200px] px-5 lg:px-10">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <nav aria-label="Site" className="flex items-center gap-5">
            <TextLink href="/example" className="hidden sm:inline-flex">Example</TextLink>
            <TextLink href="/guide" className="hidden sm:inline-flex">Guide</TextLink>
            <TextLink href="/free" className="hidden sm:inline-flex">Free plan</TextLink>
            <TextLink href="/login" strong>Sign in</TextLink>
          </nav>
        </header>

        <main>
          {/* The promise, centred, then the product doing it. */}
          <section className="mx-auto max-w-[820px] pt-12 text-center lg:pt-20">
            <h1 className="font-display text-[44px] font-normal leading-[1.02] tracking-[-0.025em] sm:text-[60px] lg:text-[76px]">{APP_DESCRIPTION}</h1>
            <p className="mx-auto mt-6 max-w-[36rem] text-[17px] leading-relaxed text-muted lg:text-[19px]">
              Write what you expect, run the code, keep what it made, and say what happened. One note per experiment, with an assistant that does the legwork.
            </p>
            <nav aria-label="Account" className="mt-9 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center sm:gap-6">
              <ButtonLink href="/login?mode=signup" className="sm:w-auto">Create account</ButtonLink>
              <TextLink href="/example" strong className="justify-center">See a real note</TextLink>
              <AndroidDownload className="justify-center" />
            </nav>
            <p className="mt-4 text-[13px] text-faint">Free. Code runs in your browser: no Python or libraries to set up.</p>
          </section>

          <section aria-label="A real note, replayed" className="mt-14 lg:mt-20">
            <ProductFilm
              title={SAMPLE_NOTE.title}
              before={cell.note_before ?? ""}
              after={cell.note_after ?? ""}
              filename={cell.filename ?? "main.py"}
              progress={progressLines(run)}
              ranFor={ranFor(run)}
              where={where}
              outcome={SAMPLE_NOTE.outcome ? OUTCOME_LABEL[SAMPLE_NOTE.outcome] : "Successful"}
              code={<StaticCode code={cell.content} language="python" label="Code 1" />}
              outputs={film ? <RunOutputs manifest={film} urls={SAMPLE_OUTPUT_URLS[0] ?? {}} hrefs={filmHrefs} tableRows={Number.POSITIVE_INFINITY} /> : null}
            />
            <p className="mt-6 text-center text-[13px] text-faint">
              A replay of a real run on {new Date(run?.ran_at ?? Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, sped up.{" "}
              <TextLink href="/example" className="text-[13px]">Read the whole note</TextLink>
            </p>
          </section>

          {/* The pains, each with what the app does about it. */}
          <div className="mt-28 space-y-24 lg:mt-36 lg:space-y-32">
            <Feature
              eyebrow="Assistant"
              title="Ask in words. It writes, runs and fixes the code."
              text={`It works in your note: adds cells, runs them, reads the error when one fails and fixes the cause. It never invents data or results, and Undo takes all of it back. ${Object.values(AI_MODEL_NAMES).join(" or ")}, your choice.`}
            >
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raise">
                {ASSISTANT_ACTS.map((a) => (
                  <li key={a.act} className="px-5 py-4">
                    <p className="text-[15px] text-fg">{a.act}</p>
                    <p className="mt-1 font-mono text-[12px] text-faint">{a.line}</p>
                  </li>
                ))}
              </ul>
            </Feature>

            <Feature
              flip
              eyebrow="Experiment tracking"
              title="Every run, side by side."
              text="End a cell with log(accuracy=acc, lr=lr) and each run joins the note's Runs table and chart, so the best settings are a glance away, not a search through old output."
            >
              <div className="overflow-hidden rounded-2xl border border-line bg-raise">
                <pre className="border-b border-line px-5 py-4 font-mono text-[13px] text-fg/90">log(network=name, lr=lr, test=acc, outer_arm=extrap)</pre>
                <table className="w-full text-left text-[13px]">
                  <thead className="text-faint">
                    <tr>
                      <th className="px-5 py-3 font-normal">network</th>
                      <th className="px-3 py-3 text-right font-normal">lr</th>
                      <th className="px-3 py-3 text-right font-normal">test</th>
                      <th className="px-5 py-3 text-right font-normal">outer arm</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {spirals.map((r) => (
                      <tr key={String(r[1])} className="border-t border-line">
                        <td className="px-5 py-3 text-fg">{String(r[1])}</td>
                        <td className="px-3 py-3 text-right text-muted">{String(r[3])}</td>
                        <td className="px-3 py-3 text-right text-fg">{String(r[5]).split(" ")[0]}</td>
                        <td className="px-5 py-3 text-right text-muted">{String(r[8]).split(" ")[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-5 py-3 text-[12px] text-faint">The spirals results from the run above (mean over 10 seeds), laid out as the Runs table shows logged runs.</p>
              </div>
            </Feature>

            <Feature
              eyebrow="Data"
              title="Real data, not stand-ins."
              text="Search five open data platforms at once, or add a file by its address. A cell opens a library file by name, in the browser, on the phone and on the server, and a cell that downloads data can keep it with save_data()."
            >
              <div className="overflow-hidden rounded-2xl border border-line bg-raise">
                <div className="flex flex-wrap gap-2 px-5 py-4">
                  {PLATFORMS.map((p) => (
                    <span key={p} className="rounded-full bg-tint px-3 py-1 text-[13px] text-muted">{p}</span>
                  ))}
                </div>
                <pre className="overflow-x-auto border-t border-line px-5 py-4 font-mono text-[13px] leading-relaxed text-fg/90">{`df = pd.read_csv("iris.csv")  # from your Data library
save_data("N87.h5")           # keep a file this cell made`}</pre>
              </div>
            </Feature>
          </div>

          <section aria-label="Details" className="mt-28 lg:mt-36">
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {FACTS.map((f) => (
                <div key={f.label} className="border-t border-line pt-5">
                  <dt className="text-[15px] font-medium text-fg">{f.label}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-muted">{f.text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="start" className="my-28 rounded-3xl border border-line bg-raise px-6 py-14 text-center lg:my-36 lg:py-20">
            <h2 id="start" className="font-display text-[34px] font-normal leading-tight tracking-[-0.015em] lg:text-[48px]">Start with one experiment.</h2>
            <p className="mt-3 text-[15px] text-muted">Free. No card.</p>
            <ButtonLink href="/login?mode=signup" className="mt-8 w-full sm:w-auto">Create account</ButtonLink>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}

/** One pain and what the app does about it: words on one side, the real thing on the other (sides alternate on wide screens). */
function Feature({ eyebrow, title, text, flip, children }: { eyebrow: string; title: string; text: string; flip?: boolean; children: React.ReactNode }) {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : undefined}>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-3 font-display text-[32px] font-normal leading-[1.08] tracking-[-0.015em] lg:text-[42px]">{title}</h2>
        <p className="mt-4 max-w-[32rem] text-[16px] leading-relaxed text-muted">{text}</p>
      </div>
      <div className={flip ? "lg:order-1" : undefined}>{children}</div>
    </section>
  );
}

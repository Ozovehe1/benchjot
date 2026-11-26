import Image from "next/image";
import { NoteList } from "@/components/notes/note-list";
import { SiteFooter } from "@/components/app/site-footer";
import { ScreenTour, type TourScreen } from "@/components/app/showcase";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { AI_MODEL_NAMES } from "@/config/app";
import { AndroidDownload } from "@/components/account/android-download";
import { isSignedIn } from "@/lib/server/account";

const shot = (name: string): Pick<TourScreen, "desktop" | "phone"> => ({ desktop: `/showcase/${name}.webp`, phone: `/showcase/${name}-phone.webp` });

/** The tour: the app's real screens (public/showcase/, scripts/capture-showcase.mjs), one per part of it. */
const SCREENS: readonly TourScreen[] = [
  { id: "assistant", label: "Assistant", title: "An assistant in every note", text: `Ask in words. It writes cells, runs them, reads the error when one fails and fixes the cause, finds real data, and writes up the result. Undo takes all of it back. ${Object.values(AI_MODEL_NAMES).join(" or ")}, chosen under the chat box.`, ...shot("note-assistant") },
  { id: "run", label: "Run", title: "Code, run and result together", text: "Python and R run in your browser. Anything heavier goes to a server, with a GPU when the code needs one, and keeps going after you close the tab. Every table and figure is kept with the run.", ...shot("note-cell") },
  { id: "runs", label: "Experiment tracking", title: "Every run, side by side", text: "End a cell with log(accuracy=acc, lr=lr) and each run joins the note's Runs table and chart. Tick two to see what changed.", ...shot("note-runs") },
  { id: "data", label: "Data", title: "Real data from five platforms", text: "Search Hugging Face, Zenodo, OpenML, Harvard Dataverse and figshare at once, upload a file, or add one by its address. Any cell opens it by name; save_data() keeps what a cell downloads.", ...shot("data") },
  { id: "figures", label: "Figures", title: "Every figure in one place", text: "Plots, charts and animations from all your notes, searchable. Each opens at its cell and downloads as PNG, SVG or PDF.", ...shot("figures") },
  { id: "map", label: "Research map", title: "See how your work connects", text: "Links, sub-notes and new attempts, drawn as a map. Filled dots worked, red ones failed, hollow ones aren't marked yet.", ...shot("map") },
];

// Home: the list for signed-in users; for everyone else, the product: a promise, the app itself (real
// screens, not mock-ups), a tour of its parts, and one way to start.
export default async function Home() {
  if (await isSignedIn()) {
    return <NoteList />;
  }
  return (
    <div className="overflow-x-clip">
      <div className="mx-auto w-full max-w-[1240px] px-5 lg:px-10">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          <nav aria-label="Site" className="flex items-center gap-5">
            <TextLink href="#tour" className="hidden sm:inline-flex">Tour</TextLink>
            <TextLink href="/guide" className="hidden sm:inline-flex">Guide</TextLink>
            <TextLink href="/login" strong>Sign in</TextLink>
          </nav>
        </header>

        <main>
          <section className="mx-auto max-w-[880px] pt-12 text-center lg:pt-20">
            <h1 className="font-display text-[44px] font-normal leading-[1.02] tracking-[-0.025em] sm:text-[62px] lg:text-[80px]">
              Run the experiment.
              <br />
              <span className="text-muted">Keep what happened.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[38rem] text-[17px] leading-relaxed text-muted lg:text-[19px]">
              Write what you expect, run your code in the browser or on a GPU, and keep every run, figure and result in one note. When you want help, the Assistant can write code, fix errors and find data.
            </p>
            <nav aria-label="Account" className="mt-9 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center sm:gap-6">
              <ButtonLink href="/login?mode=signup" className="sm:w-auto">Start free</ButtonLink>
              <AndroidDownload className="justify-center" />
            </nav>
            <p className="mt-4 text-[13px] text-faint">No card. Nothing to install. 50 AI requests and 10 GPU runs a day.</p>
          </section>

          {/* The app itself, as it is. */}
          <section aria-label="Benchjot" className="relative mt-14 lg:mt-20">
            <div aria-hidden className="pointer-events-none absolute -inset-x-10 -top-24 h-[420px] bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklab,var(--fg)_9%,transparent),transparent)]" />
            <div className="relative hidden overflow-hidden rounded-2xl border border-line shadow-float sm:block">
              <Image src="/showcase/notes.webp" alt="Your notes in Benchjot: projects, pinned notes, shared notes and search" width={2880} height={1800} priority sizes="(min-width: 1280px) 1160px, 95vw" className="h-auto w-full" />
            </div>
            <div className="relative mx-auto w-[82%] max-w-[360px] overflow-hidden rounded-[28px] border border-line shadow-float sm:hidden">
              <Image src="/showcase/notes-phone.webp" alt="Your notes on a phone" width={1082} height={2202} priority sizes="82vw" className="h-auto w-full" />
            </div>
          </section>

          <section id="tour" aria-labelledby="tour-title" className="scroll-mt-8 pt-28 lg:pt-36">
            <div className="max-w-[44rem]">
              <p className="eyebrow">Tour</p>
              <h2 id="tour-title" className="mt-3 font-display text-[36px] font-normal leading-[1.05] tracking-[-0.02em] lg:text-[52px]">Everything an experiment needs, in one note.</h2>
            </div>
            <div className="mt-10">
              <ScreenTour screens={SCREENS} />
            </div>
            <p className="mt-8 text-[12.5px] text-faint">Screens from the app, with a sample account.</p>
          </section>

          <dl className="mt-24 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Any language", "Python and R in your browser. Julia, MATLAB, C++ and Fortran on a GPU server."],
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

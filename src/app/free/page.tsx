import Link from "next/link";
import { IconGlobe, IconNote, IconRefresh, IconSearch, IconServer, IconSparkle } from "@/components/ui";
import { Folder, Folders, Glance, LegalPage } from "@/components/app/legal-page";
import { AI, GPU_RUNS } from "@/config/app";

export const metadata = { title: "Free plan" };

// What's free: the limits first, as numbers; then what each covers, one folder each.
export default function FreePage() {
  return (
    <LegalPage path="/free" title="Free plan" updated="26 November 2026" lead="Everything in Benchjot is free, with no card.">
      <Glance
        items={[
          { value: "Unlimited", label: "notes, projects and browser runs" },
          { value: String(GPU_RUNS.perDay), label: "GPU runs a day" },
          { value: String(AI.perDay), label: "AI requests a day" },
          { value: AI.creditsPerMonth.toLocaleString("en"), label: "AI credits a month" },
        ]}
      />
      <Folders title="What each covers">
        <Folder icon={IconNote} title="Notes and projects" summary="Unlimited, with the research map and export.">
          <p>As many notes and projects as you like, the research map, and export to Jupyter, a web page or Markdown.</p>
        </Folder>
        <Folder icon={IconGlobe} title="Runs in your browser" summary="Unlimited. Python and R, nothing to install.">
          <p>Python with NumPy, pandas, scikit-learn and matplotlib, and R with the tidyverse, run in your browser (or on your phone in the Android app).</p>
        </Folder>
        <Folder icon={IconServer} title="Runs on the server" summary={`CPU unlimited; GPU ${GPU_RUNS.perDay} a day. Up to an hour each.`}>
          <p>Python, R, Julia, MATLAB, C, C++ and Fortran, with PyTorch, TensorFlow and any package. Up to an hour each, and up to 3 at once.</p>
          <p>A GPU (a T4) is chosen when the code needs one: {GPU_RUNS.perDay} GPU runs a day. CPU runs aren&apos;t counted.</p>
        </Folder>
        <Folder icon={IconSparkle} title="AI: Fix and the assistant" summary={`Two models to choose from. ${AI.perDay} a day, ${AI.creditsPerMonth.toLocaleString("en")} credits a month.`}>
          <p>Each assistant step, Fix or look at a figure is one request: {AI.perDay} a day.</p>
          <p>A credit is one cent of what the request cost: {AI.creditsPerMonth.toLocaleString("en")} a month. Haiku uses far fewer than Sonnet, so it goes further.</p>
        </Folder>
        <Folder icon={IconSearch} title="Finding related notes" summary="Unlimited. Doesn't use your AI requests.">
          <p>Search by meaning runs inside Benchjot&apos;s database, not on the AI, so it never counts.</p>
        </Folder>
        <Folder icon={IconRefresh} title="How the limits refill" summary="Failed requests don't count. Credits renew on the 1st.">
          <p>A run or AI request that failed isn&apos;t counted. Requests and GPU runs refill over a rolling 24 hours; credits renew on the 1st of each month. Settings → Usage shows where you stand.</p>
        </Folder>
      </Folders>
      <p className="text-sm text-muted">
        <Link href="/guide" className="underline underline-offset-4">How it works</Link> · <Link href="/security" className="underline underline-offset-4">Security</Link>
      </p>
    </LegalPage>
  );
}

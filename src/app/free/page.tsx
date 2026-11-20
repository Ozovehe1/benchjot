import Link from "next/link";
import { LegalPage } from "@/components/app/legal-page";
import { GPU_RUNS } from "@/config/app";

export const metadata = { title: "Free plan" };

// What's free, and the one daily limit (GPU runs on the server).
export default function FreePage() {
  return (
    <LegalPage title="Free plan" updated="19 November 2026">
      <p>Benchjot is free, with no card. Code runs in your browser, or on Benchjot’s server with a GPU when it needs one. Fix and the assistant run on a free AI account of your own (OpenRouter), which sign-up walks you through in about a minute.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2 pr-4 font-medium">What</th>
              <th className="py-2 font-medium">Free</th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:py-2.5 [&_td]:pr-4 [&_td]:align-top">
            <tr><td>Notes, projects, research map, export</td><td>Unlimited</td></tr>
            <tr><td>Runs in your browser (Python with NumPy, pandas, scikit-learn; R with the tidyverse)</td><td>Unlimited</td></tr>
            <tr><td>Runs on the server on the CPU (Python, R, Julia, MATLAB, C, C++, Fortran; PyTorch, TensorFlow, any package)</td><td>Unlimited, up to an hour each; up to 3 at once</td></tr>
            <tr><td>Runs on the server with a GPU (a T4, chosen when the code needs one)</td><td>{GPU_RUNS.perDay} a day, up to an hour each</td></tr>
            <tr><td>Fix and the assistant (AI)</td><td>On your own free OpenRouter account, within its free daily allowance (about 50 requests a day; each step, each look at a figure and each question to another note is one)</td></tr>
            <tr><td>Finding related notes by meaning</td><td>Unlimited; it doesn’t use your AI allowance</td></tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">A run that couldn’t start isn’t counted. Settings → Usage shows where you stand; the GPU runs refill over a rolling 24 hours.</p>
      <p>
        <Link href="/guide" className="underline underline-offset-4">How it works</Link> · <Link href="/security" className="underline underline-offset-4">How keys are kept</Link>
      </p>
    </LegalPage>
  );
}
